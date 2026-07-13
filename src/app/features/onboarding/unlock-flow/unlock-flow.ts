import { Component, computed, inject, output, signal } from '@angular/core';
import { form } from '@angular/forms/signals';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';

import { ApiKeyService } from '../../../core/services/api-key.service';
import { DecryptionFailedError } from '../../../core/crypto/webcrypto.helpers';
import { humanizeGeminiError } from '../../../core/errors';
import { createTwoStepConfirm } from '../../../core/utils/two-step-confirm';
import { StatusBannerComponent } from '../../../shared/status-banner/status-banner';
import { OnboardingHeroComponent } from '../onboarding-hero/onboarding-hero';
import { PassphraseFieldComponent } from '../passphrase-field/passphrase-field';
import type { OnboardingStatus } from '../onboarding-status';

@Component({
  selector: 'app-onboarding-unlock-flow',
  imports: [
    MatCardModule,
    MatButtonModule,
    MatProgressSpinnerModule,
    StatusBannerComponent,
    OnboardingHeroComponent,
    PassphraseFieldComponent,
  ],
  templateUrl: './unlock-flow.html',
  styleUrl: './unlock-flow.scss',
})
export class OnboardingUnlockFlowComponent {
  protected readonly apiKey = inject(ApiKeyService);

  readonly ready = output<void>();

  protected readonly model = signal<{ passphrase: string }>({ passphrase: '' });
  protected readonly f = form(this.model);

  protected readonly status = signal<OnboardingStatus>({ kind: 'idle' });
  protected readonly showPassphrase = signal(false);

  protected readonly canUnlock = computed(() => {
    const s = this.status();
    return this.model().passphrase.length > 0 && s.kind !== 'unlocking';
  });

  private readonly forgetConfirm = createTwoStepConfirm();
  protected readonly confirmingForget = this.forgetConfirm.armed;

  protected get statusKind(): OnboardingStatus['kind'] {
    return this.status().kind;
  }

  protected get errorMessage(): string | null {
    const s = this.status();
    return s.kind === 'error' ? s.message : null;
  }

  protected async unlock(): Promise<void> {
    this.status.set({ kind: 'unlocking' });
    try {
      await this.apiKey.unlockLocal(this.model().passphrase);
      this.status.set({ kind: 'idle' });
      this.ready.emit();
    } catch (err) {
      const message =
        err instanceof DecryptionFailedError
          ? 'That passphrase did not unlock the stored key. Try again.'
          : humanizeGeminiError(err);
      this.status.set({ kind: 'error', message });
    }
  }

  protected forgetSavedKey(): void {
    if (!this.forgetConfirm.confirm()) return;
    void this.apiKey.clear();
    this.model.set({ passphrase: '' });
    this.status.set({ kind: 'idle' });
  }

  protected cancelForget(): void {
    this.forgetConfirm.cancel();
  }
}
