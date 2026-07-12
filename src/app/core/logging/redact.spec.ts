import { describe, expect, it } from 'vitest';
import { REDACTED, redactContext, redactError, redactString } from './redact';

describe('redactString', () => {
  it('scrubs a Google/Gemini API key anywhere in the string', () => {
    const key = 'AIzaSyA1234567890abcdefghijklmnopqrstuvwx';
    const out = redactString(`request failed with key ${key} attached`);
    expect(out).not.toContain(key);
    expect(out).toContain(REDACTED);
  });

  it('scrubs base64 data: URLs (attachment/media previews)', () => {
    const out = redactString('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAUA');
    expect(out).toBe(`data:${REDACTED}`);
  });

  it('scrubs long base64 runs (inline media / ciphertext)', () => {
    const blob = 'a'.repeat(150);
    expect(redactString(`blob=${blob}`)).toBe(`blob=${REDACTED}`);
  });

  it('leaves ordinary messages untouched', () => {
    expect(redactString('something weird happened')).toBe('something weird happened');
    expect(redactString('{"code":500,"detail":"oops"}')).toBe('{"code":500,"detail":"oops"}');
    expect(redactString('')).toBe('');
  });
});

describe('redactContext', () => {
  it('redacts values under sensitive key names regardless of content', () => {
    const out = redactContext({
      apiKey: 'AIzaTotallyReal',
      passphrase: 'hunter2',
      data: 'iVBORw0KGgo',
      model: 'gemini-2.5-flash',
      count: 3,
      ok: true,
    }) as Record<string, unknown>;

    expect(out['apiKey']).toBe(REDACTED);
    expect(out['passphrase']).toBe(REDACTED);
    expect(out['data']).toBe(REDACTED);
    expect(out['model']).toBe('gemini-2.5-flash');
    expect(out['count']).toBe(3);
    expect(out['ok']).toBe(true);
  });

  it('recurses into nested objects and arrays', () => {
    const out = redactContext({
      outer: { inner: { token: 'abc', keep: 'yes' } },
      list: [{ secret: 's' }, { keep: 'y' }],
    }) as { outer: { inner: Record<string, unknown> }; list: Array<Record<string, unknown>> };

    expect(out.outer.inner['token']).toBe(REDACTED);
    expect(out.outer.inner['keep']).toBe('yes');
    expect(out.list[0]['secret']).toBe(REDACTED);
    expect(out.list[1]['keep']).toBe('y');
  });

  it('caps array length', () => {
    const out = redactContext(Array.from({ length: 200 }, (_, i) => i)) as unknown[];
    expect(out.length).toBeLessThanOrEqual(51);
    expect(out.at(-1)).toContain('more');
  });

  it('caps deep nesting instead of recursing forever', () => {
    type Nested = { next?: Nested };
    const root: Nested = {};
    let cursor = root;
    for (let i = 0; i < 20; i++) {
      cursor.next = {};
      cursor = cursor.next;
    }
    // Should not throw and should terminate with a marker.
    expect(() => JSON.stringify(redactContext(root))).not.toThrow();
    expect(JSON.stringify(redactContext(root))).toContain('depth-limited');
  });

  it('passes primitives through', () => {
    expect(redactContext(42)).toBe(42);
    expect(redactContext(null)).toBe(null);
    expect(redactContext(undefined)).toBe(undefined);
  });
});

describe('redactError', () => {
  it('returns a structured, scrubbed representation of an Error', () => {
    const err = new Error('boom with key AIzaSyA1234567890abcdefghijklmnop');
    const out = redactError(err);
    expect(out?.name).toBe('Error');
    expect(out?.message).toContain(REDACTED);
    expect(out?.message).not.toContain('AIzaSy');
  });

  it('handles strings and non-error values', () => {
    expect(redactError('plain')).toEqual({ message: 'plain' });
    expect(redactError({ code: 1 })?.message).toBe('{"code":1}');
    expect(redactError(null)).toBeUndefined();
  });
});
