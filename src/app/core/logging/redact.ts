// Redaction for logs and user-facing messages. Atlas is a BYOK app whose whole
// trust story is "nothing leaves the browser except calls to Gemini", so no
// diagnostic string may ever carry the API key, a passphrase, or inline media.
// These helpers are pure and heavily tested against adversarial inputs.

export const REDACTED = '[redacted]';

// A base64 data: URL (used for attachment previews and stored replay media).
const DATA_URL = /data:[^;,\s]+;base64,[A-Za-z0-9+/=]+/gi;
// Google API keys ("AIza" + ~35 url-safe chars). The Gemini BYOK key shape.
const GOOGLE_API_KEY = /AIza[0-9A-Za-z_-]{20,}/g;
// Any long base64-ish run (inline media data, ciphertext, salts). Kept last so
// the more specific patterns above win first.
const LONG_BASE64 = /[A-Za-z0-9+/]{100,}={0,2}/g;

// Object keys whose *values* are always redacted regardless of content, because
// their names signal a secret or a media blob.
const SENSITIVE_KEY =
  /^(api[_-]?key|key|passphrase|password|secret|token|authorization|auth|credential|ciphertext|salt|iv|kek|data|databytes|database64|datab64|dataurl)$/i;

// Bounds so a huge object (e.g. rawHistory with inline media) can't blow up the
// logger or a remote sink payload.
const MAX_DEPTH = 6;
const MAX_KEYS = 50;
const MAX_ARRAY = 50;
const MAX_STRING = 2000;

// Scrub secrets from a free-form string (an error message, stack, or value).
export function redactString(input: string): string {
  if (!input) return input;
  return input
    .replace(DATA_URL, `data:${REDACTED}`)
    .replace(GOOGLE_API_KEY, REDACTED)
    .replace(LONG_BASE64, REDACTED);
}

// Deep-clone a structured context value with sensitive keys removed, string
// values scrubbed, and hard depth/breadth caps applied. Never throws.
export function redactContext(value: unknown, depth = 0): unknown {
  if (value == null) return value;
  if (depth > MAX_DEPTH) return '[depth-limited]';

  const type = typeof value;
  if (type === 'string') {
    const s = value as string;
    const capped = s.length > MAX_STRING ? `${s.slice(0, MAX_STRING)}…` : s;
    return redactString(capped);
  }
  if (type === 'number' || type === 'boolean') return value;
  if (type === 'bigint') return `${(value as bigint).toString()}n`;
  if (type === 'function' || type === 'symbol') return `[${type}]`;

  if (Array.isArray(value)) {
    const out = value.slice(0, MAX_ARRAY).map((v) => redactContext(v, depth + 1));
    if (value.length > MAX_ARRAY) out.push(`[+${value.length - MAX_ARRAY} more]`);
    return out;
  }

  if (type === 'object') {
    // Preserve Error shape rather than walking it as a plain object.
    if (value instanceof Error) return redactError(value);
    const out: Record<string, unknown> = {};
    let count = 0;
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (count >= MAX_KEYS) {
        out['…'] = '[truncated]';
        break;
      }
      count++;
      out[k] = SENSITIVE_KEY.test(k) ? REDACTED : redactContext(v, depth + 1);
    }
    return out;
  }

  return '[unserializable]';
}

export interface RedactedError {
  readonly name?: string;
  readonly message?: string;
  readonly stack?: string;
}

// Produce a safe, structured representation of an arbitrary thrown value.
export function redactError(err: unknown): RedactedError | undefined {
  if (err == null) return undefined;
  if (err instanceof Error) {
    return {
      name: err.name,
      message: redactString(err.message ?? ''),
      stack: err.stack ? redactString(err.stack) : undefined,
    };
  }
  if (typeof err === 'string') return { message: redactString(err) };
  return { message: redactString(safeStringify(err)) };
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return '[unstringifiable]';
  }
}
