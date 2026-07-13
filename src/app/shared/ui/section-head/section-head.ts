import { Component, input } from '@angular/core';

/**
 * A small subsection header: an uppercase label with an optional trailing meta
 * string. Project a trailing action (link, button, hint) via content — it is
 * pushed to the end of the row. Shared by the cost meter, observability drawer,
 * and the tool cards so in-card section headings read consistently.
 */
@Component({
  selector: 'app-section-head',
  imports: [],
  template: `
    <span class="section-label">{{ label() }}</span>
    @if (meta(); as m) {
      <span class="section-meta">{{ m }}</span>
    }
    <ng-content />
  `,
  styleUrl: './section-head.scss',
})
export class SectionHeadComponent {
  readonly label = input.required<string>();
  readonly meta = input<string | null>(null);
}
