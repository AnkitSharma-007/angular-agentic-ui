import { Component, computed, input } from '@angular/core';
import { MatCardModule } from '@angular/material/card';
import { MatChipsModule } from '@angular/material/chips';
import { MatDividerModule } from '@angular/material/divider';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import type { ToolCallStatus } from '../../../core/streaming/agent-event.store';
import type { SearchFlightsArgs, SearchFlightsResult } from './flight-options-card.types';

@Component({
  selector: 'app-flight-options-card',
  imports: [MatCardModule, MatChipsModule, MatDividerModule, MatProgressBarModule],
  templateUrl: './flight-options-card.html',
  styleUrl: './flight-options-card.scss',
})
export class FlightOptionsCardComponent {
  readonly callId = input<string>('');
  readonly interruptReason = input<string | null>(null);
  readonly args = input.required<SearchFlightsArgs>();
  readonly result = input<SearchFlightsResult | null>(null);
  readonly status = input.required<ToolCallStatus>();
  readonly errorMessage = input<string | null>(null);

  protected readonly isRunning = computed(() => this.status() === 'running');
  protected readonly isComplete = computed(() => this.status() === 'complete');
  protected readonly isError = computed(() => this.status() === 'error');
  protected readonly isPending = computed(() => this.status() === 'pending_approval');
  protected readonly isRejected = computed(() => this.status() === 'rejected');

  protected readonly flights = computed(() => this.result()?.flights ?? []);

  protected readonly route = computed(() => {
    const a = this.args();
    return `${a.from} → ${a.to}`;
  });

  protected formatTime(iso: string): string {
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  protected formatDuration(minutes: number): string {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  }

  protected formatPrice(amount: number, currency: string): string {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency,
      maximumFractionDigits: 0,
    }).format(amount);
  }
}
