import { isDevMode } from '@angular/core';
import {
  ApiError,
  AppError,
  AuthError,
  ClientError,
  GENERIC_USER_MESSAGE,
  NetworkError,
  StorageError,
  ValidationError,
} from './app-error';
import { redactString } from '../logging/redact';

// The single source of error classification for Atlas. Turns any thrown value
// into a structured `AppError` with a category, a safe user message, and
// (redacted) technical detail. The textual heuristics below intentionally
// preserve the behavior of the legacy `humanizeGeminiError` so migrating call
// sites is a no-op for users.

export function normalizeError(err: unknown, context?: Record<string, unknown>): AppError {
  // Already normalized — just enrich with any newly-available context.
  if (err instanceof AppError) {
    return context ? err.enrich({ context }) : err;
  }

  const message = extractMessage(err);
  // Technical detail is redacted up front so even dev logs / messages are safe.
  const technicalMessage = redactString(message);

  // Cancellation — a recognized, always-silent sentinel.
  if (isAbortError(err, message)) {
    return new AppError({
      category: 'abort',
      severity: 'info',
      userMessage: 'Request cancelled.',
      technicalMessage,
      recoverable: true,
      context,
      cause: err,
    });
  }

  // Angular HttpClient failure. Forward-looking: no HttpClient consumer ships
  // today (Gemini traffic goes through the @google/genai SDK), but the
  // interceptor + this status-based mapping are ready for the first one. Matched
  // by duck-typing so this core module stays free of an @angular/common/http
  // import; status wins over the textual heuristics below.
  if (isHttpErrorResponse(err)) {
    return httpErrorToAppError(err, technicalMessage, context);
  }

  // A lazily-loaded chunk failed to import — usually a stale deploy or a blip
  // while offline. Recoverable via reload.
  if (isChunkLoadError(err, message)) {
    return new ClientError({
      code: 'chunk_load',
      userMessage: 'A new version of the app is available. Reload to continue.',
      technicalMessage,
      recoverable: true,
      retryable: true,
      context,
      cause: err,
    });
  }

  // Local persistence ran out of room (localStorage/IndexedDB quota).
  if (isQuotaExceeded(err)) {
    return new StorageError({
      code: 'quota_exceeded',
      userMessage: 'Your browser storage is full. Delete some saved runs and try again.',
      technicalMessage,
      context,
      cause: err,
    });
  }

  // Textual classification of Gemini / transport errors. Order matches the
  // legacy humanizer: auth → rate limit → network → CORS.
  if (/401|unauthorized|api key/i.test(message)) {
    return new AuthError({
      code: 'unauthorized',
      userMessage:
        'Authentication failed. Your API key may be invalid or expired. Open Settings to update it.',
      technicalMessage,
      context,
      cause: err,
    });
  }
  if (/429|rate.?limit|quota/i.test(message)) {
    return new ApiError({
      code: 'rate_limited',
      retryable: true,
      userMessage:
        'Gemini rate-limited the request. Wait a moment and try again, or switch models in Settings.',
      technicalMessage,
      context,
      cause: err,
    });
  }
  if (/network|fetch|failed to fetch/i.test(message)) {
    return new NetworkError({
      userMessage: 'Network error reaching Gemini. Check your connection and try again.',
      technicalMessage,
      context,
      cause: err,
    });
  }
  if (/cors/i.test(message)) {
    return new NetworkError({
      code: 'cors',
      userMessage: 'Browser blocked the request (CORS). Reload the page and try again.',
      technicalMessage,
      context,
      cause: err,
    });
  }

  // Schema / input validation (Zod and friends).
  if (isValidationError(err)) {
    return new ValidationError({
      userMessage: 'Some values were invalid. Please check your input and try again.',
      technicalMessage,
      context,
      cause: err,
    });
  }

  // Unrecognized. Dev builds surface the (redacted) detail to aid debugging;
  // production shows a generic message so nothing internal leaks.
  return new AppError({
    category: 'unknown',
    userMessage: unknownUserMessage(technicalMessage, isDevMode()),
    technicalMessage,
    context,
    cause: err,
  });
}

// Message shown for an unrecognized error. Split out (and `isDev` injected) so
// both the dev-detail and prod-generic branches are unit-testable without
// mocking Angular's global dev-mode flag.
export function unknownUserMessage(technicalMessage: string, isDev: boolean): string {
  return isDev ? technicalMessage || 'Unknown error.' : GENERIC_USER_MESSAGE;
}

// Storage-context normalization. Quota already classifies via `normalizeError`
// (QuotaExceededError -> StorageError). Within an IndexedDB/localStorage flow,
// an otherwise-unclassified failure — an open that is blocked or version-errored,
// a private-mode rejection — is still a storage problem, so re-tag it as a
// StorageError with actionable copy. Recognized categories pass through.
export function normalizeStorageError(err: unknown, context?: Record<string, unknown>): AppError {
  const normalized = normalizeError(err, context);
  if (normalized.category !== 'unknown') return normalized;
  return new StorageError({
    code: 'idb_unavailable',
    userMessage:
      'Your browser blocked local storage, so saved data may be unavailable. Check your privacy settings and try again.',
    technicalMessage: normalized.technicalMessage,
    context,
    cause: err,
  });
}

