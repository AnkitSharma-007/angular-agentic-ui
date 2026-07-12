import { z } from 'zod';

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

// Hard bounds applied when parsing a spec from an untrusted source (IndexedDB
// or an embedded replay payload). They keep a poisoned/oversized row from
// hanging the UI on parse or exhausting the tool registry. Generous enough that
// no legitimately hand-built or agent-proposed tool hits them.
export const MAX_TOOL_NAME = 64;
export const MAX_TOOL_DESCRIPTION = 1000;
export const MAX_PARAMETER_DESCRIPTION = 256;
export const MAX_PARAMETERS = 20;
export const MAX_RESPONSE_TEMPLATE_BYTES = 8 * 1024;
// Cap on how many custom tools we rehydrate into the registry on load. Beyond
// this we keep the newest and drop the rest rather than register unbounded.
export const MAX_CUSTOM_TOOLS = 100;

function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).length;
}

const customToolParameterSchema = z.object({
  name: z.string().regex(IDENTIFIER),
  type: z.enum(['string', 'number', 'boolean']),
  description: z.string().max(MAX_PARAMETER_DESCRIPTION),
  required: z.boolean(),
});

const customToolSpecSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(MAX_TOOL_NAME).regex(IDENTIFIER),
  description: z.string().max(MAX_TOOL_DESCRIPTION),
  parameters: z.array(customToolParameterSchema).max(MAX_PARAMETERS),
  responseTemplate: z
    .string()
    .refine((t) => utf8Bytes(t) <= MAX_RESPONSE_TEMPLATE_BYTES, 'Response template is too large.'),
  origin: z.enum(['user', 'agent']).optional(),
  createdAt: z.number(),
  updatedAt: z.number(),
});

// The proposal/draft contract (a spec without the id/timestamps the service
// stamps at registration). Model-authored `proposeTool` args are validated
// against this at ingestion, so the schema is deliberately as strict as the
// tool-builder UI: identifier-shaped names, bounded strings, a parameter cap,
// and a byte-capped template. (M9)
export const customToolDraftSchema = z.object({
  name: z.string().min(1).max(MAX_TOOL_NAME).regex(IDENTIFIER),
  description: z.string().min(1).max(MAX_TOOL_DESCRIPTION),
  parameters: z.array(customToolParameterSchema).max(MAX_PARAMETERS),
  responseTemplate: z
    .string()
    .min(1)
    .refine((t) => utf8Bytes(t) <= MAX_RESPONSE_TEMPLATE_BYTES, 'Response template is too large.'),
});

export type CustomToolDraft = z.infer<typeof customToolDraftSchema>;

// Validate an untrusted value (e.g. a stored IndexedDB row or a spec embedded
// in a replay) against the spec contract. Returns the value narrowed to
// `CustomToolSpec` on success, or `null` so callers can skip the bad row. The
// original object is returned unchanged (not a Zod clone) so no fields are lost.
export function parseCustomToolSpec(value: unknown): CustomToolSpec | null {
  return customToolSpecSchema.safeParse(value).success ? (value as CustomToolSpec) : null;
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function truncateToBytes(value: string, maxBytes: number): string {
  if (utf8Bytes(value) <= maxBytes) return value;
  // Trim by characters until within the byte budget — cheap and safe for the
  // rare oversized input; correctness matters more than speed here.
  let out = value;
  while (out.length > 0 && utf8Bytes(out) > maxBytes) {
    out = out.slice(0, -1);
  }
  return out;
}

function clampParameter(value: unknown): CustomToolParameter {
  const p = (value ?? {}) as Partial<CustomToolParameter>;
  const type: CustomToolParameterType =
    p.type === 'number' || p.type === 'boolean' ? p.type : 'string';
  return {
    name: asString(p.name).slice(0, MAX_TOOL_NAME),
    type,
    description: asString(p.description).slice(0, MAX_PARAMETER_DESCRIPTION),
    required: p.required === true,
  };
}

// Bound an untrusted, model-authored draft to safe sizes/shape *before* it is
// rendered in the approval card (M9). This never rejects — it clamps — so the
// user still sees an editable proposal; the strict `customToolDraftSchema` +
// the card's own validation gate whether it can actually be approved.
export function clampToolDraft(value: unknown): CustomToolDraft {
  const draft = (value ?? {}) as Record<string, unknown>;
  const rawParams = Array.isArray(draft['parameters']) ? draft['parameters'] : [];
  return {
    name: asString(draft['name']).slice(0, MAX_TOOL_NAME),
    description: asString(draft['description']).slice(0, MAX_TOOL_DESCRIPTION),
    parameters: rawParams.slice(0, MAX_PARAMETERS).map(clampParameter),
    responseTemplate: truncateToBytes(asString(draft['responseTemplate']), MAX_RESPONSE_TEMPLATE_BYTES),
  };
}

export function isValidCustomToolSpec(value: unknown): value is CustomToolSpec {
  return customToolSpecSchema.safeParse(value).success;
}

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
  // Each placeholder is replaced with the JSON representation of its value, so
  // strings come out already quoted. LLMs (and people) frequently wrap the
  // placeholder in quotes anyway (`"{{city}}"`), which would otherwise produce
  // double-quoted, invalid JSON. Handle that quoted form first — stripping the
  // surrounding quotes — then any bare placeholders.
  const substitute = (name: string): string => {
    const v = args[name];
    return v === undefined ? 'null' : JSON.stringify(v);
  };

  const substituted = template
    .replace(/"\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}"/g, (_, name) => substitute(name))
    .replace(/\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g, (_, name) => substitute(name));

  try {
    // Strip prototype-polluting keys during parse (L13). Harmless today because
    // the result is only text-interpolated, but this keeps the boundary safe if
    // the parsed value is ever used structurally.
    return { ok: true, value: JSON.parse(substituted, dropDangerousKeys) };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Invalid JSON after substitution.',
    };
  }
}

const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

// JSON.parse reviver: drop keys that could pollute Object.prototype. Returning
// `undefined` removes the key from the parsed result.
function dropDangerousKeys(key: string, value: unknown): unknown {
  return DANGEROUS_KEYS.has(key) ? undefined : value;
}
