import { describe, expect, it } from 'vitest';
import { proposeToolDescriptor } from './propose-tool.descriptor';
import { PROPOSE_TOOL_NAME } from './propose-tool.manifest';

const VALID_DRAFT = {
  name: 'searchWeather',
  description: 'Get a weather forecast for a city.',
  parameters: [
    { name: 'city', type: 'string' as const, description: 'City name.', required: true },
    { name: 'days', type: 'number' as const, description: 'Forecast horizon.', required: false },
  ],
  responseTemplate: '{"city": {{city}}, "tempC": 27}',
};

describe('proposeToolDescriptor', () => {
  it('is interruptive and wired to the proposeTool name', () => {
    expect(proposeToolDescriptor.name).toBe(PROPOSE_TOOL_NAME);
    expect(proposeToolDescriptor.interruptive).toBe(true);
    expect(proposeToolDescriptor.component).toBeDefined();
  });

  it('accepts a well-formed draft', () => {
    const parsed = proposeToolDescriptor.argsSchema.safeParse(VALID_DRAFT);
    expect(parsed.success).toBe(true);
  });

  it('accepts a draft with no parameters', () => {
    const parsed = proposeToolDescriptor.argsSchema.safeParse({
      ...VALID_DRAFT,
      parameters: [],
    });
    expect(parsed.success).toBe(true);
  });

  it('rejects an unknown parameter type', () => {
    const parsed = proposeToolDescriptor.argsSchema.safeParse({
      ...VALID_DRAFT,
      parameters: [{ name: 'x', type: 'date', description: 'd', required: true }],
    });
    expect(parsed.success).toBe(false);
  });

  it('rejects a missing name / description / responseTemplate', () => {
    expect(proposeToolDescriptor.argsSchema.safeParse({ ...VALID_DRAFT, name: '' }).success).toBe(
      false,
    );
    expect(
      proposeToolDescriptor.argsSchema.safeParse({ ...VALID_DRAFT, description: '' }).success,
    ).toBe(false);
    expect(
      proposeToolDescriptor.argsSchema.safeParse({ ...VALID_DRAFT, responseTemplate: '' }).success,
    ).toBe(false);
  });

  it('rejects a non-identifier tool name (M9)', () => {
    expect(
      proposeToolDescriptor.argsSchema.safeParse({ ...VALID_DRAFT, name: 'has space' }).success,
    ).toBe(false);
    expect(
      proposeToolDescriptor.argsSchema.safeParse({ ...VALID_DRAFT, name: '1startsWithDigit' })
        .success,
    ).toBe(false);
  });

  it('rejects a non-identifier parameter name (M9)', () => {
    const parsed = proposeToolDescriptor.argsSchema.safeParse({
      ...VALID_DRAFT,
      parameters: [{ name: 'not a name', type: 'string', description: 'd', required: true }],
    });
    expect(parsed.success).toBe(false);
  });

  it('rejects an over-long tool name (M9)', () => {
    const parsed = proposeToolDescriptor.argsSchema.safeParse({
      ...VALID_DRAFT,
      name: 'a'.repeat(65),
    });
    expect(parsed.success).toBe(false);
  });

  it('rejects too many parameters (M9)', () => {
    const parameters = Array.from({ length: 21 }, (_, i) => ({
      name: `p${i}`,
      type: 'string' as const,
      description: 'd',
      required: false,
    }));
    expect(proposeToolDescriptor.argsSchema.safeParse({ ...VALID_DRAFT, parameters }).success).toBe(
      false,
    );
  });

  it('rejects an oversized response template (M9)', () => {
    const parsed = proposeToolDescriptor.argsSchema.safeParse({
      ...VALID_DRAFT,
      responseTemplate: 'x'.repeat(8 * 1024 + 1),
    });
    expect(parsed.success).toBe(false);
  });

  it('has a defensive executor that never claims registration', async () => {
    const result = await proposeToolDescriptor.execute(VALID_DRAFT, {
      callId: 'c1',
      signal: new AbortController().signal,
    });
    expect(result.selected.registered).toBe(false);
    expect(result.selected.name).toBe('searchWeather');
  });
});
