import type { AgentEvent, ToolCallEvent } from '../streaming/agent-event';
import type { AgentEventStore } from '../streaming/agent-event.store';
import { summarizeChunk } from '../streaming/agent-stream';
import {
  chunkToEvents,
  initialStreamState,
  nextRoundState,
  type GeminiChunk,
  type StreamState,
} from '../streaming/to-agent-event.operator';
import type { InterruptService } from '../registry/interrupt.service';
import type { ToolRegistry } from '../registry/tool-registry';
import {
  settleToolCallsParallel,
  type SettledToolCall,
} from '../registry/tool-execution';
import {
  toTokenUsage,
  type TokenAccountantService,
} from '../observability/token-accountant.service';
import type { BudgetBreach, BudgetService } from '../observability/budget.service';
import { ZERO_USAGE, type TokenUsage } from '../observability/usage.types';
import type { AgentRegistry } from '../agents/agent-registry.service';
import { HANDOFF_TOOL_NAME } from '../../shared/tools/handoff-tool/handoff-tool.manifest';
import { PROPOSE_TOOL_NAME } from '../../shared/tools/propose-tool/propose-tool.manifest';
import { TOOL_SYNTHESIS_CLAUSE } from '../agents/agent-definitions';
import { normalizeUserTurnInput, type UserTurnInput } from '../media/attachment.types';

export const MAX_AGENT_ROUNDS = 8;

// Cap how many tools the agent may propose in a single turn. Prevents runaway
// self-extension while still allowing a compose-a-couple-tools demo flow.
export const MAX_TOOL_SYNTHESIS_PER_TURN = 2;

export interface StreamRoundRequest {
  readonly model: string;
  readonly contents: unknown;
  readonly config: {
    readonly systemInstruction: string;
    readonly thinkingConfig: Record<string, unknown>;
    readonly tools?: ReadonlyArray<{ readonly functionDeclarations: readonly unknown[] }>;
  };
}

export interface AgentLoopOptions {
  readonly model: string;
  readonly thinkingConfig: Record<string, unknown>;
}

export interface AgentLoopDeps {
  readonly streamChunks: (req: StreamRoundRequest) => Promise<AsyncIterable<GeminiChunk>>;
  readonly store: Pick<
    AgentEventStore,
    | 'beginTurn'
    | 'appendUserTurn'
    | 'appendToolResponses'
    | 'appendChunkToRawHistory'
    | 'bumpStats'
    | 'rawHistory'
  >;
  readonly registry: Pick<ToolRegistry, 'get' | 'execute' | 'loadImpl' | 'declarations'>;
  readonly interrupts: Pick<InterruptService, 'pendingDecision'>;
  readonly tokenAccountant: Pick<
    TokenAccountantService,
    'beginTurn' | 'recordRound' | 'currentTurn'
  >;
  readonly budget: Pick<BudgetService, 'evaluate'>;
  readonly agents: Pick<
    AgentRegistry,
    'activeAgent' | 'activeAgentId' | 'switchActive' | 'resetForNewTurn'
  >;
  // Names of user-defined custom tools. Unioned into every agent's declaration
  // set so custom tools are visible regardless of which built-in agent is
  // active. Optional in tests; production wires CustomToolsService.
  readonly customToolNames?: () => ReadonlySet<string>;
  // Whether the agent may propose brand-new tools (`proposeTool`). Optional in
  // tests; production wires a persisted settings flag. Defaults to off.
  readonly allowToolSynthesis?: () => boolean;
  readonly now?: () => number;
}

interface RoundOutcome {
  readonly state: StreamState;
  readonly toolCalls: readonly ToolCallEvent[];
  readonly finishReason: string;
}

