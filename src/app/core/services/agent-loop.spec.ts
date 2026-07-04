import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  runAgentTurn,
  MAX_TOOL_SYNTHESIS_PER_TURN,
  type AgentLoopDeps,
  type StreamRoundRequest,
} from './agent-loop';
import { PROPOSE_TOOL_NAME } from '../../shared/tools/propose-tool/propose-tool.manifest';
import { TOOL_SYNTHESIS_CLAUSE } from '../agents/agent-definitions';
import type { AgentEvent } from '../streaming/agent-event';
import { AgentEventStore } from '../streaming/agent-event.store';
import type { GeminiChunk } from '../streaming/to-agent-event.operator';
import { InterruptService } from '../registry/interrupt.service';
import type { ToolRegistry } from '../registry/tool-registry';
import type {
  FunctionDeclaration,
  ToolDescriptor,
  ToolMeta,
} from '../registry/tool-descriptor';
import { TokenAccountantService } from '../observability/token-accountant.service';
import { BudgetService } from '../observability/budget.service';
import { AgentRegistry } from '../agents/agent-registry.service';
import { HANDOFF_TOOL_NAME } from '../../shared/tools/handoff-tool/handoff-tool.manifest';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function textChunk(text: string): GeminiChunk {
  return {
    candidates: [{ content: { role: 'model', parts: [{ text }] } }],
  };
}

function thoughtChunk(text: string): GeminiChunk {
  return {
    candidates: [{ content: { role: 'model', parts: [{ text, thought: true }] } }],
  };
}

function toolChunk(
  name: string,
  args: Record<string, unknown>,
  signature?: string,
): GeminiChunk {
  return {
    candidates: [
      {
        content: {
          role: 'model',
          parts: [
            {
              functionCall: { name, args },
              ...(signature ? { thoughtSignature: signature } : {}),
            },
          ],
        },
      },
    ],
  };
}

function finishChunk(
  reason = 'STOP',
  usage?: {
    readonly promptTokenCount?: number;
    readonly candidatesTokenCount?: number;
    readonly thoughtsTokenCount?: number;
    readonly totalTokenCount?: number;
  },
): GeminiChunk {
  return {
    candidates: [{ content: { role: 'model', parts: [] }, finishReason: reason }],
    usageMetadata: usage,
  };
}

async function* asAsync(chunks: readonly GeminiChunk[]): AsyncIterable<GeminiChunk> {
  for (const c of chunks) yield c;
}

interface ToolDef {
  readonly meta: ToolMeta;
  readonly execute: (args: unknown) => unknown | Promise<unknown>;
}

// Minimal in-memory tool registry. Avoids dragging the eager manifests + their
// lazy-loaded descriptors into agent-loop tests.
function makeRegistry(tools: readonly ToolDef[]): Pick<
  ToolRegistry,
  'get' | 'execute' | 'loadImpl' | 'declarations'
> {
  const byName = new Map<string, ToolDef>();
  for (const t of tools) byName.set(t.meta.name, t);

  return {
    get: (name: string) => byName.get(name)?.meta,
    execute: async (name: string, args: unknown) => {
      const t = byName.get(name);
      if (!t) throw new Error(`Unknown tool: ${name}`);
      return ((await t.execute(args)) ?? {}) as Record<string, unknown>;
    },
    loadImpl: async (name: string) => {
      const t = byName.get(name);
      if (!t) throw new Error(`Unknown tool: ${name}`);
      const descriptor: ToolDescriptor = {
        ...t.meta,
        argsSchema: z.any(),
        execute: ((args: unknown) => t.execute(args)) as ToolDescriptor['execute'],
        component: null as unknown as ToolDescriptor['component'],
      };
      return descriptor;
    },
    declarations: () => tools.map((t) => t.meta.declaration),
  };
}

function decl(name: string): FunctionDeclaration {
  return {
    name,
    description: 'stub',
    parameters: { type: 'OBJECT', properties: {} },
  };
}

