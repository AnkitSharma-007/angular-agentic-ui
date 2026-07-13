import { Component, computed, input } from '@angular/core';

@Component({
  selector: 'app-status-banner',
  templateUrl: './status-banner.html',
  styleUrl: './status-banner.scss',
})
export class StatusBannerComponent {
  readonly variant = input.required<'success' | 'error'>();
  readonly icon = input<string>('');

  protected readonly effectiveIcon = computed(
    () => this.icon() || (this.variant() === 'success' ? 'check_circle' : 'error'),
  );
  protected readonly role = computed(() => (this.variant() === 'success' ? 'status' : 'alert'));
}
