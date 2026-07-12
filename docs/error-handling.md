# Error handling — developer guide

Atlas funnels every error through one pipeline: **raw `unknown` → `AppError` → logged (redacted) → presented per policy.** This keeps user messaging consistent, keeps secrets out of logs, and keeps the "nothing leaves the browser except calls to Gemini" posture intact (there is no remote logging).

```
raw unknown ──▶ normalizeError() ──▶ AppError ──▶ LoggerService (redact + sinks)
                                        │
                                        └──▶ ErrorService policy ──▶ toast │ shell │ inline │ none
```

## The building blocks

| Piece                   | File                                           | Role                                                                                                                                                 |
| ----------------------- | ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AppError` + subclasses | `core/errors/app-error.ts`                     | Typed error with `category`, `severity`, `recoverable`, `retryable`, `userMessage`, `technicalMessage`, `code`, `correlationId`, `context`, `cause`. |
| `normalizeError`        | `core/errors/normalize-error.ts`               | The single classifier: any value → `AppError`. Also `normalizeStorageError` (storage-context) and the HTTP-status mapping.                           |
| `ErrorService`          | `core/errors/error.service.ts`                 | `handle()` = normalize → log → present. `normalize()` = classify only.                                                                               |
| `LoggerService`         | `core/logging/logger.service.ts`               | The only place that touches the console. Redacts once, fans out to `LOG_SINKS`.                                                                      |
| `GlobalErrorHandler`    | `core/errors/global-error-handler.ts`          | Last-line backstop for uncaught throws / rejections.                                                                                                 |
| `NotificationService`   | `shared/notifications/notification.service.ts` | Toasts (`info`/`success`/`warn`/`error`, dedupe, auto-dismiss, optional action).                                                                     |
| `retryWithBackoff`      | `core/errors/retry.ts`                         | Abort-aware, jittered exponential backoff for **setup-only** retries.                                                                                |
| `ConnectivityService`   | `core/connectivity/connectivity.service.ts`    | `online`/`offline` signals for gating.                                                                                                               |

## Error categories

`network · api · validation · auth · business · client · storage · abort · unknown`

Pick the subclass that matches (`NetworkError`, `ApiError`, `ValidationError`, `AuthError`, `BusinessError`, `ClientError`, `StorageError`) or plain `AppError` for `abort`/`unknown`. Category drives the default `severity`, `recoverable`, and `retryable` (see `app-error.ts`), so you rarely set those by hand.

- **`abort` is always silent.** User cancellation (`DOMException 'AbortError'`) is never logged as an error and never surfaced. Don't fight it — `normalizeError` already recognizes it.

## How to throw (services / core)

Throw a typed `AppError` at the boundary where you have the most context, and attach the original `cause`:

```ts
try {
  localStorage.setItem(KEY, value);
} catch (err) {
  throw new StorageError({
    code: 'local_write_failed',
    userMessage: 'Could not save to this browser. Storage may be full or disabled.',
    technicalMessage: 'localStorage.setItem failed',
    cause: err,
  });
}
```

Rules for services:

- **Never `console.*`.** Inject `LoggerService` and call `logger.debug/info/warn/error(message, { category, context, error })`.
- **Never swallow silently.** A `catch {}` that intentionally degrades must still `logger.debug/warn` so the diagnostic isn't lost.
- **Preserve degradation contracts.** Methods like `restore()` / `load()` / `refresh()` must not throw — they log and flip a signal (`unavailable`, `lastError`, …).
- For storage flows, prefer `normalizeStorageError(err, ctx)` so a blocked/unknown IndexedDB failure is still tagged `storage`.

## How to handle (components / boundaries)

Route unexpected errors through `ErrorService.handle()` and let it decide where they show:

```ts
private readonly errors = inject(ErrorService);

this.stream.subscribe({
  error: (err) => {
    const appError = this.errors.handle(err, {
      surface: 'none',                       // caller shows its own inline banner
      correlationId: turnId,                 // ties logs to this turn
      context: { feature: 'home', op: 'streamAgentTurn' },
    });
    if (appError.isSilent) return;           // user cancelled — do nothing
    this.store.markError(appError.userMessage);
    if (appError.retryable) {
      this.notifications.error(appError.userMessage, {
        action: { label: 'Retry', handler: () => this.retryLast() },
      });
    }
  },
});
```

### Choosing a surface (`HandleOptions.surface`)

| Surface          | When                                                                                                 |
| ---------------- | ---------------------------------------------------------------------------------------------------- |
| `auto` (default) | Let policy route by severity: app-breaking (`chunk_load`, `fatal`) → shell; everything else → toast. |
| `toast`          | Transient, recoverable failure worth a passing notification.                                         |
| `shell`          | App-breaking; shows the persistent app-shell boundary with a reload prompt.                          |
| `none`           | You render your own inline banner / degraded state. Still logs.                                      |

`handle()` marks the returned error **handled** so the `GlobalErrorHandler` won't double-surface it. Use `errors.normalize()` when you only want the typed error without logging or UI.

## Retries

Use `retryWithBackoff` **only for setup** (before any streamed output is committed) — e.g. establishing a stream or `testConnection`. Never retry mid-stream (it double-spends tokens and can duplicate output). It retries only `retryable` errors and is abort-aware:

```ts
await retryWithBackoff((attempt) => createStream(signal), {
  signal,
  maxAttempts: 3,
  onRetry: (err, attempt, delayMs) =>
    logger.warn('Retrying stream setup', { context: { attempt, delayMs }, error: err }),
});
```

## Offline gating

Fail fast instead of firing a doomed request:

```ts
if (this.connectivity.offline()) {
  this.notifications.warn("You're offline. Reconnect and try again.", {
    dedupeKey: 'offline-send',
  });
  return;
}
```

## Forward-looking seams (wired but inert)

- **HTTP** — `core/http/error.interceptor.ts` is registered in `app.config.ts` via `provideHttpClient(withInterceptors([errorInterceptor]))`. No `HttpClient` consumer ships today (Gemini uses the `@google/genai` SDK), but the first HTTP feature inherits normalize+log+rethrow for free. `normalizeError` already maps `HttpErrorResponse` by status.
- **Route guards** — `core/guards/api-key.guard.ts` is an example `CanActivateFn` (not wired into routes; onboarding is gated in-component). **Guards/resolvers must never throw** — catch, normalize, log, and return a `UrlTree` redirect (or trigger the shell state).

## Redaction & logging

Redaction happens **once**, inside `LoggerService`, before entries reach any sink (`ConsoleLogSink`, `RingBufferLogSink`). Never pre-format secrets into a message. The API key, passphrases, and base64 media are scrubbed by `core/logging/redact.ts`. There is no remote sink — adding one later is a single `LOG_SINKS` provider.

## Testing conventions

- `normalizeError` / `redact` are pure — test them directly (see `normalize-error.spec.ts`, `redact.spec.ts`).
- Use `NoopLogSink` (or rely on the default console sink) in TestBed; assert on the returned `AppError`, not console output.
- Cover the **abort path** (stays silent) and **redaction** (secrets never appear) for anything new on the error path.