interface Harness {
  readonly deps: AgentLoopDeps;
  readonly streamChunks: ReturnType<typeof vi.fn>;
  readonly store: AgentEventStore;
  readonly interrupts: InterruptService;
  readonly tokens: TokenAccountantService;
  readonly budget: BudgetService;
  readonly agents: AgentRegistry;
}

function makeHarness(opts: {
  readonly responses: readonly (readonly GeminiChunk[])[];
  readonly tools?: readonly ToolDef[];
  readonly customToolNames?: readonly string[];
  readonly allowToolSynthesis?: boolean;
  readonly now?: () => number;
}): Harness {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({});

  const store = TestBed.inject(AgentEventStore);
  const interrupts = TestBed.inject(InterruptService);
  const tokens = TestBed.inject(TokenAccountantService);
  const budget = TestBed.inject(BudgetService);
  const agents = TestBed.inject(AgentRegistry);
  budget.reset();

  const responses = [...opts.responses];
  const streamChunks = vi.fn(async (_req: StreamRoundRequest) => {
    const chunks = responses.shift();
    if (!chunks) throw new Error('streamChunks called more times than responses provided');
    return asAsync(chunks);
  });

  const customNames: ReadonlySet<string> = new Set(opts.customToolNames ?? []);
  const deps: AgentLoopDeps = {
    streamChunks,
    store,
    registry: makeRegistry(opts.tools ?? []),
    interrupts,
    tokenAccountant: tokens,
    budget,
    agents,
    customToolNames: () => customNames,
    allowToolSynthesis: () => opts.allowToolSynthesis ?? false,
    now: opts.now,
  };

  return { deps, streamChunks, store, interrupts, tokens, budget, agents };
}

async function drain(
  iter: AsyncIterable<AgentEvent>,
  signal?: AbortSignal,
): Promise<AgentEvent[]> {
  const events: AgentEvent[] = [];
  for await (const e of iter) {
    if (signal?.aborted) break;
    events.push(e);
  }
  return events;
}

const NOOP_OPTIONS = { model: 'gemini-3-test', thinkingConfig: { thinkingLevel: 'minimal' } };

// ---------------------------------------------------------------------------
// Specs
// ---------------------------------------------------------------------------

