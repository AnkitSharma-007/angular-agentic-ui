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

// Single source of error classification. Textual heuristics preserve legacy humanizeGeminiError behavior for migration.

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

  // HttpErrorResponse (duck-typed to avoid @angular/common/http import). Status wins over textual heuristics below.
  if (isHttpErrorResponse(err)) {
    return httpErrorToAppError(err, technicalMessage, context);
  }

  // Lazy chunk import failed (stale deploy/offline) — recoverable via reload.
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
      userMessage: 'Your browser storage is full. Delete some saved conversations and try again.',
      technicalMessage,
      context,
      cause: err,
    });
  }

  // Textual Gemini/transport classification; order: auth → rate limit → network → CORS (legacy humanizer parity).
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

  if (isValidationError(err)) {
    return new ValidationError({
      userMessage: 'Some values were invalid. Please check your input and try again.',
      technicalMessage,
      context,
      cause: err,
    });
  }

  // Unrecognized: dev surfaces redacted detail; production shows generic message.
  return new AppError({
    category: 'unknown',
    userMessage: unknownUserMessage(technicalMessage, isDevMode()),
    technicalMessage,
    context,
    cause: err,
  });
}

// Split out (isDev injected) so dev/prod branches are unit-testable without mocking isDevMode().
export function unknownUserMessage(technicalMessage: string, isDev: boolean): string {
  return isDev ? technicalMessage || 'Unknown error.' : GENERIC_USER_MESSAGE;
}

// Re-tag unknown IDB/localStorage failures as StorageError; recognized categories and quota pass through.
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

// Mirrors legacy humanizeGeminiError: plain objects use .message or JSON-stringify, not "[object Object]".
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

// Minimal HttpErrorResponse shape for status classification without importing HTTP package.
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

// Map HTTP status to taxonomy; retryable only when a later attempt can plausibly succeed.
function httpErrorToAppError(
  err: HttpErrorLike,
  technicalMessage: string,
  context?: Record<string, unknown>,
): AppError {
  const status = err.status;
  const ctx = { ...context, httpStatus: status };

  // Status 0: browser got no response (offline/DNS/CORS/dropped connection) — transport, not server.
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
