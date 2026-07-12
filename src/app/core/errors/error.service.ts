import { Service, inject } from '@angular/core';
import { LoggerService, type LogMeta } from '../logging/logger.service';
import type { LogLevel } from '../logging/log-sink';
import { AppError, type ErrorSeverity } from './app-error';
import { normalizeError } from './normalize-error';

// The central policy for handling an error once it reaches a boundary. Phase 0
// normalizes and logs; later phases extend `handle` to route presentation
// (toast vs. dialog vs. inline) and to consult connectivity. Callers should
// prefer this over ad-hoc `console.error` / `humanizeGeminiError`.
@Service()
export class ErrorService {
  private readonly logger = inject(LoggerService);

  // Normalize, log, and return the structured error. Aborts are logged at debug
  // and never treated as failures.
  handle(error: unknown, context?: Record<string, unknown>): AppError {
    const appError = normalizeError(error, context);
    this.log(appError);
    return appError;
  }

  // Classify without logging or presenting — for callers that only need the
  // typed error (e.g. to read `userMessage` for an inline banner).
  normalize(error: unknown, context?: Record<string, unknown>): AppError {
    return normalizeError(error, context);
  }

  private log(appError: AppError): void {
    const meta: LogMeta = {
      category: appError.category,
      correlationId: appError.correlationId,
      context: appError.context ? { ...appError.context } : undefined,
      error: appError.cause ?? appError,
    };
    const detail = appError.technicalMessage || appError.userMessage;

    if (appError.isSilent) {
      this.logger.debug(detail, meta);
      return;
    }
    this.logger[severityToLevel(appError.severity)](detail, meta);
  }
}

function severityToLevel(severity: ErrorSeverity): LogLevel {
  switch (severity) {
    case 'info':
      return 'info';
    case 'warn':
      return 'warn';
    case 'error':
    case 'fatal':
      return 'error';
  }
}
