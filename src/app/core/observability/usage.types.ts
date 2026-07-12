export interface TokenUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly thoughtTokens: number;
  readonly totalTokens: number;
}

export const ZERO_USAGE: TokenUsage = {
  inputTokens: 0,
  outputTokens: 0,
  thoughtTokens: 0,
  totalTokens: 0,
};

export function addUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    thoughtTokens: a.thoughtTokens + b.thoughtTokens,
    totalTokens: a.totalTokens + b.totalTokens,
  };
}

export interface RoundMetrics {
  readonly turnId: string;
  readonly roundIndex: number;
  readonly startedAt: number;
  readonly completedAt: number;
  readonly latencyMs: number;
  readonly usage: TokenUsage;
  // False when the round produced no usageMetadata at all — the recorded usage
  // is a zero placeholder, not a real measurement (M2). Lets the UI say
  // "usage unavailable" instead of silently showing 0 tokens / $0.
  readonly usageAvailable: boolean;
  readonly model: string;
  readonly costUsd: number;
  readonly finishReason: string;
}

export interface TurnUsage {
  readonly turnId: string;
  readonly rounds: readonly RoundMetrics[];
  readonly totals: TokenUsage;
  readonly totalLatencyMs: number;
  readonly costUsd: number;
}

export const EMPTY_TURN_USAGE: TurnUsage = {
  turnId: '',
  rounds: [],
  totals: ZERO_USAGE,
  totalLatencyMs: 0,
  costUsd: 0,
};
