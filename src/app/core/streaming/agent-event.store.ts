import { Injectable, computed, signal } from '@angular/core';
import type { AgentEvent } from './agent-event';
import { appendChunkToContent, type HistoryContent } from './raw-history.reducer';
import type { GeminiChunk } from './to-agent-event.operator';

export type StreamPhase =
  | 'idle'
  | 'streaming'
  | 'replaying'
  | 'complete'
  | 'cancelled'
  | 'error';

export type ToolCallStatus =
  | 'pending_approval'
  | 'running'
  | 'complete'
  | 'error'
  | 'rejected';

export interface ToolCallState {
  readonly callId: string;
  readonly name: string;
  readonly args: Record<string, unknown>;
  readonly result: Record<string, unknown> | null;
  readonly errorMessage: string | null;
  readonly interruptReason: string | null;
  readonly status: ToolCallStatus;
  readonly startedAt: number;
  readonly completedAt: number | null;
}

export interface CurrentTurn {
  readonly id: string;
  readonly thoughtText: string;
  readonly responseText: string;
  readonly toolCalls: readonly ToolCallState[];
  readonly rounds: number;
  readonly startedAt: number;
  readonly finishReason: string | null;
}

const EMPTY_TURN: CurrentTurn = {
  id: '',
  thoughtText: '',
  responseText: '',
  toolCalls: [],
  rounds: 0,
  startedAt: 0,
  finishReason: null,
};

// Dual-view turn state: `events` (typed AgentEvents for the UI) plus
// `rawHistory` (Gemini `Content[]` with thoughtSignature blobs preserved).
@Injectable({ providedIn: 'root' })
export class AgentEventStore {
  private readonly _events = signal<readonly AgentEvent[]>([]);
  private readonly _rawHistory = signal<readonly HistoryContent[]>([]);
  private readonly _currentTurn = signal<CurrentTurn>(EMPTY_TURN);
  private readonly _phase = signal<StreamPhase>('idle');
  private readonly _error = signal<string | null>(null);
  private readonly _stats = signal({ chunks: 0, parts: 0, signedParts: 0 });

  readonly events = this._events.asReadonly();
  readonly rawHistory = this._rawHistory.asReadonly();
  readonly currentTurn = this._currentTurn.asReadonly();
  readonly phase = this._phase.asReadonly();
  readonly error = this._error.asReadonly();
  readonly stats = this._stats.asReadonly();

  readonly thoughtText = computed(() => this._currentTurn().thoughtText);
  readonly responseText = computed(() => this._currentTurn().responseText);
  readonly toolCalls = computed(() => this._currentTurn().toolCalls);
  readonly isStreaming = computed(() => {
    const p = this._phase();
    return p === 'streaming' || p === 'replaying';
  });
  readonly isReplaying = computed(() => this._phase() === 'replaying');
  readonly hasOutput = computed(() => {
    const t = this._currentTurn();
    return t.thoughtText.length > 0 || t.responseText.length > 0 || t.toolCalls.length > 0;
  });

  beginTurn(turnId: string, phase: 'streaming' | 'replaying' = 'streaming'): void {
    this._phase.set(phase);
    this._error.set(null);
    this._stats.set({ chunks: 0, parts: 0, signedParts: 0 });
    this._currentTurn.set({
      id: turnId,
      thoughtText: '',
      responseText: '',
      toolCalls: [],
      rounds: 0,
      startedAt: Date.now(),
      finishReason: null,
    });
  }

  loadRawHistory(history: readonly HistoryContent[]): void {
    this._rawHistory.set(history);
  }

  pushEvent(event: AgentEvent): void {
    this._events.update((list) => [...list, event]);
    switch (event.type) {
      case 'thought_delta':
        this.updateCurrentTurn((t) => ({ ...t, thoughtText: t.thoughtText + event.chunk }));
        break;
      case 'text_delta':
        this.updateCurrentTurn((t) => ({ ...t, responseText: t.responseText + event.chunk }));
        break;
      case 'tool_call':
        this.updateCurrentTurn((t) => ({
          ...t,
          toolCalls: [...t.toolCalls, newToolCallState(event.callId, event.name, event.args)],
        }));
        break;
      case 'interrupt_request':
        this.updateCurrentTurn((t) => ({
          ...t,
          toolCalls: t.toolCalls.map((tc) =>
            tc.callId === event.callId
              ? { ...tc, status: 'pending_approval', interruptReason: event.reason }
              : tc,
          ),
        }));
        break;
      case 'interrupt_resolved':
        this.updateCurrentTurn((t) => ({
          ...t,
          toolCalls: t.toolCalls.map((tc) =>
            tc.callId === event.callId ? applyInterruptResolution(tc, event) : tc,
          ),
        }));
        break;
      case 'tool_result':
        this.updateCurrentTurn((t) => ({
          ...t,
          toolCalls: t.toolCalls.map((tc) =>
            tc.callId === event.callId ? applyToolResult(tc, event.result) : tc,
          ),
        }));
        break;
      case 'round_complete':
        this.updateCurrentTurn((t) => ({ ...t, rounds: t.rounds + 1 }));
        break;
      case 'turn_complete':
        this.updateCurrentTurn((t) => ({ ...t, finishReason: event.finishReason }));
        this._phase.set('complete');
        break;
      default:
        break;
    }
  }

