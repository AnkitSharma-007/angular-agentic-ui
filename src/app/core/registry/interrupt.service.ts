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

@Service()
export class InterruptService {
  private readonly pending = new Map<string, PendingHandle>();
  private readonly _pendingIds = signal<readonly string[]>([]);

  readonly pendingIds = this._pendingIds.asReadonly();
  readonly pendingCount = computed(() => this._pendingIds().length);
  readonly hasPending = computed(() => this._pendingIds().length > 0);

  isPending(callId: string): boolean {
    return this.pending.has(callId);
  }

  pendingDecision(callId: string, signal: AbortSignal): Promise<InterruptDecision> {
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
      // Stale dispatch (cancelled turn, replay race, duplicate click) — warn
      // so a stuck "pending_approval" card has a breadcrumb in the console.
      console.warn(
        `[InterruptService] decide(${callId}, ${decision.kind}) ignored — no pending decision for that callId.`,
      );
      return;
    }
    this.pending.delete(callId);
    handle.cleanup();
    this.syncPendingIds();
    handle.resolve(decision);
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
