import { inject } from '@angular/core';
import type { HttpInterceptorFn } from '@angular/common/http';
import { catchError, throwError } from 'rxjs';
import { ErrorService } from '../errors/error.service';

// Forward-looking seam. No `HttpClient` consumer ships today — all Gemini
// traffic goes through the `@google/genai` SDK — but this interceptor is wired
// (inert) in `app.config.ts` so the first HTTP feature (e.g. grounding/RAG)
// inherits consistent handling for free.
//
// Policy: normalize every failure into an `AppError` and log it once (redacted,
// with request context) via `ErrorService`, then re-throw the typed error so
// the calling stream/consumer can still react. Surfacing is deliberately left to
// the caller (`surface: 'none'`) — a component may show a contextual banner, or
// let the global handler present it — mirroring how the agent stream is handled.
export const errorInterceptor: HttpInterceptorFn = (req, next) => {
  const errors = inject(ErrorService);
  return next(req).pipe(
    catchError((err: unknown) => {
      const appError = errors.handle(err, {
        surface: 'none',
        context: { source: 'http', method: req.method, url: req.url },
      });
      return throwError(() => appError);
    }),
  );
};
