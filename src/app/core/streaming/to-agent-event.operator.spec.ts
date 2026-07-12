import { describe, expect, it } from 'vitest';
import {
  chunkToEvents,
  initialStreamState,
  type GeminiChunk,
} from './to-agent-event.operator';
import type { AgentEvent } from './agent-event';

const TURN = 't1';

function feed(chunks: readonly GeminiChunk[]): readonly AgentEvent[] {
  let state = initialStreamState(TURN);
  const all: AgentEvent[] = [];
  for (const c of chunks) {
    const out = chunkToEvents(c, state);
    state = out.state;
    all.push(...out.events);
  }
  return all;
}

describe('chunkToEvents — part classification', () => {
  it('emits thought_delta for a part with thought=true and text', () => {
    const events = feed([
      { candidates: [{ content: { parts: [{ text: '**Reasoning…**', thought: true }] } }] },
    ]);
    expect(events).toEqual([
      expect.objectContaining({ type: 'thought_delta', chunk: '**Reasoning…**', turnId: TURN }),
    ]);
  });

  it('emits tool_call for a functionCall part (args delivered whole, no partial JSON)', () => {
    const events = feed([
      {
        candidates: [
          {
            content: {
              parts: [
                {
                  functionCall: {
                    name: 'searchFlights',
                    args: { from: 'Bengaluru', to: 'Goa', date: '2024-05-17', passengers: 2 },
                  },
                },
              ],
            },
          },
        ],
      },
    ]);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: 'tool_call',
      name: 'searchFlights',
      args: { from: 'Bengaluru', to: 'Goa', date: '2024-05-17', passengers: 2 },
      turnId: TURN,
    });
  });

  it('emits text_delta for non-empty visible text', () => {
    const events = feed([
      { candidates: [{ content: { parts: [{ text: 'There is no missing dollar' }] } }] },
    ]);
    expect(events).toEqual([
      expect.objectContaining({ type: 'text_delta', chunk: 'There is no missing dollar' }),
    ]);
  });

  it('emits NO event for empty-text parts (load-bearing only in raw history)', () => {
    const events = feed([
      { candidates: [{ content: { parts: [{ text: '', thoughtSignature: 'SIG' }] } }] },
    ]);
    expect(events).toEqual([]);
  });

  it('emits NO event for an unknown part shape (defensive)', () => {
    const events = feed([
      { candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png' } } as never] } }] },
    ]);
    expect(events).toEqual([]);
  });
});

describe('chunkToEvents — turn lifecycle', () => {
  it('emits thought_complete when a non-thought part follows thoughts', () => {
    const events = feed([
      { candidates: [{ content: { parts: [{ text: 'thinking…', thought: true }] } }] },
      { candidates: [{ content: { parts: [{ text: 'final answer' }] } }] },
    ]);
    expect(events.map((e) => e.type)).toEqual(['thought_delta', 'thought_complete', 'text_delta']);
  });

  it('emits thought_complete + round_complete when stream ends inside a thought block', () => {
    const events = feed([
      {
        candidates: [
          {
            content: { parts: [{ text: 'thinking…', thought: true }] },
            finishReason: 'STOP',
          },
        ],
      },
    ]);
    expect(events.map((e) => e.type)).toEqual([
      'thought_delta',
      'thought_complete',
      'round_complete',
    ]);
    expect(events.at(-1)).toMatchObject({
      type: 'round_complete',
      roundIndex: 0,
      finishReason: 'STOP',
    });
  });

  it('emits round_complete exactly once even if finishReason re-appears (defensive)', () => {
    let state = initialStreamState(TURN);
    const first = chunkToEvents(
      {
        candidates: [
          { content: { parts: [{ text: 'done' }] }, finishReason: 'STOP' },
        ],
      },
      state,
    );
    state = first.state;
    const second = chunkToEvents(
      { candidates: [{ content: { parts: [] }, finishReason: 'STOP' }] },
      state,
    );
    const total = [...first.events, ...second.events].filter(
      (e) => e.type === 'round_complete',
    );
    expect(total).toHaveLength(1);
  });

  it('ignores parts that arrive after the round was finalized (M4)', () => {
    let state = initialStreamState(TURN);
    const first = chunkToEvents(
      { candidates: [{ content: { parts: [{ text: 'done' }] }, finishReason: 'STOP' }] },
      state,
    );
    state = first.state;
    // A late chunk carrying a tool call after finishReason must NOT emit a
    // tool_call (it would land after round_complete and break settlement order).
    const late = chunkToEvents(
      {
        candidates: [
          { content: { parts: [{ functionCall: { name: 'searchFlights', args: {} } }] } },
        ],
      },
      state,
    );
    expect(late.events).toEqual([]);
    const toolCalls = [...first.events, ...late.events].filter((e) => e.type === 'tool_call');
    expect(toolCalls).toHaveLength(0);
  });
});

