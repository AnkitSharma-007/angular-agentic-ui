// Shared error taxonomy for Atlas. Any error that reaches a boundary (the
// global ErrorHandler, an RxJS stream, a service, or an interceptor) is
// represented as an `AppError` so it can be classified, logged, redacted, and
// presented through one consistent policy. See `normalize-error.ts` for the
// mapping from raw `unknown` values into this shape.

export type ErrorCategory =
  | 'network'
  | 'api'
  | 'validation'
  | 'auth'
  | 'business'
  | 'client'
  | 'storage'
  | 'abort'
  | 'unknown';

export type ErrorSeverity = 'info' | 'warn' | 'error' | 'fatal';

export interface AppErrorOptions {
  readonly category?: ErrorCategory;
  readonly severity?: ErrorSeverity;
  readonly recoverable?: boolean;
  readonly retryable?: boolean;
  // Safe, redacted message intended for end users. Never contains secrets,
  // request IDs, or raw stack fragments.
  readonly userMessage?: string;
  // Fuller detail for logs / dev builds. Still redacted of secrets, but may
  // carry the original (sanitized) message.
  readonly technicalMessage?: string;
  // Short machine-readable discriminator within a category (e.g. 'rate_limited',
  // 'chunk_load', 'quota_exceeded') for logging and conditional handling.
  readonly code?: string;
  readonly correlationId?: string;
  readonly context?: Readonly<Record<string, unknown>>;
  readonly cause?: unknown;
  readonly handled?: boolean;
}

// App-neutral fallback shown to users when nothing more specific is safe to say.
export const GENERIC_USER_MESSAGE = 'Something went wrong. Please try again.';

const SEVERITY_BY_CATEGORY: Record<ErrorCategory, ErrorSeverity> = {
  network: 'error',
  api: 'error',
  validation: 'warn',
  auth: 'error',
  business: 'info',
  client: 'error',
  storage: 'warn',
  abort: 'info',
  unknown: 'error',
};

const RECOVERABLE_BY_CATEGORY: Record<ErrorCategory, boolean> = {
  network: true,
  api: true,
  validation: true,
  auth: true,
  business: true,
  client: false,
  storage: true,
  abort: true,
  unknown: false,
};

const RETRYABLE_BY_CATEGORY: Record<ErrorCategory, boolean> = {
  network: true,
  api: false,
  validation: false,
  auth: false,
  business: false,
  client: false,
  storage: false,
  abort: false,
  unknown: false,
};

// A single, structured error type carrying everything the pipeline needs. It
// extends the native `Error` so it interops with `instanceof Error`, RxJS, and
// Angular's `ErrorHandler`, while adding classification + presentation metadata.
export class AppError extends Error {
  readonly category: ErrorCategory;
  readonly severity: ErrorSeverity;
  readonly recoverable: boolean;
  readonly retryable: boolean;
  readonly userMessage: string;
  readonly technicalMessage: string;
  readonly code?: string;

  // Enriched as the error propagates (e.g. the stream layer stamps the turnId as
  // the correlationId), so these are intentionally mutable.
  correlationId?: string;
  context?: Readonly<Record<string, unknown>>;

  // Set once a layer has presented this error to the user, so the global handler
  // does not surface it a second time.
  handled: boolean;

  constructor(options: AppErrorOptions = {}) {
    const category = options.category ?? 'unknown';
    const technicalMessage =
      options.technicalMessage ?? options.userMessage ?? category;
    super(technicalMessage, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = 'AppError';
    this.category = category;
    this.severity = options.severity ?? SEVERITY_BY_CATEGORY[category];
    this.recoverable = options.recoverable ?? RECOVERABLE_BY_CATEGORY[category];
    this.retryable = options.retryable ?? RETRYABLE_BY_CATEGORY[category];
    this.userMessage = options.userMessage ?? GENERIC_USER_MESSAGE;
    this.technicalMessage = technicalMessage;
    this.code = options.code;
    this.correlationId = options.correlationId;
    this.context = options.context;
    this.handled = options.handled ?? false;
  }

  // A user-cancelled operation. Never surfaced to the user or logged as an error.
  get isSilent(): boolean {
    return this.category === 'abort';
  }

  // Attach a correlation id / context as the error travels up the stack, without
  // clobbering values a lower layer already set.
  enrich(patch: { correlationId?: string; context?: Record<string, unknown> }): this {
    if (patch.correlationId && !this.correlationId) this.correlationId = patch.correlationId;
    if (patch.context) this.context = { ...this.context, ...patch.context };
    return this;
  }

  markHandled(): this {
    this.handled = true;
    return this;
  }
}

type CategoryOptions = Omit<AppErrorOptions, 'category'>;

// Connectivity / transport failures (fetch, CORS, timeout, offline).
export class NetworkError extends AppError {
  constructor(options: CategoryOptions = {}) {
    super({ ...options, category: 'network' });
    this.name = 'NetworkError';
  }
}

// Server / model responses (HTTP status semantics, rate limits, quota).
export class ApiError extends AppError {
  constructor(options: CategoryOptions = {}) {
    super({ ...options, category: 'api' });
    this.name = 'ApiError';
  }
}

// Input / schema validation failures (Zod, Signal Forms invariants).
export class ValidationError extends AppError {
  constructor(options: CategoryOptions = {}) {
    super({ ...options, category: 'validation' });
    this.name = 'ValidationError';
  }
}

// Credential problems: the BYOK Gemini key, or a failed local unlock.
export class AuthError extends AppError {
  constructor(options: CategoryOptions = {}) {
    super({ ...options, category: 'auth' });
    this.name = 'AuthError';
  }
}

// Domain rule outcomes (budget exceeded, unknown handoff target). Usually
// surfaced as friendly info rather than a red error.
export class BusinessError extends AppError {
  constructor(options: CategoryOptions = {}) {
    super({ ...options, category: 'business' });
    this.name = 'BusinessError';
  }
}

// Unexpected runtime / render / environment errors (chunk-load, WebCrypto or
// Canvas unavailable).
export class ClientError extends AppError {
  constructor(options: CategoryOptions = {}) {
    super({ ...options, category: 'client' });
    this.name = 'ClientError';
  }
}

// Local persistence failures (IndexedDB unavailable/blocked, storage quota).
export class StorageError extends AppError {
  constructor(options: CategoryOptions = {}) {
    super({ ...options, category: 'storage' });
    this.name = 'StorageError';
  }
}

export function isAppError(value: unknown): value is AppError {
  return value instanceof AppError;
}