describe('runAgentTurn — happy path (text only)', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('emits turn_start → text → round_complete → turn_complete with no tool calls', async () => {
    const h = makeHarness({
      responses: [[thoughtChunk('considering…'), textChunk('Hello, world.'), finishChunk('STOP')]],
    });

    const events = await drain(
      runAgentTurn('Say hi', 't1', NOOP_OPTIONS, new AbortController().signal, h.deps),
    );

    const types = events.map((e) => e.type);
    expect(types[0]).toBe('turn_start');
    expect(types).toContain('thought_delta');
    expect(types).toContain('text_delta');
    expect(types.at(-2)).toBe('round_complete');
    expect(types.at(-1)).toBe('turn_complete');

    const turnComplete = events.at(-1) as Extract<AgentEvent, { type: 'turn_complete' }>;
    expect(turnComplete.rounds).toBe(1);
    expect(turnComplete.finishReason).toBe('STOP');
  });

  it('records the user prompt + model turn in raw history', async () => {
    const h = makeHarness({
      responses: [[textChunk('Reply text'), finishChunk('STOP')]],
    });

    await drain(
      runAgentTurn('Original prompt', 't1', NOOP_OPTIONS, new AbortController().signal, h.deps),
    );

    const history = h.store.rawHistory();
    expect(history).toHaveLength(2);
    expect(history[0].role).toBe('user');
    expect(history[1].role).toBe('model');
  });

  it('inlines attachments from a multimodal turn into the request contents', async () => {
    const h = makeHarness({
      responses: [[textChunk('I see a beach.'), finishChunk('STOP')]],
    });

    await drain(
      runAgentTurn(
        {
          text: 'What is this?',
          attachments: [
            {
              id: 'a1',
              kind: 'image',
              mimeType: 'image/jpeg',
              dataBase64: 'QUJD',
              sizeBytes: 3,
            },
          ],
        },
        't1',
        NOOP_OPTIONS,
        new AbortController().signal,
        h.deps,
      ),
    );

    const firstRequest = h.streamChunks.mock.calls[0][0] as StreamRoundRequest;
    const contents = firstRequest.contents as ReadonlyArray<{
      readonly role: string;
      readonly parts: readonly Record<string, unknown>[];
    }>;
    const userTurn = contents.find((c) => c.role === 'user');
    expect(userTurn?.parts).toEqual([
      { text: 'What is this?' },
      { inlineData: { mimeType: 'image/jpeg', data: 'QUJD' } },
    ]);
  });

  it('forwards usageMetadata to the TokenAccountantService', async () => {
    const h = makeHarness({
      responses: [
        [
          textChunk('text'),
          finishChunk('STOP', {
            promptTokenCount: 100,
            candidatesTokenCount: 50,
            thoughtsTokenCount: 25,
            totalTokenCount: 175,
          }),
        ],
      ],
    });

    await drain(
      runAgentTurn('Prompt', 't1', NOOP_OPTIONS, new AbortController().signal, h.deps),
    );

    const turn = h.tokens.currentTurn();
    expect(turn.rounds).toHaveLength(1);
    expect(turn.totals.totalTokens).toBe(175);
    expect(turn.rounds[0].finishReason).toBe('STOP');
  });
});

describe('runAgentTurn — tool execution', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('drives a single-round tool execution and appends tool responses to history', async () => {
    const execute = vi.fn(() => ({ flights: ['IndiGo 6E-101'] }));
    const tools: ToolDef[] = [
      {
        meta: {
          name: 'searchFlights',
          description: 'find flights',
          declaration: decl('searchFlights'),
          interruptive: false,
        },
        execute,
      },
    ];
    const h = makeHarness({
      tools,
      responses: [
        [toolChunk('searchFlights', { from: 'BLR', to: 'GOA' }), finishChunk('STOP')],
        [textChunk('Found flights.'), finishChunk('STOP')],
      ],
    });

    const events = await drain(
      runAgentTurn(
        'Find a flight',
        't1',
        NOOP_OPTIONS,
        new AbortController().signal,
        h.deps,
      ),
    );

    expect(execute).toHaveBeenCalledOnce();
    expect(execute).toHaveBeenCalledWith({ from: 'BLR', to: 'GOA' });

    const types = events.map((e) => e.type);
    expect(types).toContain('tool_call');
    expect(types).toContain('tool_result');
    expect(types.at(-1)).toBe('turn_complete');

    const history = h.store.rawHistory();
    expect(history.map((h) => h.role)).toEqual(['user', 'model', 'tool', 'model']);
  });

  it('runs two rounds when the first round emits a tool call', async () => {
    const tools: ToolDef[] = [
      {
        meta: {
          name: 'searchFlights',
          description: 'find flights',
          declaration: decl('searchFlights'),
          interruptive: false,
        },
        execute: () => ({ flights: ['IndiGo'] }),
      },
    ];
    const h = makeHarness({
      tools,
      responses: [
        [
          textChunk('Searching…'),
          toolChunk('searchFlights', { from: 'BLR', to: 'GOA' }),
          finishChunk('STOP'),
        ],
        [textChunk('Here are the options.'), finishChunk('STOP')],
      ],
    });

    const events = await drain(
      runAgentTurn(
        'Find a flight',
        't1',
        NOOP_OPTIONS,
        new AbortController().signal,
        h.deps,
      ),
    );

    const roundCompletes = events.filter((e) => e.type === 'round_complete');
    expect(roundCompletes).toHaveLength(2);
    expect(h.streamChunks).toHaveBeenCalledTimes(2);

    const turnComplete = events.at(-1) as Extract<AgentEvent, { type: 'turn_complete' }>;
    expect(turnComplete.rounds).toBe(2);
  });
});