  appendUserPrompt(prompt: string): void {
    this._rawHistory.update((h) => [...h, { role: 'user', parts: [{ text: prompt }] }]);
  }

  appendToolResponses(
    responses: ReadonlyArray<{ readonly name: string; readonly response: Record<string, unknown> }>,
  ): void {
    this._rawHistory.update((h) => [
      ...h,
      {
        role: 'tool',
        parts: responses.map((r) => ({
          functionResponse: { name: r.name, response: r.response },
        })),
      },
    ]);
  }

  appendChunkToRawHistory(chunk: GeminiChunk): void {
    this._rawHistory.update((history) => {
      const last = history.at(-1);
      if (!last || last.role !== 'model') {
        return [...history, appendChunkToContent(chunk, { role: 'model', parts: [] })];
      }
      const updated = appendChunkToContent(chunk, last);
      return [...history.slice(0, -1), updated];
    });
  }

  bumpStats(delta: { chunks?: number; parts?: number; signedParts?: number }): void {
    this._stats.update((s) => ({
      chunks: s.chunks + (delta.chunks ?? 0),
      parts: s.parts + (delta.parts ?? 0),
      signedParts: s.signedParts + (delta.signedParts ?? 0),
    }));
  }

  markCancelled(): void {
    this._phase.set('cancelled');
  }

  markError(message: string): void {
    this._error.set(message);
    this._phase.set('error');
  }

  reset(): void {
    this._events.set([]);
    this._rawHistory.set([]);
    this._currentTurn.set(EMPTY_TURN);
    this._phase.set('idle');
    this._error.set(null);
    this._stats.set({ chunks: 0, parts: 0, signedParts: 0 });
  }

  private updateCurrentTurn(updater: (turn: CurrentTurn) => CurrentTurn): void {
    this._currentTurn.update(updater);
  }
}

function newToolCallState(
  callId: string,
  name: string,
  args: Record<string, unknown>,
): ToolCallState {
  return {
    callId,
    name,
    args,
    result: null,
    errorMessage: null,
    interruptReason: null,
    status: 'running',
    startedAt: Date.now(),
    completedAt: null,
  };
}

function applyToolResult(
  state: ToolCallState,
  result: Record<string, unknown> | { readonly error: string },
): ToolCallState {
  if (state.status === 'rejected') {
    return { ...state, result: result as Record<string, unknown>, completedAt: Date.now() };
  }
  const isError = isErrorResult(result);
  return {
    ...state,
    result: isError ? null : (result as Record<string, unknown>),
    errorMessage: isError ? (result as { error: string }).error : null,
    status: isError ? 'error' : 'complete',
    completedAt: Date.now(),
  };
}

function applyInterruptResolution(
  state: ToolCallState,
  event: {
    readonly decision: 'approve' | 'reject' | 'select';
    readonly note?: string;
  },
): ToolCallState {
  if (event.decision === 'reject') {
    const trimmed = event.note?.trim();
    return {
      ...state,
      status: 'rejected',
      interruptReason: trimmed && trimmed.length > 0 ? trimmed : null,
      completedAt: Date.now(),
    };
  }
  return { ...state, status: 'running', interruptReason: null };
}

// A tool failure is encoded by the agent loop as exactly `{ error: string }`.
// We deliberately do NOT classify arbitrary results that happen to carry an
// `error` field (e.g. a custom tool returning `{ status: 'ok', error: 'none' }`)
// as failures — that would mis-render successful payloads as red error chips.
function isErrorResult(
  result: Record<string, unknown> | { readonly error: string },
): boolean {
  if (result === null || typeof result !== 'object') return false;
  const obj = result as Record<string, unknown>;
  const keys = Object.keys(obj);
  if (keys.length !== 1 || keys[0] !== 'error') return false;
  const value = obj['error'];
  return typeof value === 'string' && value.length > 0;
}
