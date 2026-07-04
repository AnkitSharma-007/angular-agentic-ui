// Who authored a custom tool. `agent` = proposed by the model via `proposeTool`
// and approved by the user; `user` = hand-built in the tool builder.
export type CustomToolOrigin = 'user' | 'agent';

export interface CustomToolSpec {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly parameters: readonly CustomToolParameter[];
  readonly responseTemplate: string;
  // Provenance. Optional so specs persisted before this field existed still
  // load; read it through `toolOrigin()` which defaults absent values to 'user'.
  readonly origin?: CustomToolOrigin;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export function toolOrigin(spec: Pick<CustomToolSpec, 'origin'>): CustomToolOrigin {
  return spec.origin ?? 'user';
}

export interface CustomToolParameter {
  readonly name: string;
  readonly type: 'string' | 'number' | 'boolean';
  readonly description: string;
  readonly required: boolean;
}

export type CustomToolParameterType = CustomToolParameter['type'];

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;
const IDENTIFIER_MSG = 'Letters, digits, underscores; must start with a letter or underscore.';

export function validateToolName(name: string): string | null {
  if (!name) return 'Required.';
  if (name.length > 64) return 'Max 64 characters.';
  if (!IDENTIFIER.test(name)) return IDENTIFIER_MSG;
  return null;
}

export function validateParameterName(name: string): string | null {
  if (!name) return 'Required.';
  if (!IDENTIFIER.test(name)) return IDENTIFIER_MSG;
  return null;
}

export function applyResponseTemplate(
  template: string,
  args: Record<string, unknown>,
): { ok: true; value: unknown } | { ok: false; error: string } {
  const substituted = template.replace(/\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g, (_, name) => {
    const v = args[name as string];
    return v === undefined ? 'null' : JSON.stringify(v);
  });

  try {
    return { ok: true, value: JSON.parse(substituted) };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Invalid JSON after substitution.',
    };
  }
}
