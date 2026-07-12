import { Service, computed, inject, signal } from '@angular/core';
import { AgentEventStore } from '../streaming/agent-event.store';
import { TokenAccountantService } from './token-accountant.service';
import type { RoundMetrics, TokenUsage } from './usage.types';
import { ZERO_USAGE } from './usage.types';

export interface TimelineRow {
  readonly kind: 'round' | 'tool';
  readonly id: string;
  readonly label: string;
  readonly startedAt: number;
  readonly completedAt: number;
  readonly durationMs: number;
  readonly usage?: TokenUsage;
  readonly usageAvailable?: boolean;
  readonly finishReason?: string;
  readonly costUsd?: number;
  readonly model?: string;
  readonly toolStatus?: 'pending_approval' | 'running' | 'complete' | 'error' | 'rejected';
  readonly errorMessage?: string | null;
}

interface TimelineBounds {
  readonly startedAt: number;
  readonly endedAt: number;
  readonly durationMs: number;
}

@Service()
export class ObservabilityService {
  private readonly accountant = inject(TokenAccountantService);
  private readonly store = inject(AgentEventStore);

  private readonly _selectedRowId = signal<string | null>(null);
  readonly selectedRowId = this._selectedRowId.asReadonly();

  readonly timeline = computed<readonly TimelineRow[]>(() => {
    const rounds = this.accountant.currentTurn().rounds;
    const toolCalls = this.store.toolCalls();
    const now = Date.now();

    const rows: TimelineRow[] = rounds.map(roundToRow);

    for (const call of toolCalls) {
      if (!call.startedAt) continue;
      const completedAt = call.completedAt ?? now;
      rows.push({
        kind: 'tool',
        id: `tool:${call.callId}`,
        label: call.name,
        startedAt: call.startedAt,
        completedAt,
        durationMs: Math.max(0, completedAt - call.startedAt),
        toolStatus: call.status,
        errorMessage: call.errorMessage,
      });
    }

    return rows.sort((a, b) => a.startedAt - b.startedAt);
  });

  readonly bounds = computed<TimelineBounds>(() => {
    const rows = this.timeline();
    if (rows.length === 0) return { startedAt: 0, endedAt: 0, durationMs: 0 };

    const startedAt = rows[0].startedAt;
    const endedAt = rows.reduce((max, r) => (r.completedAt > max ? r.completedAt : max), startedAt);
    return { startedAt, endedAt, durationMs: Math.max(0, endedAt - startedAt) };
  });

  readonly selectedRow = computed<TimelineRow | null>(() => {
    const id = this._selectedRowId();
    if (!id) return null;
    return this.timeline().find((r) => r.id === id) ?? null;
  });

  selectRow(id: string | null): void {
    this._selectedRowId.set(id);
  }

  clearSelection(): void {
    this._selectedRowId.set(null);
  }
}

function roundToRow(round: RoundMetrics): TimelineRow {
  return {
    kind: 'round',
    id: `round:${round.roundIndex}`,
    label: `Round ${round.roundIndex + 1}`,
    startedAt: round.startedAt,
    completedAt: round.completedAt,
    durationMs: round.latencyMs,
    usage: round.usage ?? ZERO_USAGE,
    usageAvailable: round.usageAvailable,
    finishReason: round.finishReason,
    costUsd: round.costUsd,
    model: round.model,
  };
}
