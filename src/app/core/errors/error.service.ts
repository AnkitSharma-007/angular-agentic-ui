import { Service, inject } from '@angular/core';
import { LoggerService, type LogMeta } from '../logging/logger.service';
import type { LogLevel } from '../logging/log-sink';
import {
  NotificationService,
  type NotificationKind,
} from '../../shared/notifications/notification.service';
import { AppShellErrorService } from './app-shell-error.service';
import { AppError, type ErrorSeverity } from './app-error';
import { normalizeError } from './normalize-error';

// Where a handled error is shown to the user.
// - 'auto'  : route by severity/recoverability (default)
// - 'toast' : transient notification
// - 'shell' : persistent app-shell boundary (reserved for app-breaking errors)
// - 'none'  : log only (caller surfaces it themselves, e.g. an inline banner)
export type ErrorSurface = 'auto' | 'toast' | 'shell' | 'none';

export interface HandleOptions {
  readonly context?: Record<string, unknown>;
  readonly surface?: ErrorSurface;
  readonly correlationId?: string;
  // When provided (and the error surfaces as a toast), adds a "Retry" action.
  readonly retry?: () => void;
}

// The central policy for handling an error at a boundary: normalize → log →
// present. Callers pick the surface (or let it auto-route). Use `normalize()`
// when you only need the typed error without logging or UI.
@Service()
export class ErrorService {
  private readonly logger = inject(LoggerService);
  private readonly notifications = inject(NotificationService);
  private readonly shell = inject(AppShellErrorService);

  handle(error: unknown, options?: HandleOptions): AppError {
    const appError = normalizeError(error, options?.context);
    if (options?.correlationId) appError.enrich({ correlationId: options.correlationId });
    this.log(appError);
    this.present(appError, options);
    return appError;
  }

  // Classify without logging or presenting.
  normalize(error: unknown, context?: Record<string, unknown>): AppError {
    return normalizeError(error, context);
  }

  private present(appError: AppError, options?: HandleOptions): void {
    const surface = options?.surface ?? 'auto';
    if (surface === 'none' || appError.isSilent || appError.handled) return;

    const target = surface === 'auto' ? routeSurface(appError) : surface;
    if (target === 'shell') {
      this.shell.show(appError);
    } else {
      this.notifications.notify(appError.userMessage, {
        kind: severityToKind(appError.severity),
        action: options?.retry ? { label: 'Retry', handler: options.retry } : undefined,
        dedupeKey: `${appError.category}:${appError.code ?? ''}:${appError.userMessage}`,
      });
    }
    appError.markHandled();
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

// App-breaking errors go to the persistent shell boundary (with a reload
// prompt); everything else is a transient toast.
function routeSurface(appError: AppError): 'toast' | 'shell' {
  if (appError.code === 'chunk_load' || appError.severity === 'fatal') return 'shell';
  return 'toast';
}

function severityToKind(severity: ErrorSeverity): NotificationKind {
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
