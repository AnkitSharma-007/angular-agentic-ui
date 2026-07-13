import { Component, input } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';

export type MetricSize = 'sm' | 'md' | 'lg';
export type MetricAppearance = 'plain' | 'tile';
export type MetricTone = 'default' | 'ok';

/**
 * A label + value stat. Shared across the cost meter, observability drawer, and
 * settings cards so every "stat" reads with the same typographic rhythm.
 *
 * Provide the value via the `value` input, or project rich content (kept for
 * cases the input can't express). An optional leading `icon` is rendered inside
 * the value so the component owns its colour (works with the `ok` tone).
 */
@Component({
  selector: 'app-metric',
  imports: [MatIconModule],
  template: `
    <span class="metric-label">{{ label() }}</span>
    <strong class="metric-value">
      @if (icon(); as ic) {
        <mat-icon aria-hidden="true">{{ ic }}</mat-icon>
      }
      @if (value() !== null && value() !== undefined) {
        {{ value() }}
      } @else {
        <ng-content />
      }
    </strong>
  `,
  styleUrl: './metric.scss',
  host: {
    '[attr.data-size]': 'size()',
    '[attr.data-appearance]': 'appearance()',
    '[attr.data-tone]': 'tone()',
    '[class.mono]': 'mono()',
    '[class.bordered]': 'bordered()',
    '[class.full]': 'full()',
  },
})
export class MetricComponent {
  readonly label = input.required<string>();
  readonly value = input<string | number | null>(null);
  readonly icon = input<string | null>(null);
  readonly size = input<MetricSize>('md');
  readonly appearance = input<MetricAppearance>('plain');
  readonly tone = input<MetricTone>('default');
  readonly mono = input(true);
  readonly bordered = input(false);
  readonly full = input(false);
}
