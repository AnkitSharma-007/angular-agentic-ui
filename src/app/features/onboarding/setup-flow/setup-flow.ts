import { Component, computed, inject, output, signal } from '@angular/core';
import { form, required, minLength, validate, FormField } from '@angular/forms/signals';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';

import { ApiKeyService } from '../../../core/services/api-key.service';
import { GeminiService } from '../../../core/services/gemini.service';
import { APP_CONFIG } from '../../../core/app-config';
import {
  MIN_PASSPHRASE_LENGTH,
  isCommonPassphrase,
} from '../../../core/crypto/passphrase-strength';
import { humanizeGeminiError } from '../../../core/errors';
import { StatusBannerComponent } from '../../../shared/status-banner/status-banner';
import { OnboardingHeroComponent } from '../onboarding-hero/onboarding-hero';
import { TrustStripComponent } from '../trust-strip/trust-strip';
import { PassphraseFieldComponent } from '../passphrase-field/passphrase-field';
import { PassphraseStrengthMeterComponent } from '../passphrase-strength-meter/passphrase-strength-meter';
import type { OnboardingStatus } from '../onboarding-status';

interface SetupForm {
  key: string;
  remember: boolean;
  passphrase: string;
  passphraseConfirm: string;
}

@Component({
  selector: 'app-onboarding-setup-flow',
  imports: [
    FormField,
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatFormFieldModule,
    MatInputModule,
    MatSlideToggleModule,
    MatProgressSpinnerModule,
    StatusBannerComponent,
    OnboardingHeroComponent,
    TrustStripComponent,
    PassphraseFieldComponent,
    PassphraseStrengthMeterComponent,
  ],
  templateUrl: './setup-flow.html',
  styleUrl: './setup-flow.scss',
})
export class OnboardingSetupFlowComponent {
  protected readonly apiKey = inject(ApiKeyService);
  protected readonly gemini = inject(GeminiService);
  protected readonly config = APP_CONFIG;

  readonly ready = output<void>();

  protected readonly model = signal<SetupForm>({
    key: '',
    remember: false,
    passphrase: '',
    passphraseConfirm: '',
  });

  protected readonly f = form(this.model, (p) => {
    required(p.key, { message: 'Paste your Gemini API key.' });
    required(p.passphrase, {
      message: `Choose a passphrase (at least ${MIN_PASSPHRASE_LENGTH} characters).`,
      when: () => this.model().remember,
    });
    minLength(p.passphrase, MIN_PASSPHRASE_LENGTH, {
      message: `Use at least ${MIN_PASSPHRASE_LENGTH} characters.`,
      when: () => this.model().remember,
    });
    // Reject guessable passphrases — the portable encrypted blob is only as strong as this secret.
    validate(p.passphrase, ({ value }) => {
      if (!this.model().remember) return null;
      return isCommonPassphrase(value())
        ? { kind: 'commonPassphrase', message: 'Too common — choose a more unique passphrase.' }
        : null;
    });
  });

  protected readonly status = signal<OnboardingStatus>({ kind: 'idle' });
  protected readonly showPassphrase = signal(false);

  // Key value that last passed testConnection; editing after verify invalidates Save until re-tested.
  private readonly testedKey = signal<string | null>(null);

  protected readonly connectionVerified = computed(() => {
    const tested = this.testedKey();
    return tested !== null && tested === this.model().key.trim();
  });

  protected readonly passphraseMismatch = computed(() => {
    const m = this.model();
    return (
      m.remember &&
      m.passphrase.length > 0 &&
      m.passphraseConfirm.length > 0 &&
      m.passphrase !== m.passphraseConfirm
    );
  });

  protected readonly passphraseError = computed(() => {
    const field = this.f.passphrase();
    return field.touched() && field.invalid() ? (field.errors()[0]?.message ?? null) : null;
  });

  protected readonly confirmError = computed(() =>
    this.passphraseMismatch() ? "Passphrases don't match." : null,
  );

  protected readonly canTest = computed(() => {
    const s = this.status();
    return this.model().key.trim().length > 0 && s.kind !== 'testing' && s.kind !== 'saving';
  });

  protected readonly canSave = computed(() => {
    const s = this.status();
    if (s.kind === 'saving' || s.kind === 'testing' || s.kind === 'unlocking') return false;
    // Never persist a key that hasn't passed a live connection test.
    if (!this.connectionVerified()) return false;
    if (this.f().invalid()) return false;
    if (this.passphraseMismatch()) return false;
    return true;
  });

  protected get statusKind(): OnboardingStatus['kind'] {
    return this.status().kind;
  }

  protected get errorMessage(): string | null {
    const s = this.status();
    return s.kind === 'error' ? s.message : null;
  }

  protected async test(): Promise<void> {
    const key = this.model().key.trim();
    if (!key) return;
    this.status.set({ kind: 'testing' });
    try {
      await this.gemini.testConnection(key);
      this.testedKey.set(key);
      this.status.set({ kind: 'tested-ok' });
    } catch (err) {
      this.testedKey.set(null);
      this.status.set({ kind: 'error', message: humanizeGeminiError(err) });
    }
  }

  protected async save(): Promise<void> {
    const { key: rawKey, remember, passphrase } = this.model();
    const key = rawKey.trim();
    if (!key) return;
    // Defense-in-depth: never persist an unverified key even if the button were enabled.
    if (!this.connectionVerified()) return;
    this.status.set({ kind: 'saving' });
    try {
      if (remember) {
        await this.apiKey.setEncryptedLocal(key, passphrase);
      } else {
        await this.apiKey.setForSession(key);
      }
      this.status.set({ kind: 'idle' });
      this.ready.emit();
    } catch (err) {
      this.status.set({ kind: 'error', message: humanizeGeminiError(err) });
    }
  }
}
