import { Service, signal } from '@angular/core';

const STORAGE_KEY = 'atlas:tool-synthesis';

// Feature flag for agent tool synthesis (the `proposeTool` capability).
// Defaults ON for demo builds — documented as opt-out — and persists to
// localStorage, mirroring BudgetService. The agent loop reads `enabled()` to
// decide whether to offer `proposeTool` to the model.
@Service()
export class ToolSynthesisSettings {
  private readonly _enabled = signal<boolean>(loadStored());

  readonly enabled = this._enabled.asReadonly();

  setEnabled(value: boolean): void {
    this._enabled.set(value);
    persist(value);
  }

  toggle(): void {
    this.setEnabled(!this._enabled());
  }
}

function loadStored(): boolean {
  if (typeof localStorage === 'undefined') return true;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return true;
    return raw === 'true';
  } catch {
    return true;
  }
}

function persist(value: boolean): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, String(value));
  } catch {
    // localStorage unavailable (quota, private browsing) — keep in-memory state
  }
}
