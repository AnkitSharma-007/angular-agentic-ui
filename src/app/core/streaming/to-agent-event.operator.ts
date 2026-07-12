import type { AgentEvent } from './agent-event';

// Local re-types of the subset of `GenerateContentResponse` we consume.
// Keeps the operator decoupled from `@google/genai` and trivially testable.

export interface GeminiPart {
  readonly text?: string;
  readonly thought?: boolean;
  readonly functionCall?: { readonly name?: string; readonly args?: unknown };
  readonly thoughtSignature?: string;
  readonly [key: string]: unknown;
}

export interface GeminiCandidate {
  readonly content?: { readonly role?: string; readonly parts?: readonly GeminiPart[] };
  readonly finishReason?: string;
}

export interface GeminiUsageMetadata {
  readonly promptTokenCount?: number;
  readonly candidatesTokenCount?: number;
  readonly thoughtsTokenCount?: number;
  readonly totalTokenCount?: number;
}

export interface GeminiChunk {
  readonly candidates?: readonly GeminiCandidate[];
  readonly usageMetadata?: GeminiUsageMetadata;
}

// `partIndex` stays monotonic across rounds so callIds remain unique within
// a turn; the rest of the state resets each round.
export interface StreamState {
  readonly turnId: string;
  readonly roundIndex: number;
  readonly partIndex: number;
  readonly inThoughtBlock: boolean;
  readonly finalized: boolean;
}

export function initialStreamState(turnId: string): StreamState {
  return {
    turnId,
    roundIndex: 0,
    partIndex: 0,
    inThoughtBlock: false,
    finalized: false,
  };
}

export function nextRoundState(state: StreamState): StreamState {
  return {
    turnId: state.turnId,
    roundIndex: state.roundIndex + 1,
    partIndex: state.partIndex,
    inThoughtBlock: false,
    finalized: false,
  };
}

export interface ChunkResult {
  readonly events: readonly AgentEvent[];
  readonly state: StreamState;
}

// Empty-text parts intentionally produce no UI event — they may carry a
// thoughtSignature blob that is only load-bearing in the raw Content[] view.
export function chunkToEvents(chunk: GeminiChunk, state: StreamState): ChunkResult {
  const events: AgentEvent[] = [];
  let { partIndex, inThoughtBlock, finalized } = state;
  const { turnId, roundIndex } = state;
  let finishReason: string | null = null;

  for (const candidate of chunk.candidates ?? []) {
    // M4: once a round is finalized (a finishReason arrived in an earlier
    // chunk), ignore any trailing candidates/parts. Out-of-order or duplicate
    // tail chunks would otherwise emit a tool_call — or any event — *after*
    // round_complete, violating timeline and settlement ordering.
    if (finalized) break;
    for (const part of candidate.content?.parts ?? []) {
      const callId = `${turnId}:${partIndex++}`;
      const ts = Date.now();
      const classification = classify(part);

      if (inThoughtBlock && classification !== 'thought') {
        events.push({ type: 'thought_complete', ts, turnId });
        inThoughtBlock = false;
      }

      switch (classification) {
        case 'thought': {
          events.push({ type: 'thought_delta', ts, turnId, chunk: part.text ?? '' });
          inThoughtBlock = true;
          break;
        }
        case 'tool': {
          const fc = part.functionCall!;
          // L1: a nameless functionCall can't map to a tool. Emit it with an
          // empty name so the settlement layer fails it cleanly with a
          // synthetic error instead of round-tripping through the registry.
          events.push({
            type: 'tool_call',
            ts,
            turnId,
            callId,
            name: fc.name ?? '',
            args: toArgs(fc.args),
          });
          break;
        }
        case 'text': {
          events.push({ type: 'text_delta', ts, turnId, chunk: part.text ?? '' });
          break;
        }
        case 'empty':
        case 'unknown':
          break;
      }
    }

    if (candidate.finishReason) {
      finishReason = candidate.finishReason;
    }
  }

  if (finishReason && !finalized) {
    const ts = Date.now();
    if (inThoughtBlock) {
      events.push({ type: 'thought_complete', ts, turnId });
      inThoughtBlock = false;
    }
    events.push({ type: 'round_complete', ts, turnId, roundIndex, finishReason });
    finalized = true;
  }

  return {
    events,
    state: { turnId, roundIndex, partIndex, inThoughtBlock, finalized },
  };
}

type Classification = 'thought' | 'tool' | 'text' | 'empty' | 'unknown';

function classify(part: GeminiPart): Classification {
  if (part.thought === true && typeof part.text === 'string') return 'thought';
  if (part.functionCall) return 'tool';
  if (typeof part.text === 'string') return part.text.length === 0 ? 'empty' : 'text';
  return 'unknown';
}

function toArgs(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}
