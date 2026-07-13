import { Component, HostListener, computed, inject, signal } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { RouterLink } from '@angular/router';
import { CdkTrapFocus } from '@angular/cdk/a11y';

import { TokenAccountantService } from '../../core/observability/token-accountant.service';
import { BudgetService } from '../../core/observability/budget.service';
import { ObservabilityDrawerService } from '../../core/observability/observability-drawer.service';
import { ModelSelectionService } from '../../core/services/model-selection.service';
import { AgentEventStore } from '../../core/streaming/agent-event.store';
import { costUsd, formatTokens, formatUsd, pricingFor } from '../../core/observability/pricing';
import type { TokenUsage } from '../../core/observability/usage.types';
import { ZERO_USAGE } from '../../core/observability/usage.types';

@Component({
  selector: 'app-cost-meter',
  imports: [MatIconModule, MatButtonModule, RouterLink, CdkTrapFocus],
  templateUrl: './cost-meter.html',
  styleUrl: './cost-meter.scss',
})
export class CostMeterComponent {
  private readonly accountant = inject(TokenAccountantService);
  private readonly budget = inject(BudgetService);
  private readonly observabilityDrawer = inject(ObservabilityDrawerService);
  private readonly modelSelection = inject(ModelSelectionService);
  private readonly store = inject(AgentEventStore);

  protected readonly expanded = signal(false);

  protected readonly currentTurn = this.accountant.currentTurn;
  protected readonly lifetimeCost = this.accountant.lifetimeCostUsd;
  protected readonly lifetimeRounds = this.accountant.lifetimeRounds;
  protected readonly lifetimeTotals = this.accountant.lifetimeTotals;
  protected readonly isStreaming = this.store.isStreaming;

  protected readonly turnCost = computed(() => this.currentTurn().costUsd);
  protected readonly turnUsage = computed<TokenUsage>(
    () => this.currentTurn().totals ?? ZERO_USAGE,
  );
  protected readonly turnLatencyMs = computed(() => this.currentTurn().totalLatencyMs);
  protected readonly turnRounds = computed(() => this.currentTurn().rounds.length);

  protected readonly model = this.modelSelection.selectedModel;
  protected readonly pricing = computed(() => pricingFor(this.model()));

  protected readonly costBreakdown = computed(() => {
    const usage = this.turnUsage();
    const model = this.model();
    const input = costOf(usage.inputTokens, 'input', model);
    const output = costOf(usage.outputTokens, 'output', model);
    const thinking = costOf(usage.thoughtTokens, 'thinking', model);
    const total = input + output + thinking || 1;
    return {
      input: { cost: input, pct: (input / total) * 100 },
      output: { cost: output, pct: (output / total) * 100 },
      thinking: { cost: thinking, pct: (thinking / total) * 100 },
    };
  });

  protected readonly contextUtilisation = computed(() => {
    const usage = this.turnUsage();
    const window = this.pricing().contextWindow;
    return window > 0 ? Math.min(1, usage.totalTokens / window) : 0;
  });

  protected readonly budgetUtilisation = computed(() =>
    this.budget.utilisation({
      tokensUsed: this.turnUsage().totalTokens,
      roundsUsed: this.turnRounds(),
      costUsd: this.turnCost(),
    }),
  );

  protected readonly hasBudget = this.budget.hasAnyLimit;

  protected readonly pillCost = computed(() => formatUsd(this.turnCost()));
  protected readonly pillTokens = computed(() => formatTokens(this.turnUsage().totalTokens));

  // Keep the floating pill hidden until there's real spend to report — a first-time
  // user shouldn't see a "$0.000" instrument-panel chip before they've done anything.
  protected readonly visible = computed(
    () =>
      this.isStreaming() ||
      this.turnUsage().totalTokens > 0 ||
      this.turnCost() > 0 ||
      this.lifetimeTotals().totalTokens > 0,
  );

  protected toggle(): void {
    this.expanded.update((e) => !e);
  }

  protected close(): void {
    this.expanded.set(false);
  }

  protected openDashboard(): void {
    this.close();
    this.observabilityDrawer.open();
  }

  @HostListener('document:keydown.escape')
  protected onEscape(): void {
    if (this.expanded()) this.close();
  }

  protected fmtUsd = formatUsd;
  protected fmtTokens = formatTokens;
  protected fmtPct(n: number): string {
    return `${(n * 100).toFixed(0)}%`;
  }
  protected fmtLatency(ms: number): string {
    return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(2)}s`;
  }
}

function costOf(count: number, kind: 'input' | 'output' | 'thinking', model: string): number {
  const usage: TokenUsage = {
    ...ZERO_USAGE,
    inputTokens: kind === 'input' ? count : 0,
    outputTokens: kind === 'output' ? count : 0,
    thoughtTokens: kind === 'thinking' ? count : 0,
    totalTokens: count,
  };
  return costUsd(usage, model);
}
