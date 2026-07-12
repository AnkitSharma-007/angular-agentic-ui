// Pure passphrase-strength scoring used by the onboarding meter. Kept framework-
// free and side-effect-free so it is trivially unit-testable. This is a UX
// signal (encourage a strong passphrase), not a security control — the real
// protection is AES-GCM + PBKDF2 in webcrypto.helpers.ts.

// Minimum length enforced by the onboarding form. Offline-guessing resistance of
// the encrypted key blob scales with passphrase entropy, so we require a
// meaningfully long passphrase rather than the old 6-char floor.
export const MIN_PASSPHRASE_LENGTH = 12;

export type PassphraseScore = 0 | 1 | 2 | 3 | 4;

export interface PassphraseStrength {
  readonly score: PassphraseScore;
  readonly label: string;
  // 0–100, for a progress-bar style meter.
  readonly percent: number;
  // Non-blocking guidance shown under the meter, or null when it is strong.
  readonly hint: string | null;
  // True when the passphrase matches a well-known weak value; surfaced as a
  // stronger warning regardless of length.
  readonly isCommon: boolean;
}

// A short blocklist of the most common weak passphrases. Not exhaustive — just
// enough to nudge users off the obvious ones in a demo/open-source context.
const COMMON_PASSPHRASES = new Set(
  [
    'password',
    'password1',
    'password12',
    'password123',
    'password1234',
    'passwordpassword',
    '123456',
    '1234567',
    '12345678',
    '123456789',
    '1234567890',
    '12345678901',
    '123456789012',
    'qwerty',
    'qwertyuiop',
    'qwertyuiop123',
    'letmein',
    'letmeinplease',
    'welcome',
    'welcome123',
    'admin',
    'iloveyou',
    'iloveyou123',
    'passw0rd',
    'passw0rd123',
    'changeme',
    'changeme123',
    'secret',
    'trustno1',
  ].map((p) => p.toLowerCase()),
);

const LABELS: Record<PassphraseScore, string> = {
  0: 'Very weak',
  1: 'Weak',
  2: 'Fair',
  3: 'Good',
  4: 'Strong',
};

export function isCommonPassphrase(passphrase: string): boolean {
  return COMMON_PASSPHRASES.has(passphrase.trim().toLowerCase());
}

export function scorePassphrase(passphrase: string): PassphraseStrength {
  const value = passphrase ?? '';
  const length = value.length;

  if (length === 0) {
    return { score: 0, label: LABELS[0], percent: 0, hint: null, isCommon: false };
  }

  if (isCommonPassphrase(value)) {
    return {
      score: 0,
      label: LABELS[0],
      percent: 10,
      hint: 'This is a commonly used password — choose something unique.',
      isCommon: true,
    };
  }

  const classes =
    (/[a-z]/.test(value) ? 1 : 0) +
    (/[A-Z]/.test(value) ? 1 : 0) +
    (/[0-9]/.test(value) ? 1 : 0) +
    (/[^A-Za-z0-9]/.test(value) ? 1 : 0);

  let raw = 0;
  if (length >= MIN_PASSPHRASE_LENGTH) raw += 1;
  if (length >= 16) raw += 1;
  if (length >= 20) raw += 1;
  if (classes >= 2) raw += 1;
  if (classes >= 3) raw += 1;

  const score = Math.min(4, raw) as PassphraseScore;

  let hint: string | null = null;
  if (length < MIN_PASSPHRASE_LENGTH) {
    hint = `Use at least ${MIN_PASSPHRASE_LENGTH} characters.`;
  } else if (score < 3) {
    hint = 'Add length or mix in numbers, symbols, or mixed case.';
  }

  return {
    score,
    label: LABELS[score],
    percent: Math.round((score / 4) * 100),
    hint,
    isCommon: false,
  };
}
