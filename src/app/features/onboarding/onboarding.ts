import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal,
  computed,
  output,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
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
import { humanizeGeminiError } from '../../core/errors';

type Status =
  | { kind: 'idle' }
  | { kind: 'testing' }
  | { kind: 'tested-ok' }
  | { kind: 'saving' }
  | { kind: 'unlocking' }
  | { kind: 'error'; message: string };

@Component({
  selector: 'app-onboarding',
  imports: [
    FormsModule,
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

  protected readonly candidateKey = signal('');
  protected readonly remember = signal(false);
  protected readonly passphrase = signal('');
  protected readonly passphraseConfirm = signal('');
  protected readonly status = signal<Status>({ kind: 'idle' });
  protected readonly showPassphrase = signal(false);

  protected readonly mode = computed<'unlock' | 'setup'>(() =>
    this.apiKey.hasLockedBlob() ? 'unlock' : 'setup',
  );

  protected readonly canTest = computed(() => {
    const s = this.status();
    return this.candidateKey().trim().length > 0 && s.kind !== 'testing' && s.kind !== 'saving';
  });

  protected readonly canSave = computed(() => {
    const s = this.status();
    if (s.kind === 'saving' || s.kind === 'testing' || s.kind === 'unlocking') return false;
    if (!this.candidateKey().trim()) return false;
    if (this.remember()) {
      const p = this.passphrase();
      const pc = this.passphraseConfirm();
      if (p.length < 6) return false;
      if (p !== pc) return false;
    }
    return true;
  });

  protected readonly canUnlock = computed(() => {
    const s = this.status();
    return this.passphrase().length > 0 && s.kind !== 'unlocking';
  });

  protected get statusKind(): Status['kind'] {
    return this.status().kind;
  }

  protected get errorMessage(): string | null {
    const s = this.status();
    return s.kind === 'error' ? s.message : null;
  }

  protected async test(): Promise<void> {
    const key = this.candidateKey().trim();
    if (!key) return;
    this.status.set({ kind: 'testing' });
    try {
      await this.gemini.testConnection(key);
      this.status.set({ kind: 'tested-ok' });
    } catch (err) {
      this.status.set({ kind: 'error', message: humanizeGeminiError(err) });
    }
  }

  protected async save(): Promise<void> {
    const key = this.candidateKey().trim();
    if (!key) return;
    this.status.set({ kind: 'saving' });
    try {
      if (this.remember()) {
        await this.apiKey.setEncryptedLocal(key, this.passphrase());
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
      await this.apiKey.unlockLocal(this.passphrase());
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
      this.passphrase.set('');
      this.status.set({ kind: 'idle' });
    }
  }

  protected togglePassphraseVisibility(): void {
    this.showPassphrase.update((v) => !v);
  }
}
