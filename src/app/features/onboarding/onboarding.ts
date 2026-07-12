import {
  ChangeDetectionStrategy,
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
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OnboardingComponent {
  protected readonly apiKey = inject(ApiKeyService);
  protected readonly gemini = inject(GeminiService);
  protected readonly config = APP_CONFIG;

  readonly ready = output<void>();

  // Signal Forms model — the single source of truth the schema validates and the
  // template binds to via `[formField]`.
  protected readonly model = signal<OnboardingForm>({
    key: '',
    remember: false,
    passphrase: '',
    passphraseConfirm: '',
  });

  // Passphrase validators only apply when the user opts into persistent storage.
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
    // Block obviously-guessable passphrases outright — the encrypted blob is
    // portable, so a weak passphrase is the whole ballgame for offline guessing.
    validate(p.passphrase, ({ value }) => {
      if (!this.model().remember) return null;
      return isCommonPassphrase(value())
        ? { kind: 'commonPassphrase', message: 'Too common — choose a more unique passphrase.' }
        : null;
    });
  });

  protected readonly status = signal<Status>({ kind: 'idle' });
  protected readonly showPassphrase = signal(false);

  // The exact key value that last passed `testConnection`. Comparing it against
  // the current input means editing the key after a successful test invalidates
  // the "verified" state, so the user must re-test before Save re-enables (H7).
  private readonly testedKey = signal<string | null>(null);

  protected readonly connectionVerified = computed(() => {
    const tested = this.testedKey();
    return tested !== null && tested === this.model().key.trim();
  });

  // Strength meter for the persistence passphrase (M8). Advisory UX only.
  protected readonly passphraseStrength = computed(() =>
    scorePassphrase(this.model().passphrase),
  );

  protected readonly mode = computed<'unlock' | 'setup'>(() =>
    this.apiKey.hasLockedBlob() ? 'unlock' : 'setup',
  );

  // Cross-field check kept as a computed (rather than a schema validator) so it can
  // drive both the inline error and the save gate without a targeted-error dance.
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
    // H7: never persist a key we haven't confirmed works against the live API.
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
    // H7 defense-in-depth: the button is disabled when unverified, but never
    // persist a key that hasn't passed a live connection test.
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

  protected forgetSavedKey(): void {
    const confirmed = confirm(
      'Forget the encrypted key stored on this device? You will need to paste a key again.',
    );
    if (confirmed) {
      void this.apiKey.clear();
      this.model.update((m) => ({ ...m, passphrase: '' }));
      this.status.set({ kind: 'idle' });
    }
  }

  protected togglePassphraseVisibility(): void {
    this.showPassphrase.update((v) => !v);
  }
}