export async function* runAgentTurn(
  input: string | UserTurnInput,
  turnId: string,
  options: AgentLoopOptions,
  signal: AbortSignal,
  deps: AgentLoopDeps,
): AsyncGenerator<AgentEvent> {
  const now = deps.now ?? Date.now;

  beginTurn(turnId, normalizeUserTurnInput(input), deps);
  yield { type: 'turn_start', ts: now(), turnId };

  const allowSynthesis = deps.allowToolSynthesis?.() ?? false;
  let toolsProposed = 0;

  let state: StreamState = initialStreamState(turnId);

  for (let round = 0; round < MAX_AGENT_ROUNDS; round++) {
    if (round > 0) state = nextRoundState(state);

    const breach = checkBudgetGuard(deps);
    if (breach) {
      yield budgetTerminationEvent(turnId, round, breach, now);
      return;
    }

    const includeSynthesis = allowSynthesis && toolsProposed < MAX_TOOL_SYNTHESIS_PER_TURN;

    const outcome: RoundOutcome = yield* streamRound(
      options.model,
      options.thinkingConfig,
      state,
      turnId,
      signal,
      deps,
      now,
      includeSynthesis,
    );
    state = outcome.state;

    if (outcome.toolCalls.length === 0) {
      yield {
        type: 'turn_complete',
        ts: now(),
        turnId,
        rounds: round + 1,
        finishReason: outcome.finishReason,
      };
      return;
    }

    yield* settleRoundToolCalls(outcome.toolCalls, turnId, signal, deps, now);
    toolsProposed += outcome.toolCalls.filter((c) => c.name === PROPOSE_TOOL_NAME).length;
    yield* applyHandoffIfRequested(outcome.toolCalls, turnId, deps, now);
  }

  yield {
    type: 'turn_complete',
    ts: now(),
    turnId,
    rounds: MAX_AGENT_ROUNDS,
    finishReason: 'MAX_AGENT_ROUNDS',
  };
}

async function* streamRound(
  model: string,
  thinkingConfig: Record<string, unknown>,
  initialState: StreamState,
  turnId: string,
  signal: AbortSignal,
  deps: AgentLoopDeps,
  now: () => number,
  includeSynthesis: boolean,
): AsyncGenerator<AgentEvent, RoundOutcome> {
  const activeAgent = deps.agents.activeAgent();
  const declarations = declarationsForAgent(
    deps,
    activeAgent.toolNames,
    activeAgent.handoffTargets.length > 0,
    deps.customToolNames?.() ?? EMPTY_NAME_SET,
    includeSynthesis,
  );

  const systemInstruction = includeSynthesis
    ? `${activeAgent.systemPrompt} ${TOOL_SYNTHESIS_CLAUSE}`
    : activeAgent.systemPrompt;

  const stream = await deps.streamChunks({
    model,
    contents: deps.store.rawHistory(),
    config: {
      systemInstruction,
      thinkingConfig,
      tools:
        declarations.length > 0
          ? [{ functionDeclarations: declarations }]
          : undefined,
    },
  });

  const roundStartedAt = now();
  const toolCalls: ToolCallEvent[] = [];
  let state = initialState;
  let latestUsage: TokenUsage = ZERO_USAGE;
  let finishReason = 'STOP';

  for await (const chunk of stream) {
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');

    deps.store.appendChunkToRawHistory(chunk);
    const { parts, signedParts } = summarizeChunk(chunk);
    deps.store.bumpStats({ chunks: 1, parts, signedParts });

    if (chunk.usageMetadata) {
      latestUsage = toTokenUsage(chunk.usageMetadata);
    }

    const { events, state: nextState } = chunkToEvents(chunk, state);
    state = nextState;

    for (const event of events) {
      if (event.type === 'tool_call') {
        toolCalls.push(event);
      }
      if (event.type === 'round_complete') {
        finishReason = event.finishReason;
        const completedAt = now();
        deps.tokenAccountant.recordRound({
          turnId,
          roundIndex: event.roundIndex,
          startedAt: roundStartedAt,
          completedAt,
          usage: latestUsage,
          model,
          finishReason: event.finishReason,
        });
        yield {
          ...event,
          latencyMs: completedAt - roundStartedAt,
          usage: latestUsage,
        };
        continue;
      }
      yield event;
    }
  }

  if (!state.finalized) {
    const completedAt = now();
    deps.tokenAccountant.recordRound({
      turnId,
      roundIndex: state.roundIndex,
      startedAt: roundStartedAt,
      completedAt,
      usage: latestUsage,
      model,
      finishReason: 'STOP',
    });
    yield {
      type: 'round_complete',
      ts: completedAt,
      turnId,
      roundIndex: state.roundIndex,
      finishReason: 'STOP',
      latencyMs: completedAt - roundStartedAt,
      usage: latestUsage,
    };
  }

  return { state, toolCalls, finishReason };
}

