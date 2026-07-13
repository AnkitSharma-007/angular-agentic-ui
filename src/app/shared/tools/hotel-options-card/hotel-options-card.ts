import { Component, computed, input } from '@angular/core';
import { MatCardModule } from '@angular/material/card';
import { MatChipsModule } from '@angular/material/chips';
import { MatDividerModule } from '@angular/material/divider';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import type { ToolCallStatus } from '../../../core/streaming/agent-event.store';
import { formatCurrency } from '../../formatting/format';
import { toolStatusFlags } from '../tool-card/tool-status-flags';
import type { SearchHotelsArgs, SearchHotelsResult } from './hotel-options-card.types';

@Component({
  selector: 'app-hotel-options-card',
  imports: [
    MatCardModule,
    MatChipsModule,
    MatDividerModule,
    MatIconModule,
    MatProgressBarModule,
  ],
  templateUrl: './hotel-options-card.html',
  styleUrl: './hotel-options-card.scss',
})
export class HotelOptionsCardComponent {
  readonly callId = input<string>('');
  readonly interruptReason = input<string | null>(null);
  readonly args = input.required<SearchHotelsArgs>();
  readonly result = input<SearchHotelsResult | null>(null);
  readonly status = input.required<ToolCallStatus>();
  readonly errorMessage = input<string | null>(null);

  protected readonly flags = toolStatusFlags(this.status);

  protected readonly hotels = computed(() => this.result()?.hotels ?? []);
  protected readonly nights = computed(() => this.result()?.nights ?? 0);

  protected readonly headerLine = computed(() => {
    const a = this.args();
    const veg = a.vegetarianFriendly ? ' · veg-friendly' : '';
    return `${a.city} · ${a.checkIn} → ${a.checkOut} · ${a.guests} guest${a.guests === 1 ? '' : 's'}${veg}`;
  });

  protected readonly formatPrice = formatCurrency;

  protected formatRating(rating: number): string {
    return rating.toFixed(1);
  }
}
