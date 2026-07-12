import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OnboardingComponent } from './onboarding';
import { GeminiService } from '../../core/services/gemini.service';
import { ApiKeyService } from '../../core/services/api-key.service';

interface OnboardingForm {
  key: string;
  remember: boolean;
  passphrase: string;
  passphraseConfirm: string;
}

interface OnboardingInternals {
  readonly model: { update: (fn: (m: OnboardingForm) => OnboardingForm) => void };
  readonly canTest: () => boolean;
  readonly canSave: () => boolean;
  readonly connectionVerified: () => boolean;
  test(): Promise<void>;
  save(): Promise<void>;
  statusKind: string;
  errorMessage: string | null;
}

// A passphrase that clears the ≥12 length floor and isn't on the common list.
const STRONG_PASSPHRASE = 'correct-horse-battery-staple';

function patch(inst: OnboardingInternals, next: Partial<OnboardingForm>): void {
  inst.model.update((m) => ({ ...m, ...next }));
}

describe('OnboardingComponent', () => {
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [provideZonelessChangeDetection(), provideAnimationsAsync()],
    });
  });

  afterEach(() => {
    sessionStorage.clear();
    localStorage.clear();
  });

  it('renders the setup mode by default', async () => {
    const fixture = TestBed.createComponent(OnboardingComponent);
    await fixture.whenStable();
    expect(fixture.componentInstance).toBeDefined();
  });

  it('canTest is false until a key is entered', async () => {
    const fixture = TestBed.createComponent(OnboardingComponent);
    await fixture.whenStable();
    const inst = fixture.componentInstance as unknown as OnboardingInternals;
    expect(inst.canTest()).toBe(false);
    patch(inst, { key: 'sk-1234' });
    expect(inst.canTest()).toBe(true);
  });

  it('canSave requires a verified connection before anything else (H7)', async () => {
    const gemini = TestBed.inject(GeminiService);
    vi.spyOn(gemini, 'testConnection').mockResolvedValue(true);

    const fixture = TestBed.createComponent(OnboardingComponent);
    await fixture.whenStable();
    const inst = fixture.componentInstance as unknown as OnboardingInternals;

    patch(inst, { key: 'sk-1234' });
    // A valid key that has not been tested cannot be saved.
    expect(inst.canSave()).toBe(false);

    await inst.test();
    expect(inst.connectionVerified()).toBe(true);
    expect(inst.canSave()).toBe(true);
  });

  it('editing the key after a successful test re-locks Save (H7)', async () => {
    const gemini = TestBed.inject(GeminiService);
    vi.spyOn(gemini, 'testConnection').mockResolvedValue(true);

    const fixture = TestBed.createComponent(OnboardingComponent);
    await fixture.whenStable();
    const inst = fixture.componentInstance as unknown as OnboardingInternals;

    patch(inst, { key: 'sk-1234' });
    await inst.test();
    expect(inst.canSave()).toBe(true);

    patch(inst, { key: 'sk-changed' });
    expect(inst.connectionVerified()).toBe(false);
    expect(inst.canSave()).toBe(false);
  });

  it('canSave gates passphrase length and confirmation when remember=true (M8)', async () => {
    const gemini = TestBed.inject(GeminiService);
    vi.spyOn(gemini, 'testConnection').mockResolvedValue(true);

    const fixture = TestBed.createComponent(OnboardingComponent);
    await fixture.whenStable();
    const inst = fixture.componentInstance as unknown as OnboardingInternals;

    patch(inst, { key: 'sk-1234' });
    await inst.test();
    expect(inst.canSave()).toBe(true);

    patch(inst, { remember: true });
    expect(inst.canSave()).toBe(false);

    // 10 chars — below the ≥12 floor.
    patch(inst, { passphrase: 'shortphrase', passphraseConfirm: 'shortphrase' });
    expect(inst.canSave()).toBe(false);

    patch(inst, { passphrase: STRONG_PASSPHRASE, passphraseConfirm: 'different-value' });
    expect(inst.canSave()).toBe(false);

    patch(inst, { passphraseConfirm: STRONG_PASSPHRASE });
    expect(inst.canSave()).toBe(true);
  });

  it('canSave rejects a common passphrase even when long enough (M8)', async () => {
    const gemini = TestBed.inject(GeminiService);
    vi.spyOn(gemini, 'testConnection').mockResolvedValue(true);

    const fixture = TestBed.createComponent(OnboardingComponent);
    await fixture.whenStable();
    const inst = fixture.componentInstance as unknown as OnboardingInternals;

    patch(inst, { key: 'sk-1234' });
    await inst.test();
    patch(inst, {
      remember: true,
      passphrase: 'password1234',
      passphraseConfirm: 'password1234',
    });
    expect(inst.canSave()).toBe(false);
  });

  it('test() resolves to tested-ok on success', async () => {
    const gemini = TestBed.inject(GeminiService);
    vi.spyOn(gemini, 'testConnection').mockResolvedValue(true);

    const fixture = TestBed.createComponent(OnboardingComponent);
    await fixture.whenStable();
    const inst = fixture.componentInstance as unknown as OnboardingInternals;

    patch(inst, { key: 'sk-1234' });
    await inst.test();
    expect(inst.statusKind).toBe('tested-ok');
  });

  it('test() surfaces a humanised error on failure', async () => {
    const gemini = TestBed.inject(GeminiService);
    vi.spyOn(gemini, 'testConnection').mockRejectedValue(new Error('401 unauthorized'));

    const fixture = TestBed.createComponent(OnboardingComponent);
    await fixture.whenStable();
    const inst = fixture.componentInstance as unknown as OnboardingInternals;

    patch(inst, { key: 'sk-1234' });
    await inst.test();
    expect(inst.statusKind).toBe('error');
    expect(inst.errorMessage).toMatch(/Authentication failed/);
  });

  it('save() (session mode) stores the key in ApiKeyService after a verified test', async () => {
    const apiKey = TestBed.inject(ApiKeyService);
    const gemini = TestBed.inject(GeminiService);
    vi.spyOn(gemini, 'testConnection').mockResolvedValue(true);

    const fixture = TestBed.createComponent(OnboardingComponent);
    await fixture.whenStable();
    const inst = fixture.componentInstance as unknown as OnboardingInternals;

    patch(inst, { key: 'sk-1234' });
    await inst.test();
    await inst.save();

    expect(apiKey.key()).toBe('sk-1234');
    expect(apiKey.storage()).toBe('session');
  });

  it('save() is a no-op until the connection is verified (H7)', async () => {
    const apiKey = TestBed.inject(ApiKeyService);

    const fixture = TestBed.createComponent(OnboardingComponent);
    await fixture.whenStable();
    const inst = fixture.componentInstance as unknown as OnboardingInternals;

    patch(inst, { key: 'sk-1234' });
    await inst.save();

    expect(apiKey.key()).toBeNull();
  });
});
