import {
  Component,
  ElementRef,
  HostListener,
  Injector,
  afterNextRender,
  computed,
  effect,
  inject,
  viewChild,
} from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { CdkTrapFocus } from '@angular/cdk/a11y';

import { ObservabilityService, type TimelineRow } from '../../core/observability/observability.service';
import { ObservabilityDrawerService } from '../../core/observability/observability-drawer.service';
import { TokenAccountantService } from '../../core/observability/token-accountant.service';
import { formatTokens, formatUsd } from '../../core/observability/pricing';

interface RenderedRow extends TimelineRow {
  readonly leftPct: number;
  readonly widthPct: number;
}

@Component({
  selector: 'app-observability-drawer',
  imports: [MatIconModule, MatButtonModule, CdkTrapFocus],
  templateUrl: './observability-drawer.html',
  styleUrl: './observability-drawer.scss',
})
export class ObservabilityDrawerComponent {
  protected readonly drawer = inject(ObservabilityDrawerService);
  protected readonly observability = inject(ObservabilityService);
  protected readonly accountant = inject(TokenAccountantService);

  protected readonly isOpen = this.drawer.isOpen;
  protected readonly currentTurn = this.accountant.currentTurn;
  protected readonly selectedRow = this.observability.selectedRow;

  // Aside stays mounted for slide transition — manual focus management instead of cdkTrapFocus auto-capture.
  private readonly closeBtn = viewChild<ElementRef<HTMLButtonElement>>('closeBtn');
  private previouslyFocused: HTMLElement | null = null;

  constructor() {
    const injector = inject(Injector);
    effect(() => {
      const open = this.isOpen();
      if (open) {
        const active = document.activeElement;
        this.previouslyFocused = active instanceof HTMLElement ? active : null;
        afterNextRender(
          () => this.closeBtn()?.nativeElement.focus({ preventScroll: true }),
          { injector },
        );
      } else if (this.previouslyFocused) {
        const target = this.previouslyFocused;
        this.previouslyFocused = null;
        target.focus({ preventScroll: true });
      }
    });
  }

  protected readonly bounds = this.observability.bounds;
  protected readonly rows = computed<readonly RenderedRow[]>(() => {
    const b = this.bounds();
    const span = Math.max(1, b.durationMs);
    return this.observability.timeline().map((row) => ({
      ...row,
      leftPct: ((row.startedAt - b.startedAt) / span) * 100,
      widthPct: Math.max(0.5, (row.durationMs / span) * 100),
    }));
  });

  protected readonly hasData = computed(() => this.rows().length > 0);
  protected readonly totalCost = computed(() => this.currentTurn().costUsd);
  protected readonly totalTokens = computed(() => this.currentTurn().totals.totalTokens);
  protected readonly totalLatency = computed(() => this.currentTurn().totalLatencyMs);
  protected readonly roundCount = computed(() => this.currentTurn().rounds.length);

  protected close(): void {
    this.drawer.close();
  }

  protected selectRow(id: string): void {
    if (this.observability.selectedRowId() === id) {
      this.observability.clearSelection();
    } else {
      this.observability.selectRow(id);
    }
  }

  protected clearSelection(): void {
    this.observability.clearSelection();
  }

  @HostListener('document:keydown.escape')
  protected onEscape(): void {
    if (this.isOpen()) {
      if (this.observability.selectedRowId()) {
        this.observability.clearSelection();
      } else {
        this.close();
      }
    }
  }

  protected fmtUsd = formatUsd;
  protected fmtTokens = formatTokens;
  protected fmtLatency(ms: number): string {
    return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(2)}s`;
  }
}