describe('runAgentTurn — interrupts', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('emits interrupt_request before the executor runs for interruptive tools', async () => {
    const execute = vi.fn(() => ({ confirmation: 'CONF-42' }));
    const tools: ToolDef[] = [
      {
        meta: {
          name: 'bookFlight',
          description: 'book',
          declaration: decl('bookFlight'),
          interruptive: true,
          interruptReason: 'Confirm before booking.',
        },
        execute,
      },
    ];
    const h = makeHarness({
      tools,
      responses: [
        [toolChunk('bookFlight', { flightId: 'f1' }), finishChunk('STOP')],
        [textChunk('Booked.'), finishChunk('STOP')],
      ],
    });

    const eventsPromise = drain(
      runAgentTurn(
        'Book it',
        't1',
        NOOP_OPTIONS,
        new AbortController().signal,
        h.deps,
      ),
    );

    // Resolve the interrupt asynchronously so the loop can progress.
    await vi.waitFor(() => expect(h.interrupts.hasPending()).toBe(true));
    const callId = h.interrupts.pendingIds()[0];
    h.interrupts.decide(callId, { kind: 'approve' });

    const events = await eventsPromise;
    const types = events.map((e) => e.type);

    const interruptIdx = types.indexOf('interrupt_request');
    const resolvedIdx = types.indexOf('interrupt_resolved');
    const resultIdx = types.indexOf('tool_result');

    expect(interruptIdx).toBeGreaterThan(-1);
    expect(resolvedIdx).toBeGreaterThan(interruptIdx);
    expect(resultIdx).toBeGreaterThan(resolvedIdx);
    expect(execute).toHaveBeenCalledOnce();
  });
});

describe('runAgentTurn — budget guard', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('terminates with BUDGET_EXCEEDED:rounds when round limit is reached', async () => {
    const tools: ToolDef[] = [
      {
        meta: {
          name: 'searchFlights',
          description: 'find',
          declaration: decl('searchFlights'),
          interruptive: false,
        },
        execute: () => ({ ok: true }),
      },
    ];
    const h = makeHarness({
      tools,
      responses: [
        // Round 0: a tool call (will get a usage record so roundsUsed becomes 1)
        [toolChunk('searchFlights', {}), finishChunk('STOP')],
        // Round 1 should never start because the budget check trips first.
      ],
    });
    h.budget.update({ maxRounds: 1 });

    const events = await drain(
      runAgentTurn(
        'Find',
        't1',
        NOOP_OPTIONS,
        new AbortController().signal,
        h.deps,
      ),
    );

    const turnComplete = events.at(-1) as Extract<AgentEvent, { type: 'turn_complete' }>;
    expect(turnComplete.type).toBe('turn_complete');
    expect(turnComplete.finishReason).toBe('BUDGET_EXCEEDED:rounds');
    expect(h.streamChunks).toHaveBeenCalledTimes(1);
  });

  it('terminates with BUDGET_EXCEEDED:tokens when token limit is reached', async () => {
    const tools: ToolDef[] = [
      {
        meta: {
          name: 'searchFlights',
          description: 'find',
          declaration: decl('searchFlights'),
          interruptive: false,
        },
        execute: () => ({ ok: true }),
      },
    ];
    const h = makeHarness({
      tools,
      responses: [
        [
          toolChunk('searchFlights', {}),
          finishChunk('STOP', { totalTokenCount: 9999 }),
        ],
      ],
    });
    h.budget.update({ maxTokens: 100 });

    const events = await drain(
      runAgentTurn(
        'Find',
        't1',
        NOOP_OPTIONS,
        new AbortController().signal,
        h.deps,
      ),
    );

    const turnComplete = events.at(-1) as Extract<AgentEvent, { type: 'turn_complete' }>;
    expect(turnComplete.finishReason).toBe('BUDGET_EXCEEDED:tokens');
  });
});

