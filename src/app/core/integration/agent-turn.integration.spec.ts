import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { runAgentTurn, type AgentLoopDeps } from '../services/agent-loop';
import type { AgentEvent } from '../streaming/agent-event';
import { AgentEventStore } from '../streaming/agent-event.store';
import type { GeminiChunk } from '../streaming/to-agent-event.operator';
import { InterruptService } from '../registry/interrupt.service';
import { ToolRegistry } from '../registry/tool-registry';
import { TokenAccountantService } from '../observability/token-accountant.service';
import { BudgetService } from '../observability/budget.service';
import { AgentRegistry } from '../agents/agent-registry.service';
import type { ToolDescriptor } from '../registry/tool-descriptor';
import { asAsync } from '../../testing/gemini-chunks';

// Full-stack integration test. Wires the real `runAgentTurn`, the real
// `ToolRegistry`, real services — only the SDK stream is faked. The fixture
// drives a complete two-round turn end-to-end: thinking → text → tool_call →
// settle → second-round text → finish.

const FIXTURE_USAGE = {
  promptTokenCount: 120,
  candidatesTokenCount: 80,
  thoughtsTokenCount: 40,
  totalTokenCount: 240,
};

const SECOND_ROUND_USAGE = {
  promptTokenCount: 90,
  candidatesTokenCount: 30,
  thoughtsTokenCount: 5,
  totalTokenCount: 125,
};

const FIRST_ROUND: readonly GeminiChunk[] = [
  {
    candidates: [
      {
        content: {
          role: 'model',
          parts: [{ text: 'Routing flights search…', thought: true }],
        },
      },
    ],
  },
  {
    candidates: [
      { content: { role: 'model', parts: [{ text: 'Looking up direct options.' }] } },
    ],
  },
  {
    candidates: [
      {
        content: {
          role: 'model',
          parts: [
            {
              functionCall: {
                name: 'searchFlights',
                args: { from: 'BLR', to: 'GOA', date: '2026-06-15', passengers: 2 },
              },
            },
          ],
        },
      },
    ],
  },
  {
    candidates: [{ content: { role: 'model', parts: [] }, finishReason: 'STOP' }],
    usageMetadata: FIRST_ROUND_USAGE_PLACEHOLDER(),
  },
];

const SECOND_ROUND: readonly GeminiChunk[] = [
  {
    candidates: [
      {
        content: {
          role: 'model',
          parts: [{ text: 'Four options found. Cheapest is Akasa Air at ₹4715.' }],
        },
      },
    ],
  },
  {
    candidates: [{ content: { role: 'model', parts: [] }, finishReason: 'STOP' }],
    usageMetadata: SECOND_ROUND_USAGE,
  },
];

function FIRST_ROUND_USAGE_PLACEHOLDER() {
  return FIXTURE_USAGE;
}

interface FixtureExecutor {
  readonly fn: (args: unknown) => void;
  readonly result: Record<string, unknown>;
}

function makeStubFlightDescriptor(executor: {
  fn: (args: unknown) => void;
  result: Record<string, unknown>;
}): ToolDescriptor {
  return {
    name: 'searchFlights',
    description: 'stub',
    declaration: {
      name: 'searchFlights',
      description: 'stub',
      parameters: {
        type: 'OBJECT',
        properties: {
          from: { type: 'STRING' },
          to: { type: 'STRING' },
          date: { type: 'STRING' },
          passengers: { type: 'INTEGER' },
        },
        required: ['from', 'to', 'date', 'passengers'],
      },
    },
    argsSchema: z.object({
      from: z.string().min(2),
      to: z.string().min(2),
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      passengers: z.number().int().min(1).max(9),
    }),
    component: null as unknown as ToolDescriptor['component'],
    async execute(args) {
      executor.fn(args);
      return executor.result;
    },
  };
}

