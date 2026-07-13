import { Component, input } from '@angular/core';

@Component({
  selector: 'app-page-header',
  imports: [],
  templateUrl: './page-header.html',
  styleUrl: './page-header.scss',
})
export class PageHeaderComponent {
  readonly icon = input<string | null>(null);
  readonly pulseDot = input(false);
  readonly eyebrow = input.required<string>();
  readonly titleStart = input<string>('');
  readonly titleAccent = input<string>('');
  readonly titleEnd = input<string>('');
  readonly subtitle = input<string | null>(null);
}