describe('runAgentTurn — max rounds termination', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('terminates with MAX_AGENT_ROUNDS after 8 tool-call rounds', async () => {
    const tools: ToolDef[] = [
      {
        meta: {
          name: 'searchFlights',
          description: 'find',
          declaration: decl('searchFlights'),
          interruptive: false,
        },
        execute: () => ({ ok: true }),
      },
    ];
    // 8 rounds, every one returns another tool call. Loop should bail out.
    const oneRound = () => [toolChunk('searchFlights', {}), finishChunk('STOP')];
    const h = makeHarness({
      tools,
      responses: Array.from({ length: 8 }, oneRound),
    });

    const events = await drain(
      runAgentTurn(
        'Spin',
        't1',
        NOOP_OPTIONS,
        new AbortController().signal,
        h.deps,
      ),
    );

    const turnComplete = events.at(-1) as Extract<AgentEvent, { type: 'turn_complete' }>;
    expect(turnComplete.finishReason).toBe('MAX_AGENT_ROUNDS');
    expect(turnComplete.rounds).toBe(8);
    expect(h.streamChunks).toHaveBeenCalledTimes(8);
  });
});

describe('runAgentTurn — handoff', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('emits agent_handoff and switches the active agent', async () => {
    const tools: ToolDef[] = [
      {
        meta: {
          name: HANDOFF_TOOL_NAME,
          description: 'handoff',
          declaration: decl(HANDOFF_TOOL_NAME),
          interruptive: false,
        },
        execute: () => ({ ok: true }),
      },
    ];
    const h = makeHarness({
      tools,
      responses: [
        [
          toolChunk(HANDOFF_TOOL_NAME, {
            specialist: 'experienceCurator',
            reason: 'User asked for activities.',
          }),
          finishChunk('STOP'),
        ],
        [textChunk('On it!'), finishChunk('STOP')],
      ],
    });

    const events = await drain(
      runAgentTurn(
        'Find activities',
        't1',
        NOOP_OPTIONS,
        new AbortController().signal,
        h.deps,
      ),
    );

    const handoff = events.find((e) => e.type === 'agent_handoff') as
      | Extract<AgentEvent, { type: 'agent_handoff' }>
      | undefined;
    expect(handoff).toBeDefined();
    expect(handoff?.fromAgentId).toBe('tripPlanner');
    expect(handoff?.toAgentId).toBe('experienceCurator');
    expect(h.agents.activeAgentId()).toBe('experienceCurator');
  });
});

describe('runAgentTurn — abort', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('throws AbortError mid-stream when the signal is aborted', async () => {
    const controller = new AbortController();
    const h = makeHarness({
      responses: [
        [
          {
            // Chunk that aborts the signal as part of consuming it.
            get candidates() {
              controller.abort();
              return [
                { content: { role: 'model' as const, parts: [{ text: 'partial' }] } },
              ];
            },
          } as GeminiChunk,
          finishChunk('STOP'),
        ],
      ],
    });

    await expect(
      drain(runAgentTurn('Hi', 't1', NOOP_OPTIONS, controller.signal, h.deps)),
    ).rejects.toThrow(/Abort/);
  });
});

