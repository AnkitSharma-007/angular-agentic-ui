import { Component, computed, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';

import { ApiKeyService } from '../../../core/services/api-key.service';
import { createTwoStepConfirm } from '../../../core/utils/two-step-confirm';
import { SettingsCardComponent } from '../settings-card/settings-card';
import { MetricComponent } from '../../../shared/ui/metric/metric';

@Component({
  selector: 'app-api-key-status-card',
  imports: [SettingsCardComponent, MatButtonModule, MatIconModule, MetricComponent],
  templateUrl: './api-key-status-card.html',
  styleUrl: './api-key-status-card.scss',
})
export class ApiKeyStatusCardComponent {
  protected readonly apiKey = inject(ApiKeyService);

  // Human-readable key-storage tier label instead of raw enum values.
  protected readonly storageLabel = computed(() => {
    if (this.apiKey.storage() === 'encrypted-local' || this.apiKey.hasLockedBlob()) {
      return 'Encrypted on this device';
    }
    return this.apiKey.hasKey() ? 'This session only' : 'Not configured';
  });

  protected readonly storageIcon = computed(() => {
    switch (this.apiKey.storage()) {
      case 'encrypted-local':
        return 'enhanced_encryption';
      case 'session':
        return 'timer';
      default:
        return 'help';
    }
  });

  private readonly clearConfirm = createTwoStepConfirm();
  protected readonly confirmingClearKey = this.clearConfirm.armed;

  protected clearKey(): void {
    if (this.clearConfirm.confirm()) {
      void this.apiKey.clear();
    }
  }

  protected cancelClearKey(): void {
    this.clearConfirm.cancel();
  }
}