describe('chunkToEvents — malformed tool call (L1)', () => {
  it('emits a nameless functionCall with an empty name (settled downstream)', () => {
    const events = feed([
      { candidates: [{ content: { parts: [{ functionCall: { args: { q: 1 } } }] } }] },
    ]);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'tool_call', name: '', args: { q: 1 } });
  });
});

describe('chunkToEvents — Scenario B fixture (thinking + parallel tool calls)', () => {
  // Shape replayed from spike/findings.md Scenario B: 2 thoughts, then 3
  // parallel tool calls, then an empty-text part, then finishReason=STOP.
  const scenarioB: readonly GeminiChunk[] = [
    { candidates: [{ content: { parts: [{ text: '**Defining the Objective**…', thought: true }] } }] },
    { candidates: [{ content: { parts: [{ text: '**Pinpointing Key Dates**…', thought: true }] } }] },
    {
      candidates: [
        {
          content: {
            parts: [
              {
                functionCall: {
                  name: 'searchFlights',
                  args: { from: 'Bengaluru', to: 'Goa', date: '2024-05-17', passengers: 2 },
                },
                thoughtSignature: 'SIG_2800CH',
              },
            ],
          },
        },
      ],
    },
    {
      candidates: [
        {
          content: {
            parts: [
              {
                functionCall: {
                  name: 'searchFlights',
                  args: { from: 'Goa', to: 'Bengaluru', date: '2024-05-19', passengers: 2 },
                },
              },
            ],
          },
        },
      ],
    },
    {
      candidates: [
        {
          content: {
            parts: [
              {
                functionCall: {
                  name: 'searchHotels',
                  args: {
                    city: 'Goa',
                    checkIn: '2024-05-17',
                    checkOut: '2024-05-19',
                    vegetarianFriendly: true,
                  },
                },
              },
            ],
          },
        },
      ],
    },
    {
      candidates: [
        { content: { parts: [{ text: '' }] }, finishReason: 'STOP' },
      ],
    },
  ];

  it('maps to: 2× thought_delta, thought_complete, 3× tool_call, round_complete', () => {
    const types = feed(scenarioB).map((e) => e.type);
    expect(types).toEqual([
      'thought_delta',
      'thought_delta',
      'thought_complete',
      'tool_call',
      'tool_call',
      'tool_call',
      'round_complete',
    ]);
  });

  it('preserves tool names and args verbatim from the SDK shape', () => {
    const toolCalls = feed(scenarioB).filter((e) => e.type === 'tool_call');
    expect(toolCalls.map((t) => (t.type === 'tool_call' ? t.name : ''))).toEqual([
      'searchFlights',
      'searchFlights',
      'searchHotels',
    ]);
    expect(toolCalls[2]).toMatchObject({
      type: 'tool_call',
      name: 'searchHotels',
      args: { city: 'Goa', vegetarianFriendly: true },
    });
  });

  it('assigns unique callIds in part order across chunks', () => {
    const toolCalls = feed(scenarioB).filter((e) => e.type === 'tool_call');
    const ids = toolCalls.map((t) => (t.type === 'tool_call' ? t.callId : ''));
    expect(new Set(ids).size).toBe(3);
    expect(ids[0]).toMatch(/^t1:\d+$/);
  });
});
