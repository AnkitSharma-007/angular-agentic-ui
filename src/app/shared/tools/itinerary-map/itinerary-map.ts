import { Component, computed, input } from '@angular/core';
import { MatCardModule } from '@angular/material/card';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MapCanvasComponent } from './map-canvas';
import type { ToolCallStatus } from '../../../core/streaming/agent-event.store';
import type { RenderItineraryArgs, RenderItineraryResult } from './itinerary-map.types';

// `@defer (on viewport)` in the template keeps Leaflet out of the initial bundle.
@Component({
  selector: 'app-itinerary-map',
  imports: [MatCardModule, MatProgressBarModule, MapCanvasComponent],
  templateUrl: './itinerary-map.html',
  styleUrl: './itinerary-map.scss',
})
export class ItineraryMapComponent {
  readonly callId = input<string>('');
  readonly interruptReason = input<string | null>(null);
  readonly args = input.required<RenderItineraryArgs>();
  readonly result = input<RenderItineraryResult | null>(null);
  readonly status = input.required<ToolCallStatus>();
  readonly errorMessage = input<string | null>(null);

  protected readonly isRunning = computed(() => this.status() === 'running');
  protected readonly isComplete = computed(() => this.status() === 'complete');
  protected readonly isError = computed(() => this.status() === 'error');
  protected readonly isPending = computed(() => this.status() === 'pending_approval');
  protected readonly isRejected = computed(() => this.status() === 'rejected');

  protected readonly waypoints = computed(
    () => this.result()?.waypoints ?? this.args().waypoints,
  );
  protected readonly waypointCount = computed(() => this.waypoints().length);
}
