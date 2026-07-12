import { Service, computed, signal } from '@angular/core';

export type InterruptDecision =
  | { readonly kind: 'approve'; readonly note?: string }
  | { readonly kind: 'reject'; readonly note?: string }
  | { readonly kind: 'select'; readonly selection: Record<string, unknown> };

interface PendingHandle {
  readonly resolve: (decision: InterruptDecision) => void;
  readonly reject: (err: unknown) => void;
  readonly cleanup: () => void;
}

// A decision buffered because it arrived before the awaiter registered. Keep a
// hard cap so a stream of genuinely stale dispatches (cancelled turns, replay
// races) can't grow the map without bound. callIds are unique per turn, so a
// buffered entry only ever resolves the awaiter it was meant for.
const MAX_EARLY_DECISIONS = 64;

@Service()
export class InterruptService {
  private readonly pending = new Map<string, PendingHandle>();
  private readonly earlyDecisions = new Map<string, InterruptDecision>();
  private readonly _pendingIds = signal<readonly string[]>([]);

  readonly pendingIds = this._pendingIds.asReadonly();
  readonly pendingCount = computed(() => this._pendingIds().length);
  readonly hasPending = computed(() => this._pendingIds().length > 0);

  isPending(callId: string): boolean {
    return this.pending.has(callId);
  }

  pendingDecision(callId: string, signal: AbortSignal): Promise<InterruptDecision> {
    // M5: the UI can render the approval card (and a fast/auto approver can
    // dispatch a decision) before settlement registers this awaiter. If a
    // decision was buffered for this callId, honour it instead of waiting.
    const buffered = this.earlyDecisions.get(callId);
    if (buffered) {
      this.earlyDecisions.delete(callId);
      return Promise.resolve(buffered);
    }

    if (this.pending.has(callId)) this.cancelPending(callId);

    return new Promise<InterruptDecision>((resolve, reject) => {
      if (signal.aborted) {
        reject(new DOMException('Aborted before decision.', 'AbortError'));
        return;
      }

      const onAbort = () => {
        const handle = this.pending.get(callId);
        if (handle) {
          this.pending.delete(callId);
          this.syncPendingIds();
          handle.reject(new DOMException('Aborted while awaiting decision.', 'AbortError'));
        }
      };

      const handle: PendingHandle = {
        resolve,
        reject,
        cleanup: () => signal.removeEventListener('abort', onAbort),
      };

      this.pending.set(callId, handle);
      this.syncPendingIds();
      signal.addEventListener('abort', onAbort, { once: true });
    });
  }

  decide(callId: string, decision: InterruptDecision): void {
    const handle = this.pending.get(callId);
    if (!handle) {
      // No awaiter yet. This is usually a slightly-early dispatch — the UI
      // rendered the request before settlement registered `pendingDecision`
      // (M5) — so buffer it to be honoured on registration rather than dropped.
      // A genuinely stale dispatch (cancelled turn, replay race, duplicate
      // click) simply never gets consumed; callIds are unique per turn so it
      // can't resolve the wrong awaiter.
      this.bufferEarlyDecision(callId, decision);
      return;
    }
    this.pending.delete(callId);
    handle.cleanup();
    this.syncPendingIds();
    handle.resolve(decision);
  }

  private bufferEarlyDecision(callId: string, decision: InterruptDecision): void {
    // Bound the buffer: evict the oldest entry once we exceed the cap so a
    // flood of stale dispatches can't leak memory.
    if (this.earlyDecisions.size >= MAX_EARLY_DECISIONS) {
      const oldest = this.earlyDecisions.keys().next().value;
      if (oldest !== undefined) this.earlyDecisions.delete(oldest);
    }
    this.earlyDecisions.set(callId, decision);
  }

  private cancelPending(callId: string): void {
    const handle = this.pending.get(callId);
    if (!handle) return;
    this.pending.delete(callId);
    handle.cleanup();
    this.syncPendingIds();
    handle.reject(new DOMException('Superseded by a newer request.', 'AbortError'));
  }

  private syncPendingIds(): void {
    this._pendingIds.set([...this.pending.keys()]);
  }
}