// Best-effort extraction of a human string from an unknown throwable. Mirrors
// the legacy `humanizeGeminiError` implementation so the adapter is
// byte-for-byte compatible: plain-object rejections dig out `.message` (or
// JSON-stringify) rather than collapsing to "[object Object]".
export function extractMessage(err: unknown): string {
  if (err == null) return '';
  if (err instanceof Error) return err.message ?? '';
  if (typeof err === 'string') return err;
  if (typeof err === 'number' || typeof err === 'boolean') return String(err);
  if (typeof err === 'object') {
    const msg = (err as { message?: unknown }).message;
    if (typeof msg === 'string' && msg.length > 0) return msg;
    try {
      return JSON.stringify(err);
    } catch {
      return '[unprintable error]';
    }
  }
  return String(err);
}

// Minimal structural view of an Angular `HttpErrorResponse` — enough to
// classify by status without importing the HTTP package into the core.
interface HttpErrorLike {
  readonly name: string;
  readonly status: number;
  readonly statusText?: string;
  readonly url?: string | null;
}

function isHttpErrorResponse(err: unknown): err is HttpErrorLike {
  return (
    typeof err === 'object' &&
    err !== null &&
    (err as { name?: unknown }).name === 'HttpErrorResponse' &&
    typeof (err as { status?: unknown }).status === 'number'
  );
}

// Map an HTTP status onto the taxonomy. Retryable only where a later attempt can
// plausibly succeed (transport failure, timeout, rate-limit, transient 5xx).
function httpErrorToAppError(
  err: HttpErrorLike,
  technicalMessage: string,
  context?: Record<string, unknown>,
): AppError {
  const status = err.status;
  const ctx = { ...context, httpStatus: status };

  // Status 0: the browser never received a response (offline, DNS, CORS, or a
  // dropped connection) — a transport problem, not a server one.
  if (status === 0) {
    return new NetworkError({
      code: 'offline',
      retryable: true,
      userMessage:
        'Network error: the request could not be completed. Check your connection and try again.',
      technicalMessage,
      context: ctx,
      cause: err,
    });
  }
  if (status === 401 || status === 403) {
    return new AuthError({
      code: status === 401 ? 'unauthorized' : 'forbidden',
      userMessage:
        'Authentication failed. Your API key may be invalid or expired. Open Settings to update it.',
      technicalMessage,
      context: ctx,
      cause: err,
    });
  }
  if (status === 408 || status === 504) {
    return new NetworkError({
      code: 'timeout',
      retryable: true,
      userMessage: 'The request timed out. Please try again.',
      technicalMessage,
      context: ctx,
      cause: err,
    });
  }
  if (status === 429) {
    return new ApiError({
      code: 'rate_limited',
      retryable: true,
      userMessage: 'Rate-limited. Wait a moment and try again.',
      technicalMessage,
      context: ctx,
      cause: err,
    });
  }
  if (status === 400 || status === 422) {
    return new ValidationError({
      code: `http_${status}`,
      userMessage: 'The request was rejected as invalid. Please check your input and try again.',
      technicalMessage,
      context: ctx,
      cause: err,
    });
  }
  if (status >= 500) {
    return new ApiError({
      code: 'server_error',
      retryable: status === 502 || status === 503,
      userMessage: 'The server had a problem handling the request. Please try again shortly.',
      technicalMessage,
      context: ctx,
      cause: err,
    });
  }
  // Other 4xx (404, 409, …): a client/API error a plain retry won't fix.
  return new ApiError({
    code: `http_${status}`,
    userMessage: 'The request could not be completed.',
    technicalMessage,
    context: ctx,
    cause: err,
  });
}

function isAbortError(err: unknown, message: string): boolean {
  if (err instanceof DOMException && err.name === 'AbortError') return true;
  if (err instanceof Error && err.name === 'AbortError') return true;
  return /\bAbortError\b/.test(message);
}

function isChunkLoadError(err: unknown, message: string): boolean {
  if (err instanceof Error && err.name === 'ChunkLoadError') return true;
  return /failed to fetch dynamically imported module|error loading dynamically imported module|importing a module script failed|loading chunk \d+ failed|ChunkLoadError/i.test(
    message,
  );
}

function isQuotaExceeded(err: unknown): boolean {
  if (err instanceof DOMException) {
    // Firefox reports code 22 (or 1014 for NS_ERROR_DOM_QUOTA_REACHED).
    return err.name === 'QuotaExceededError' || err.code === 22 || err.code === 1014;
  }
  return err instanceof Error && err.name === 'QuotaExceededError';
}

function isValidationError(err: unknown): boolean {
  if (err instanceof Error && (err.name === 'ZodError' || err.name === '$ZodError')) {
    return true;
  }
  return (
    typeof err === 'object' &&
    err !== null &&
    'issues' in err &&
    Array.isArray((err as { issues?: unknown }).issues)
  );
}
