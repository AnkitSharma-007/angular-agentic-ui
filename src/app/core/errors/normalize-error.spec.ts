import { describe, expect, it } from 'vitest';
import { AppError, GENERIC_USER_MESSAGE } from './app-error';
import { extractMessage, normalizeError, unknownUserMessage } from './normalize-error';

describe('normalizeError — classification', () => {
  it('passes through an existing AppError and enriches context', () => {
    const original = new AppError({ category: 'api', context: { a: 1 } });
    const out = normalizeError(original, { b: 2 });
    expect(out).toBe(original);
    expect(out.context).toEqual({ a: 1, b: 2 });
  });

  it('classifies aborts as silent', () => {
    const out = normalizeError(new DOMException('Aborted', 'AbortError'));
    expect(out.category).toBe('abort');
    expect(out.isSilent).toBe(true);
  });

  it('classifies lazy chunk-load failures as recoverable client errors', () => {
    const out = normalizeError(
      new Error('Failed to fetch dynamically imported module: /chunk-abc.js'),
    );
    expect(out.category).toBe('client');
    expect(out.code).toBe('chunk_load');
    expect(out.retryable).toBe(true);
  });

  it('classifies storage quota (DOMException) as a storage error', () => {
    const out = normalizeError(new DOMException('exceeded', 'QuotaExceededError'));
    expect(out.category).toBe('storage');
    expect(out.code).toBe('quota_exceeded');
  });

  it('classifies auth failures', () => {
    expect(normalizeError(new Error('401 Unauthorized')).category).toBe('auth');
    expect(normalizeError(new Error('Invalid API key')).category).toBe('auth');
  });

  it('classifies rate limits as retryable api errors (not storage)', () => {
    const out = normalizeError(new Error('429 quota exceeded'));
    expect(out.category).toBe('api');
    expect(out.retryable).toBe(true);
  });

  it('classifies network + CORS failures', () => {
    expect(normalizeError(new Error('Failed to fetch')).category).toBe('network');
    expect(normalizeError(new Error('CORS preflight failed')).category).toBe('network');
    expect(normalizeError(new Error('CORS preflight failed')).code).toBe('cors');
  });

  it('classifies zod-shaped validation errors', () => {
    const zodish = Object.assign(new Error('bad input'), { name: 'ZodError', issues: [] });
    expect(normalizeError(zodish).category).toBe('validation');
    expect(normalizeError({ issues: [{ path: [], message: 'x' }] }).category).toBe('validation');
  });

  it('falls back to unknown for unrecognized shapes', () => {
    expect(normalizeError(new Error('something weird happened')).category).toBe('unknown');
  });
});

describe('normalizeError — messaging (dev mode is on under test)', () => {
  it('surfaces the raw (redacted) detail for unknown errors in dev', () => {
    expect(normalizeError(new Error('something weird happened')).userMessage).toBe(
      'something weird happened',
    );
    expect(normalizeError(new Error()).userMessage).toBe('Unknown error.');
  });

  it('uses friendly, safe messages for recognized categories', () => {
    expect(normalizeError(new Error('401 Unauthorized')).userMessage).toMatch(
      /Authentication failed/,
    );
    expect(normalizeError(new Error('Failed to fetch')).userMessage).toMatch(/Network error/);
  });

  it('redacts secrets out of the technical message', () => {
    const out = normalizeError(new Error('boom key=AIzaSyA1234567890abcdefghijklmnop'));
    expect(out.technicalMessage).not.toContain('AIzaSy');
  });
});

describe('unknownUserMessage', () => {
  it('shows the technical detail in dev and a generic message in prod', () => {
    expect(unknownUserMessage('internal detail', true)).toBe('internal detail');
    expect(unknownUserMessage('', true)).toBe('Unknown error.');
    expect(unknownUserMessage('internal detail', false)).toBe(GENERIC_USER_MESSAGE);
  });
});

describe('extractMessage', () => {
  it('digs a message out of common shapes', () => {
    expect(extractMessage(null)).toBe('');
    expect(extractMessage('plain')).toBe('plain');
    expect(extractMessage(404)).toBe('404');
    expect(extractMessage(new Error('boom'))).toBe('boom');
    expect(extractMessage({ message: 'from field' })).toBe('from field');
    expect(extractMessage({ code: 500, detail: 'oops' })).toBe('{"code":500,"detail":"oops"}');
  });
});
