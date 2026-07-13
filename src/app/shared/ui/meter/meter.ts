import { Component, computed, input } from '@angular/core';

/**
 * A determinate meter: a rounded track with a single gradient fill. `value` is a
 * 0..1 ratio (clamped). `warn`/`danger` retint the fill for threshold states.
 * Decorative by default (aria-hidden) — pair it with a visible label/percentage.
 */
@Component({
  selector: 'app-meter',
  imports: [],
  template: `
    <span
      class="meter-fill"
      [class.warn]="warn()"
      [class.danger]="danger()"
      [style.width.%]="pct()"
    ></span>
  `,
  styleUrl: './meter.scss',
  host: {
    role: 'presentation',
    'aria-hidden': 'true',
  },
})
export class MeterComponent {
  readonly value = input<number>(0);
  readonly warn = input(false);
  readonly danger = input(false);

  protected readonly pct = computed(() => Math.max(0, Math.min(1, this.value())) * 100);
}
