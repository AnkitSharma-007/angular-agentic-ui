import { Service, computed, signal } from '@angular/core';

export interface BudgetConfig {
  readonly maxTokens: number | null;
  readonly maxRounds: number | null;
  readonly maxCostUsd: number | null;
}

export interface BudgetSnapshot {
  readonly tokensUsed: number;
  readonly roundsUsed: number;
  readonly costUsd: number;
}

export type BudgetBreach =
  | { readonly kind: 'tokens'; readonly limit: number; readonly used: number }
  | { readonly kind: 'rounds'; readonly limit: number; readonly used: number }
  | { readonly kind: 'cost'; readonly limit: number; readonly used: number };

const STORAGE_KEY = 'atlas:budget';

const DEFAULT_CONFIG: BudgetConfig = {
  maxTokens: null,
  maxRounds: null,
  maxCostUsd: null,
};

@Service()
export class BudgetService {
  private readonly _config = signal<BudgetConfig>(loadStored());

  readonly config = this._config.asReadonly();
  readonly hasAnyLimit = computed(() => {
    const c = this._config();
    return c.maxTokens !== null || c.maxRounds !== null || c.maxCostUsd !== null;
  });

  update(patch: Partial<BudgetConfig>): void {
    this._config.update((current) => {
      const next: BudgetConfig = { ...current, ...patch };
      persist(next);
      return next;
    });
  }

  reset(): void {
    this._config.set(DEFAULT_CONFIG);
    persist(DEFAULT_CONFIG);
  }

  utilisation(snapshot: BudgetSnapshot): {
    readonly tokens: number | null;
    readonly rounds: number | null;
    readonly cost: number | null;
  } {
    const c = this._config();
    return {
      tokens: c.maxTokens === null ? null : clamp(snapshot.tokensUsed / c.maxTokens, 0, 1.5),
      rounds: c.maxRounds === null ? null : clamp(snapshot.roundsUsed / c.maxRounds, 0, 1.5),
      cost: c.maxCostUsd === null ? null : clamp(snapshot.costUsd / c.maxCostUsd, 0, 1.5),
    };
  }

  evaluate(snapshot: BudgetSnapshot): BudgetBreach | null {
    const c = this._config();
    if (c.maxRounds !== null && snapshot.roundsUsed >= c.maxRounds) {
      return { kind: 'rounds', limit: c.maxRounds, used: snapshot.roundsUsed };
    }
    if (c.maxTokens !== null && snapshot.tokensUsed >= c.maxTokens) {
      return { kind: 'tokens', limit: c.maxTokens, used: snapshot.tokensUsed };
    }
    if (c.maxCostUsd !== null && snapshot.costUsd >= c.maxCostUsd) {
      return { kind: 'cost', limit: c.maxCostUsd, used: snapshot.costUsd };
    }
    return null;
  }
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function loadStored(): BudgetConfig {
  if (typeof localStorage === 'undefined') return DEFAULT_CONFIG;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_CONFIG;
    const parsed = JSON.parse(raw) as Partial<BudgetConfig>;
    return {
      maxTokens: numericOrNull(parsed.maxTokens),
      maxRounds: numericOrNull(parsed.maxRounds),
      maxCostUsd: numericOrNull(parsed.maxCostUsd),
    };
  } catch {
    return DEFAULT_CONFIG;
  }
}

function persist(config: BudgetConfig): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  } catch {
    // localStorage unavailable (quota, private browsing) — keep in-memory state
  }
}

function numericOrNull(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null;
}
