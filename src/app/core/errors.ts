import { normalizeError } from './errors/normalize-error';

/**
 * Map raw errors thrown by the Gemini SDK or fetch into short, user-facing
 * strings.
 *
 * @deprecated Thin adapter retained for existing call sites. New code should use
 * `ErrorService.handle` / `normalizeError` and read `AppError.userMessage`, so
 * classification lives in a single place (`core/errors/normalize-error.ts`).
 * This function now delegates there and returns the resulting `userMessage`.
 */
export function humanizeGeminiError(err: unknown): string {
  return normalizeError(err).userMessage;
}
