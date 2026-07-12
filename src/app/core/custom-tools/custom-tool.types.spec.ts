import { describe, it, expect } from 'vitest';
import {
  applyResponseTemplate,
  clampToolDraft,
  MAX_PARAMETERS,
  MAX_RESPONSE_TEMPLATE_BYTES,
  MAX_TOOL_DESCRIPTION,
  MAX_TOOL_NAME,
  validateParameterName,
  validateToolName,
} from './custom-tool.types';

describe('validateToolName', () => {
  it('accepts conforming names', () => {
    expect(validateToolName('searchWeather')).toBeNull();
    expect(validateToolName('_private')).toBeNull();
    expect(validateToolName('a')).toBeNull();
  });

  it('rejects empty names', () => {
    expect(validateToolName('')).toBe('Required.');
  });

  it('rejects names starting with a digit', () => {
    expect(validateToolName('1tool')).toMatch(/letters, digits/i);
  });

  it('rejects names with special characters', () => {
    expect(validateToolName('tool-name')).not.toBeNull();
    expect(validateToolName('tool name')).not.toBeNull();
    expect(validateToolName('tool$name')).not.toBeNull();
  });

  it('rejects names over 64 characters', () => {
    const longName = 'a'.repeat(65);
    expect(validateToolName(longName)).toBe('Max 64 characters.');
  });
});

describe('validateParameterName', () => {
  it('accepts conforming names', () => {
    expect(validateParameterName('city')).toBeNull();
    expect(validateParameterName('_x')).toBeNull();
  });

  it('rejects empty names', () => {
    expect(validateParameterName('')).toBe('Required.');
  });

  it('rejects names with special characters', () => {
    expect(validateParameterName('not-allowed')).not.toBeNull();
  });
});

describe('applyResponseTemplate', () => {
  it('substitutes {{paramName}} placeholders with arg values', () => {
    const result = applyResponseTemplate(
      '{"city": {{city}}, "temp": {{temp}}}',
      { city: 'Goa', temp: 28 },
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({ city: 'Goa', temp: 28 });
    }
  });

  it('substitutes booleans correctly', () => {
    const result = applyResponseTemplate('{"flag": {{flag}}}', { flag: true });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual({ flag: true });
  });

  it('passes through literal JSON when no placeholders match', () => {
    const result = applyResponseTemplate('{"static": "value"}', {});
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual({ static: 'value' });
  });

  it('replaces missing placeholders with null', () => {
    const result = applyResponseTemplate('{"missing": {{x}}}', {});
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual({ missing: null });
  });

  it('reports an error when the substituted template is invalid JSON', () => {
    const result = applyResponseTemplate('not json', {});
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.length).toBeGreaterThan(0);
  });

  it('handles strings with quotes by JSON-encoding them', () => {
    const result = applyResponseTemplate(
      '{"msg": {{msg}}}',
      { msg: 'hello "world"' },
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual({ msg: 'hello "world"' });
  });

  it('drops prototype-polluting keys from the parsed output (L13)', () => {
    const result = applyResponseTemplate(
      '{"__proto__": {"polluted": true}, "constructor": 1, "safe": {{v}}}',
      { v: 2 },
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      const value = result.value as Record<string, unknown>;
      expect(value['safe']).toBe(2);
      expect(Object.prototype.hasOwnProperty.call(value, '__proto__')).toBe(false);
      expect(Object.prototype.hasOwnProperty.call(value, 'constructor')).toBe(false);
      // Object.prototype is untouched.
      expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
    }
  });
});

describe('clampToolDraft', () => {
  it('bounds oversized strings, param count, and template bytes (M9)', () => {
    const clamped = clampToolDraft({
      name: 'n'.repeat(MAX_TOOL_NAME + 50),
      description: 'd'.repeat(MAX_TOOL_DESCRIPTION + 50),
      responseTemplate: 'x'.repeat(MAX_RESPONSE_TEMPLATE_BYTES + 100),
      parameters: Array.from({ length: MAX_PARAMETERS + 10 }, (_, i) => ({
        name: `p${i}`,
        type: 'string' as const,
        description: 'ok',
        required: true,
      })),
    });

    expect(clamped.name.length).toBe(MAX_TOOL_NAME);
    expect(clamped.description.length).toBe(MAX_TOOL_DESCRIPTION);
    expect(new TextEncoder().encode(clamped.responseTemplate).length).toBeLessThanOrEqual(
      MAX_RESPONSE_TEMPLATE_BYTES,
    );
    expect(clamped.parameters.length).toBe(MAX_PARAMETERS);
  });

  it('coerces malformed input to a safe empty-ish draft (M9)', () => {
    const clamped = clampToolDraft({
      name: 123,
      parameters: 'not-an-array',
      responseTemplate: null,
    });
    expect(clamped.name).toBe('');
    expect(clamped.description).toBe('');
    expect(clamped.parameters).toEqual([]);
    expect(clamped.responseTemplate).toBe('');
  });

  it('normalizes a bad parameter type to string and coerces required (M9)', () => {
    const clamped = clampToolDraft({
      name: 'ok',
      description: 'ok',
      responseTemplate: '{}',
      parameters: [{ name: 'p', type: 'date', description: 5, required: 'yes' }],
    });
    expect(clamped.parameters[0]).toEqual({
      name: 'p',
      type: 'string',
      description: '',
      required: false,
    });
  });
});