describe('runAgentTurn — end-to-end integration', () => {
  let deps: AgentLoopDeps;
  let store: AgentEventStore;
  let tokens: TokenAccountantService;
  let registry: ToolRegistry;
  let agents: AgentRegistry;
  let streamChunks: AgentLoopDeps['streamChunks'] & { mock: { calls: unknown[][] } };
  let executor: {
    fn: ((args: unknown) => void) & { calls: unknown[] };
    result: Record<string, unknown>;
  };

  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({});
    store = TestBed.inject(AgentEventStore);
    tokens = TestBed.inject(TokenAccountantService);
    registry = TestBed.inject(ToolRegistry);
    agents = TestBed.inject(AgentRegistry);
    const interrupts = TestBed.inject(InterruptService);
    const budget = TestBed.inject(BudgetService);
    budget.reset();

    const executorCalls: unknown[] = [];
    const executorFn = ((args: unknown) => {
      executorCalls.push(args);
    }) as ((args: unknown) => void) & { calls: unknown[] };
    executorFn.calls = executorCalls;
    executor = {
      fn: executorFn,
      result: {
        flights: [
          {
            id: 'akasa-2026-06-15-3',
            airline: 'Akasa Air',
            price: { amount: 4715, currency: 'INR' },
          },
        ],
        source: 'mock',
      },
    };
    const descriptor = makeStubFlightDescriptor(executor);

    registry.register({
      ...descriptor,
      load: async () => descriptor,
    });

    const responses = [FIRST_ROUND, SECOND_ROUND];
    const calls: unknown[][] = [];
    const streamFn = (async (req: unknown) => {
      calls.push([req]);
      return asAsync(responses.shift()!);
    }) as AgentLoopDeps['streamChunks'] & { mock: { calls: unknown[][] } };
    streamFn.mock = { calls };
    streamChunks = streamFn;

    deps = {
      streamChunks,
      store,
      registry,
      interrupts,
      tokenAccountant: tokens,
      budget,
      agents,
    };
  });

  afterEach(() => TestBed.resetTestingModule());

  it('emits the full event timeline in the expected order', async () => {
    const events: AgentEvent[] = [];
    for await (const e of runAgentTurn(
      'Find flights BLR→GOA on 2026-06-15 for two.',
      'turn-1',
      { model: 'gemini-3-flash-preview', thinkingConfig: { thinkingLevel: 'high' } },
      new AbortController().signal,
      deps,
    )) {
      events.push(e);
    }

    const types = events.map((e) => e.type);
    const expectedSequence = [
      'turn_start',
      'thought_delta',
      'thought_complete',
      'text_delta',
      'tool_call',
      'round_complete',
      'tool_result',
      'text_delta',
      'round_complete',
      'turn_complete',
    ];
    expect(types).toEqual(expectedSequence);
  });

  it('updates the raw history with user → model → tool → model in order', async () => {
    for await (const _ of runAgentTurn(
      'Find flights BLR→GOA on 2026-06-15 for two.',
      'turn-1',
      { model: 'gemini-3-flash-preview', thinkingConfig: { thinkingLevel: 'high' } },
      new AbortController().signal,
      deps,
    )) {
      // drain
    }

    const history = store.rawHistory();
    expect(history.map((h) => h.role)).toEqual(['user', 'model', 'tool', 'model']);

    const toolEntry = history[2];
    expect(toolEntry.parts).toHaveLength(1);
    const toolPart = toolEntry.parts[0] as {
      functionResponse?: { name?: string; response?: Record<string, unknown> };
    };
    expect(toolPart.functionResponse?.name).toBe('searchFlights');
    expect(toolPart.functionResponse?.response).toEqual(executor.result);
  });

  it('records both rounds in the TokenAccountantService with the fixture usage', async () => {
    for await (const _ of runAgentTurn(
      'Find flights BLR→GOA on 2026-06-15 for two.',
      'turn-1',
      { model: 'gemini-3-flash-preview', thinkingConfig: { thinkingLevel: 'high' } },
      new AbortController().signal,
      deps,
    )) {
      // drain
    }

    const turn = tokens.currentTurn();
    expect(turn.rounds).toHaveLength(2);
    expect(turn.rounds[0].usage.totalTokens).toBe(240);
    expect(turn.rounds[1].usage.totalTokens).toBe(125);
    expect(turn.totals.totalTokens).toBe(365);
  });

  it('calls the executor exactly once with the function-call args', async () => {
    for await (const _ of runAgentTurn(
      'Find flights BLR→GOA on 2026-06-15 for two.',
      'turn-1',
      { model: 'gemini-3-flash-preview', thinkingConfig: { thinkingLevel: 'high' } },
      new AbortController().signal,
      deps,
    )) {
      // drain
    }

    expect(executor.fn.calls).toHaveLength(1);
    expect(executor.fn.calls[0]).toEqual({
      from: 'BLR',
      to: 'GOA',
      date: '2026-06-15',
      passengers: 2,
    });
  });

  it('hits the SDK twice — one call per round', async () => {
    for await (const _ of runAgentTurn(
      'Find flights BLR→GOA on 2026-06-15 for two.',
      'turn-1',
      { model: 'gemini-3-flash-preview', thinkingConfig: { thinkingLevel: 'high' } },
      new AbortController().signal,
      deps,
    )) {
      // drain
    }

    expect(streamChunks.mock.calls).toHaveLength(2);
  });

  it('passes the conversation history forward on the second round (post-tool follow-up)', async () => {
    for await (const _ of runAgentTurn(
      'Find flights BLR→GOA on 2026-06-15 for two.',
      'turn-1',
      { model: 'gemini-3-flash-preview', thinkingConfig: { thinkingLevel: 'high' } },
      new AbortController().signal,
      deps,
    )) {
      // drain
    }

    // The second call's `contents` should include the tool response from round 1.
    const secondCall = streamChunks.mock.calls[1][0] as {
      contents: ReadonlyArray<{ role: string }>;
    };
    expect(secondCall.contents.map((c) => c.role)).toEqual([
      'user',
      'model',
      'tool',
    ]);
  });
});
