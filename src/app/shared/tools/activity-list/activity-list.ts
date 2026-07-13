import { Component, computed, input } from '@angular/core';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import type { ToolCallStatus } from '../../../core/streaming/agent-event.store';
import type { Activity, ActivityCategory } from './find-activities.descriptor';

const CATEGORY_ICONS: Record<ActivityCategory, string> = {
  food: 'restaurant',
  culture: 'museum',
  adventure: 'hiking',
  beach: 'beach_access',
  nightlife: 'nightlife',
  shopping: 'shopping_bag',
  nature: 'park',
  wellness: 'spa',
};

interface FindActivitiesResult {
  readonly city?: string;
  readonly activities?: readonly Activity[];
  readonly totalDurationHours?: number;
}

@Component({
  selector: 'app-activity-list',
  imports: [MatCardModule, MatIconModule],
  templateUrl: './activity-list.html',
  styleUrl: './activity-list.scss',
})
export class ActivityListComponent {
  readonly callId = input<string>('');
  readonly args = input<Record<string, unknown>>({});
  readonly result = input<FindActivitiesResult | null>(null);
  // Full ToolCallStatus for parity if this tool becomes interruptive.
  readonly status = input<ToolCallStatus>('running');
  readonly errorMessage = input<string | null>(null);
  readonly interruptReason = input<string | null>(null);

  protected readonly isPending = computed(() => this.status() === 'pending_approval');
  protected readonly isRejected = computed(() => this.status() === 'rejected');

  protected readonly city = computed<string>(() => {
    const r = this.result();
    if (r && typeof r.city === 'string') return r.city;
    const a = this.args();
    return typeof a['city'] === 'string' ? (a['city'] as string) : '';
  });

  protected readonly activities = computed<readonly Activity[]>(
    () => this.result()?.activities ?? [],
  );

  protected readonly totalHours = computed(() => this.result()?.totalDurationHours ?? 0);

  protected iconFor(category: ActivityCategory): string {
    return CATEGORY_ICONS[category] ?? 'attractions';
  }

  protected stars(rating: number): readonly ('full' | 'half' | 'empty')[] {
    return [1, 2, 3, 4, 5].map((i) => {
      if (rating >= i) return 'full';
      if (rating >= i - 0.5) return 'half';
      return 'empty';
    });
  }
}
