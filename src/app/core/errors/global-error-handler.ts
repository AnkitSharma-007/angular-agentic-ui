import { ErrorHandler, Injectable, inject } from '@angular/core';
import { ErrorService } from './error.service';

// The application's global backstop. Angular routes every otherwise-uncaught
// error here (including window `error` / `unhandledrejection` events via
// `provideBrowserGlobalErrorListeners`). We hand each one to ErrorService, which
// normalizes, logs, and routes presentation (transient toast, or the persistent
// shell boundary for app-breaking failures). Cancellations and errors already
// surfaced by a closer layer are skipped inside ErrorService.
@Injectable()
export class GlobalErrorHandler implements ErrorHandler {
  private readonly errors = inject(ErrorService);

  handleError(error: unknown): void {
    this.errors.handle(unwrap(error), { context: { source: 'global' } });
  }
}

// Angular and the browser wrap the original throwable in a few well-known ways
// (zone rejections, re-thrown promise reasons). Peel those back so the
// normalizer classifies the real error.
function unwrap(error: unknown): unknown {
  if (error && typeof error === 'object') {
    const wrapped = error as { rejection?: unknown; ngOriginalError?: unknown };
    if (wrapped.rejection !== undefined) return wrapped.rejection;
    if (wrapped.ngOriginalError !== undefined) return wrapped.ngOriginalError;
  }
  return error;
}