async function* settleRoundToolCalls(
  toolCalls: readonly ToolCallEvent[],
  turnId: string,
  signal: AbortSignal,
  deps: AgentLoopDeps,
  now: () => number,
): AsyncGenerator<AgentEvent> {
  // Pre-warm descriptor lazy loads so the UI can render the right component
  // while the executor is still working. Failures are recorded by the registry
  // (via `failedNames`) so the template can surface them; we log here to keep
  // a console trail for live debugging.
  const uniqueNames = Array.from(new Set(toolCalls.map((c) => c.name)));
  for (const name of uniqueNames) {
    deps.registry.loadImpl(name).catch((err) => {
      console.warn(`[agent-loop] Failed to preload tool descriptor "${name}":`, err);
    });
  }

  for (const call of toolCalls) {
    const descriptor = deps.registry.get(call.name);
    if (descriptor?.interruptive) {
      yield {
        type: 'interrupt_request',
        ts: now(),
        turnId,
        callId: call.callId,
        reason:
          descriptor.interruptReason ??
          `${call.name} needs your approval before running.`,
      };
    }
  }

  const settled = new Map<string, SettledToolCall>();
  for await (const item of settleToolCallsParallel(toolCalls, turnId, signal, {
    registry: deps.registry,
    interrupts: deps.interrupts,
  })) {
    settled.set(item.call.callId, item);
    for (const event of item.events) yield event;
  }

  deps.store.appendToolResponses(
    toolCalls.map((call) => ({
      name: call.name,
      response: settled.get(call.callId)!.responseForModel,
    })),
  );
}

async function* applyHandoffIfRequested(
  toolCalls: readonly ToolCallEvent[],
  turnId: string,
  deps: AgentLoopDeps,
  now: () => number,
): AsyncGenerator<AgentEvent> {
  const lastHandoff = [...toolCalls]
    .reverse()
    .find((c) => c.name === HANDOFF_TOOL_NAME);
  if (!lastHandoff) return;

  const args = lastHandoff.args as Record<string, unknown>;
  const toAgentId = typeof args['specialist'] === 'string' ? args['specialist'] : '';
  const reason = typeof args['reason'] === 'string' ? args['reason'] : '';
  const fromAgentId = deps.agents.activeAgentId();
  const transition = deps.agents.switchActive({ turnId, toAgentId, reason });
  if (!transition) return;

  yield {
    type: 'agent_handoff',
    ts: now(),
    turnId,
    fromAgentId,
    toAgentId,
    reason,
  };
}

function beginTurn(turnId: string, input: UserTurnInput, deps: AgentLoopDeps): void {
  deps.store.beginTurn(turnId);
  deps.tokenAccountant.beginTurn(turnId);
  deps.agents.resetForNewTurn();
  deps.store.appendUserTurn(input);
}

const EMPTY_NAME_SET: ReadonlySet<string> = new Set<string>();

function declarationsForAgent(
  deps: AgentLoopDeps,
  allowedNames: readonly string[],
  includeHandoff: boolean,
  customNames: ReadonlySet<string>,
  includeSynthesis: boolean,
) {
  const allowed = new Set<string>(allowedNames);
  if (includeHandoff) allowed.add(HANDOFF_TOOL_NAME);
  if (includeSynthesis) allowed.add(PROPOSE_TOOL_NAME);
  for (const name of customNames) allowed.add(name);
  return deps.registry.declarations().filter((d) => allowed.has(d.name));
}

function checkBudgetGuard(deps: AgentLoopDeps): BudgetBreach | null {
  const turn = deps.tokenAccountant.currentTurn();
  return deps.budget.evaluate({
    tokensUsed: turn.totals.totalTokens,
    roundsUsed: turn.rounds.length,
    costUsd: turn.costUsd,
  });
}

function budgetTerminationEvent(
  turnId: string,
  rounds: number,
  breach: BudgetBreach,
  now: () => number,
): AgentEvent {
  return {
    type: 'turn_complete',
    ts: now(),
    turnId,
    rounds,
    finishReason: `BUDGET_EXCEEDED:${breach.kind}`,
  };
}