describe('runAgentTurn — error propagation', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('propagates errors thrown by streamChunks', async () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({});
    const deps: AgentLoopDeps = {
      streamChunks: vi.fn(async () => {
        throw new Error('boom');
      }),
      store: TestBed.inject(AgentEventStore),
      registry: makeRegistry([]),
      interrupts: TestBed.inject(InterruptService),
      tokenAccountant: TestBed.inject(TokenAccountantService),
      budget: TestBed.inject(BudgetService),
      agents: TestBed.inject(AgentRegistry),
    };
    await expect(
      drain(runAgentTurn('Hi', 't1', NOOP_OPTIONS, new AbortController().signal, deps)),
    ).rejects.toThrow('boom');
  });

  it('begins the turn and emits turn_start even when the SDK call fails', async () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({});
    const store = TestBed.inject(AgentEventStore);
    const deps: AgentLoopDeps = {
      streamChunks: vi.fn(async () => {
        throw new Error('boom');
      }),
      store,
      registry: makeRegistry([]),
      interrupts: TestBed.inject(InterruptService),
      tokenAccountant: TestBed.inject(TokenAccountantService),
      budget: TestBed.inject(BudgetService),
      agents: TestBed.inject(AgentRegistry),
    };

    const events: AgentEvent[] = [];
    try {
      for await (const e of runAgentTurn(
        'Hi',
        't1',
        NOOP_OPTIONS,
        new AbortController().signal,
        deps,
      )) {
        events.push(e);
      }
    } catch {
      // expected
    }

    expect(events[0]?.type).toBe('turn_start');
    expect(store.rawHistory().map((h) => h.role)).toEqual(['user']);
  });
});

describe('runAgentTurn — agent-aware declarations', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('only passes tools that the active agent is allowed to use', async () => {
    const tools: ToolDef[] = [
      {
        meta: {
          name: 'searchFlights',
          description: 'find',
          declaration: decl('searchFlights'),
          interruptive: false,
        },
        execute: () => ({}),
      },
      {
        meta: {
          name: 'findActivities',
          description: 'find activities',
          declaration: decl('findActivities'),
          interruptive: false,
        },
        execute: () => ({}),
      },
      {
        meta: {
          name: HANDOFF_TOOL_NAME,
          description: 'handoff',
          declaration: decl(HANDOFF_TOOL_NAME),
          interruptive: false,
        },
        execute: () => ({}),
      },
    ];
    const h = makeHarness({
      tools,
      responses: [[textChunk('hi'), finishChunk('STOP')]],
    });

    await drain(
      runAgentTurn('Hi', 't1', NOOP_OPTIONS, new AbortController().signal, h.deps),
    );

    expect(h.streamChunks).toHaveBeenCalledOnce();
    const req = h.streamChunks.mock.calls[0][0] as StreamRoundRequest;
    const passed = req.config.tools?.[0].functionDeclarations as readonly { name: string }[];
    const names = passed.map((d) => d.name).sort();
    // tripPlanner gets its own tools + handoff; should NOT include findActivities.
    expect(names).toContain('searchFlights');
    expect(names).toContain(HANDOFF_TOOL_NAME);
    expect(names).not.toContain('findActivities');
  });

  it('exposes user-defined custom tools to every agent, regardless of the built-in allow-list', async () => {
    const tools: ToolDef[] = [
      {
        meta: {
          name: 'searchFlights',
          description: 'find',
          declaration: decl('searchFlights'),
          interruptive: false,
        },
        execute: () => ({}),
      },
      {
        meta: {
          name: 'searchWeather',
          description: 'user-defined weather lookup',
          declaration: decl('searchWeather'),
          interruptive: false,
        },
        execute: () => ({}),
      },
    ];
    const h = makeHarness({
      tools,
      customToolNames: ['searchWeather'],
      responses: [[textChunk('hi'), finishChunk('STOP')]],
    });

    await drain(
      runAgentTurn('Hi', 't1', NOOP_OPTIONS, new AbortController().signal, h.deps),
    );

    const req = h.streamChunks.mock.calls[0][0] as StreamRoundRequest;
    const passed = req.config.tools?.[0].functionDeclarations as readonly { name: string }[];
    const names = passed.map((d) => d.name);
    expect(names).toContain('searchFlights');
    expect(names).toContain('searchWeather');
  });
});

