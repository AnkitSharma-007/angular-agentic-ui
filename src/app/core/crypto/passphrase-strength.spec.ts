import { describe, expect, it } from 'vitest';
import {
  MIN_PASSPHRASE_LENGTH,
  isCommonPassphrase,
  scorePassphrase,
} from './passphrase-strength';

describe('scorePassphrase', () => {
  it('scores an empty passphrase as zero with no hint', () => {
    const s = scorePassphrase('');
    expect(s.score).toBe(0);
    expect(s.percent).toBe(0);
    expect(s.hint).toBeNull();
    expect(s.isCommon).toBe(false);
  });

  it('flags a too-short passphrase with a length hint', () => {
    const s = scorePassphrase('abc123');
    expect(s.hint).toBe(`Use at least ${MIN_PASSPHRASE_LENGTH} characters.`);
    expect(s.score).toBeLessThan(3);
  });

  it('rates a long, mixed passphrase as strong', () => {
    const s = scorePassphrase('Tr0ub4dour&3xtra-Long');
    expect(s.score).toBe(4);
    expect(s.percent).toBe(100);
    expect(s.hint).toBeNull();
    expect(s.isCommon).toBe(false);
  });

  it('marks a common passphrase as weak regardless of length', () => {
    const s = scorePassphrase('password1234');
    expect(s.isCommon).toBe(true);
    expect(s.score).toBe(0);
    expect(s.hint).toMatch(/commonly used/i);
  });
});

describe('isCommonPassphrase', () => {
  it('detects common values case-insensitively', () => {
    expect(isCommonPassphrase('PASSWORD')).toBe(true);
    expect(isCommonPassphrase('  password1234  ')).toBe(true);
  });

  it('does not flag a unique passphrase', () => {
    expect(isCommonPassphrase('correct-horse-battery-staple')).toBe(false);
  });
});
