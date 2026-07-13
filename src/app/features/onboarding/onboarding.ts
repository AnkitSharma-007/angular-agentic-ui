import {
  Component,
  inject,
  signal,
  computed,
  output,
} from '@angular/core';
import { form, required, minLength, validate, FormField } from '@angular/forms/signals';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatDividerModule } from '@angular/material/divider';

import { ApiKeyService } from '../../core/services/api-key.service';
import { GeminiService } from '../../core/services/gemini.service';
import { APP_CONFIG } from '../../core/app-config';
import { DecryptionFailedError } from '../../core/crypto/webcrypto.helpers';
import {
  MIN_PASSPHRASE_LENGTH,
  isCommonPassphrase,
  scorePassphrase,
} from '../../core/crypto/passphrase-strength';
import { humanizeGeminiError } from '../../core/errors';

type Status =
  | { kind: 'idle' }
  | { kind: 'testing' }
  | { kind: 'tested-ok' }
  | { kind: 'saving' }
  | { kind: 'unlocking' }
  | { kind: 'error'; message: string };

interface OnboardingForm {
  key: string;
  remember: boolean;
  passphrase: string;
  passphraseConfirm: string;
}

@Component({
  selector: 'app-onboarding',
  imports: [
    FormField,
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatFormFieldModule,
    MatInputModule,
    MatSlideToggleModule,
    MatProgressSpinnerModule,
    MatDividerModule,
  ],
  templateUrl: './onboarding.html',
  styleUrl: './onboarding.scss',
})
export class OnboardingComponent {
  protected readonly apiKey = inject(ApiKeyService);
  protected readonly gemini = inject(GeminiService);
  protected readonly config = APP_CONFIG;

  readonly ready = output<void>();

  protected readonly model = signal<OnboardingForm>({
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

  protected readonly status = signal<Status>({ kind: 'idle' });
  protected readonly showPassphrase = signal(false);

  // Key value that last passed testConnection; editing after verify invalidates Save until re-tested.
  private readonly testedKey = signal<string | null>(null);

  protected readonly connectionVerified = computed(() => {
    const tested = this.testedKey();
    return tested !== null && tested === this.model().key.trim();
  });

  // Passphrase strength meter — advisory UX only.
  protected readonly passphraseStrength = computed(() =>
    scorePassphrase(this.model().passphrase),
  );

  protected readonly mode = computed<'unlock' | 'setup'>(() =>
    this.apiKey.hasLockedBlob() ? 'unlock' : 'setup',
  );

  // Cross-field passphrase match as computed so it drives inline error and save gate together.
  protected readonly passphraseMismatch = computed(() => {
    const m = this.model();
    return (
      m.remember &&
      m.passphrase.length > 0 &&
      m.passphraseConfirm.length > 0 &&
      m.passphrase !== m.passphraseConfirm
    );
  });

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

  protected readonly canUnlock = computed(() => {
    const s = this.status();
    return this.model().passphrase.length > 0 && s.kind !== 'unlocking';
  });

  protected get statusKind(): Status['kind'] {
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

  // Two-step inline confirm instead of native confirm().
  protected readonly confirmingForget = signal(false);

  protected forgetSavedKey(): void {
    if (!this.confirmingForget()) {
      this.confirmingForget.set(true);
      return;
    }
    this.confirmingForget.set(false);
    void this.apiKey.clear();
    this.model.update((m) => ({ ...m, passphrase: '' }));
    this.status.set({ kind: 'idle' });
  }

  protected cancelForget(): void {
    this.confirmingForget.set(false);
  }

  protected togglePassphraseVisibility(): void {
    this.showPassphrase.update((v) => !v);
  }
}
