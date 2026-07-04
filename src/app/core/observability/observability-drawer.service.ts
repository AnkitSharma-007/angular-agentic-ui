import { Service, signal } from '@angular/core';

@Service()
export class ObservabilityDrawerService {
  private readonly _open = signal(false);
  readonly isOpen = this._open.asReadonly();

  open(): void {
    this._open.set(true);
  }

  close(): void {
    this._open.set(false);
  }

  toggle(): void {
    this._open.update((o) => !o);
  }
}
