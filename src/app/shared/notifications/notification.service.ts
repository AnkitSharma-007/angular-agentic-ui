import { Service, signal } from '@angular/core';

// Transient, non-blocking feedback (toasts). Signal-driven so the host renders
// reactively under zoneless change detection. Chosen over MatSnackBar to match
// the app's inline-banner aesthetic and to keep full control over a11y, dedupe,
// and actions; MatSnackBar would be the lower-effort alternative.
export type NotificationKind = 'info' | 'success' | 'warn' | 'error';

export interface NotificationAction {
  readonly label: string;
  readonly handler: () => void;
}

export interface AppNotification {
  readonly id: number;
  readonly kind: NotificationKind;
  readonly message: string;
  readonly action?: NotificationAction;
}

export interface NotifyOptions {
  readonly kind?: NotificationKind;
  readonly action?: NotificationAction;
  // Auto-dismiss delay in ms. 0 keeps the toast until dismissed.
  readonly durationMs?: number;
  // Identical keys collapse into a single visible toast (prevents error spam
  // when the same failure repeats). Defaults to `kind:message`.
  readonly dedupeKey?: string;
}

const MAX_VISIBLE = 4;

const DEFAULT_DURATION_MS: Record<NotificationKind, number> = {
  success: 4000,
  info: 5000,
  warn: 7000,
  error: 10000,
};

@Service()
export class NotificationService {
  private readonly _items = signal<readonly AppNotification[]>([]);
  readonly items = this._items.asReadonly();

  private seq = 0;
  private readonly timers = new Map<number, ReturnType<typeof setTimeout>>();
  private readonly idByKey = new Map<string, number>();
  private readonly keyById = new Map<number, string>();

  notify(message: string, options: NotifyOptions = {}): number {
    const kind = options.kind ?? 'info';
    const duration = options.durationMs ?? DEFAULT_DURATION_MS[kind];
    const dedupeKey = options.dedupeKey ?? `${kind}:${message}`;

    // Collapse a duplicate that's still on screen; just refresh its timer.
    const existingId = this.idByKey.get(dedupeKey);
    if (existingId !== undefined) {
      if (duration > 0) this.startTimer(existingId, duration);
      return existingId;
    }

    const id = ++this.seq;
    const item: AppNotification = { id, kind, message, action: options.action };

    const next = [...this._items(), item];
    const overflow = next.length - MAX_VISIBLE;
    if (overflow > 0) {
      for (const dropped of next.splice(0, overflow)) this.forget(dropped.id);
    }
    this._items.set(next);

    this.idByKey.set(dedupeKey, id);
    this.keyById.set(id, dedupeKey);
    if (duration > 0) this.startTimer(id, duration);
    return id;
  }

  info(message: string, options?: Omit<NotifyOptions, 'kind'>): number {
    return this.notify(message, { ...options, kind: 'info' });
  }

  success(message: string, options?: Omit<NotifyOptions, 'kind'>): number {
    return this.notify(message, { ...options, kind: 'success' });
  }

  warn(message: string, options?: Omit<NotifyOptions, 'kind'>): number {
    return this.notify(message, { ...options, kind: 'warn' });
  }

  error(message: string, options?: Omit<NotifyOptions, 'kind'>): number {
    return this.notify(message, { ...options, kind: 'error' });
  }

  dismiss(id: number): void {
    this.clearTimer(id);
    this.forget(id);
    this._items.set(this._items().filter((n) => n.id !== id));
  }

  clear(): void {
    for (const id of [...this.timers.keys()]) this.clearTimer(id);
    this.idByKey.clear();
    this.keyById.clear();
    this._items.set([]);
  }

  // Drop the bookkeeping for a toast without touching the visible list (the
  // caller updates the signal). Also clears any pending timer.
  private forget(id: number): void {
    this.clearTimer(id);
    const key = this.keyById.get(id);
    if (key !== undefined) {
      this.idByKey.delete(key);
      this.keyById.delete(id);
    }
  }

  private startTimer(id: number, duration: number): void {
    this.clearTimer(id);
    this.timers.set(
      id,
      setTimeout(() => this.dismiss(id), duration),
    );
  }

  private clearTimer(id: number): void {
    const handle = this.timers.get(id);
    if (handle !== undefined) {
      clearTimeout(handle);
      this.timers.delete(id);
    }
  }
}