describe('runAgentTurn — tool synthesis gating', () => {
  afterEach(() => TestBed.resetTestingModule());

  function proposeTool(): ToolDef {
    return {
      meta: {
        name: PROPOSE_TOOL_NAME,
        description: 'propose a new tool',
        declaration: decl(PROPOSE_TOOL_NAME),
        interruptive: false,
      },
      execute: () => ({ status: 'registered' }),
    };
  }

  function declaredNames(h: Harness, callIndex: number): readonly string[] {
    const req = h.streamChunks.mock.calls[callIndex][0] as StreamRoundRequest;
    const passed = req.config.tools?.[0].functionDeclarations as
      | readonly { name: string }[]
      | undefined;
    return (passed ?? []).map((d) => d.name);
  }

  it('does not offer proposeTool when synthesis is disabled', async () => {
    const h = makeHarness({
      tools: [proposeTool()],
      allowToolSynthesis: false,
      responses: [[textChunk('hi'), finishChunk('STOP')]],
    });

    await drain(runAgentTurn('Hi', 't1', NOOP_OPTIONS, new AbortController().signal, h.deps));

    expect(declaredNames(h, 0)).not.toContain(PROPOSE_TOOL_NAME);
  });

  it('offers proposeTool when synthesis is enabled', async () => {
    const h = makeHarness({
      tools: [proposeTool()],
      allowToolSynthesis: true,
      responses: [[textChunk('hi'), finishChunk('STOP')]],
    });

    await drain(runAgentTurn('Hi', 't1', NOOP_OPTIONS, new AbortController().signal, h.deps));

    expect(declaredNames(h, 0)).toContain(PROPOSE_TOOL_NAME);
  });

  it('appends the synthesis clause to the system prompt only when enabled', async () => {
    const on = makeHarness({
      tools: [proposeTool()],
      allowToolSynthesis: true,
      responses: [[textChunk('hi'), finishChunk('STOP')]],
    });
    await drain(runAgentTurn('Hi', 't1', NOOP_OPTIONS, new AbortController().signal, on.deps));
    const onReq = on.streamChunks.mock.calls[0][0] as StreamRoundRequest;
    expect(onReq.config.systemInstruction).toContain(TOOL_SYNTHESIS_CLAUSE);

    const off = makeHarness({
      tools: [proposeTool()],
      allowToolSynthesis: false,
      responses: [[textChunk('hi'), finishChunk('STOP')]],
    });
    await drain(runAgentTurn('Hi', 't2', NOOP_OPTIONS, new AbortController().signal, off.deps));
    const offReq = off.streamChunks.mock.calls[0][0] as StreamRoundRequest;
    expect(offReq.config.systemInstruction).not.toContain(TOOL_SYNTHESIS_CLAUSE);
  });

  it('stops offering proposeTool once the per-turn cap is reached', async () => {
    // One proposal per round until the cap; a final text-only round ends the turn.
    const proposalRound = () => [toolChunk(PROPOSE_TOOL_NAME, { name: 'x' }), finishChunk('STOP')];
    const responses = [
      ...Array.from({ length: MAX_TOOL_SYNTHESIS_PER_TURN }, proposalRound),
      [textChunk('done'), finishChunk('STOP')],
    ];
    const h = makeHarness({
      tools: [proposeTool()],
      allowToolSynthesis: true,
      responses,
    });

    await drain(runAgentTurn('Make tools', 't1', NOOP_OPTIONS, new AbortController().signal, h.deps));

    // Every round up to the cap offers proposeTool…
    for (let round = 0; round < MAX_TOOL_SYNTHESIS_PER_TURN; round++) {
      expect(declaredNames(h, round)).toContain(PROPOSE_TOOL_NAME);
    }
    // …but the round after the cap no longer does.
    expect(declaredNames(h, MAX_TOOL_SYNTHESIS_PER_TURN)).not.toContain(PROPOSE_TOOL_NAME);
  });
});
