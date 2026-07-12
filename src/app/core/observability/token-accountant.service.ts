import { Service, computed, signal } from '@angular/core';
import { costUsd } from './pricing';
import type { RoundMetrics, TurnUsage, TokenUsage } from './usage.types';
import { EMPTY_TURN_USAGE, ZERO_USAGE, addUsage } from './usage.types';
import type { GeminiUsageMetadata } from '../streaming/to-agent-event.operator';

@Service()
export class TokenAccountantService {
  private readonly _currentTurn = signal<TurnUsage>(EMPTY_TURN_USAGE);
  private readonly _lifetimeTotals = signal<TokenUsage>(ZERO_USAGE);
  private readonly _lifetimeCostUsd = signal<number>(0);
  private readonly _lifetimeRounds = signal<number>(0);

  readonly currentTurn = this._currentTurn.asReadonly();
  readonly lifetimeTotals = this._lifetimeTotals.asReadonly();
  readonly lifetimeCostUsd = this._lifetimeCostUsd.asReadonly();
  readonly lifetimeRounds = this._lifetimeRounds.asReadonly();

  readonly turnCostUsd = computed(() => this._currentTurn().costUsd);
  readonly turnTotalTokens = computed(() => this._currentTurn().totals.totalTokens);
  readonly turnRoundCount = computed(() => this._currentTurn().rounds.length);

  beginTurn(turnId: string): void {
    this._currentTurn.set({ ...EMPTY_TURN_USAGE, turnId });
  }

  recordRound(input: {
    readonly turnId: string;
    readonly roundIndex: number;
    readonly startedAt: number;
    readonly completedAt: number;
    readonly usage: TokenUsage;
    readonly model: string;
    readonly finishReason: string;
    readonly usageAvailable?: boolean;
  }): RoundMetrics {
    const latencyMs = Math.max(0, input.completedAt - input.startedAt);
    const round: RoundMetrics = {
      turnId: input.turnId,
      roundIndex: input.roundIndex,
      startedAt: input.startedAt,
      completedAt: input.completedAt,
      latencyMs,
      usage: input.usage,
      usageAvailable: input.usageAvailable ?? true,
      model: input.model,
      costUsd: costUsd(input.usage, input.model),
      finishReason: input.finishReason,
    };

    this._currentTurn.update((t) => ({
      turnId: t.turnId || input.turnId,
      rounds: [...t.rounds, round],
      totals: addUsage(t.totals, round.usage),
      totalLatencyMs: t.totalLatencyMs + latencyMs,
      costUsd: t.costUsd + round.costUsd,
    }));

    this._lifetimeTotals.update((total) => addUsage(total, round.usage));
    this._lifetimeCostUsd.update((c) => c + round.costUsd);
    this._lifetimeRounds.update((r) => r + 1);

    return round;
  }

  resetTurn(): void {
    this._currentTurn.set(EMPTY_TURN_USAGE);
  }

  clearLifetime(): void {
    this._lifetimeTotals.set(ZERO_USAGE);
    this._lifetimeCostUsd.set(0);
    this._lifetimeRounds.set(0);
  }
}

export function toTokenUsage(meta: GeminiUsageMetadata | undefined): TokenUsage {
  if (!meta) return ZERO_USAGE;
  const input = meta.promptTokenCount ?? 0;
  const output = meta.candidatesTokenCount ?? 0;
  const thought = meta.thoughtsTokenCount ?? 0;
  const total = meta.totalTokenCount ?? input + output + thought;
  return {
    inputTokens: input,
    outputTokens: output,
    thoughtTokens: thought,
    totalTokens: total,
  };
}
