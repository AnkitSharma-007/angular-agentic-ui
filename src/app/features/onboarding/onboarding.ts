import { Component, computed, inject, output } from '@angular/core';

import { ApiKeyService } from '../../core/services/api-key.service';
import { OnboardingSetupFlowComponent } from './setup-flow/setup-flow';
import { OnboardingUnlockFlowComponent } from './unlock-flow/unlock-flow';

@Component({
  selector: 'app-onboarding',
  imports: [OnboardingSetupFlowComponent, OnboardingUnlockFlowComponent],
  templateUrl: './onboarding.html',
  styleUrl: './onboarding.scss',
})
export class OnboardingComponent {
  private readonly apiKey = inject(ApiKeyService);

  readonly ready = output<void>();

  protected readonly mode = computed<'unlock' | 'setup'>(() =>
    this.apiKey.hasLockedBlob() ? 'unlock' : 'setup',
  );
}
