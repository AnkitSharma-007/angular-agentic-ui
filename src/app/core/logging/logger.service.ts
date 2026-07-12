import { Service, inject } from '@angular/core';
import {
  ConsoleLogSink,
  LOG_SINKS,
  type LogEntry,
  type LogLevel,
  type LogSink,
} from './log-sink';
import { redactContext, redactError, redactString } from './redact';

export interface LogMeta {
  readonly category?: string;
  readonly correlationId?: string;
  readonly context?: Record<string, unknown>;
  // The originating thrown value; captured (redacted) for the entry.
  readonly error?: unknown;
}

// The single logging entry point for the app. Every record is redacted here —
// once — then fanned out to all registered sinks. Logging is best-effort: a
// failing sink (or a value that resists serialization) can never crash a caller.
@Service()
export class LoggerService {
  private readonly sinks: readonly LogSink[] =
    inject(LOG_SINKS, { optional: true }) ?? [new ConsoleLogSink()];

  debug(message: string, meta?: LogMeta): void {
    this.write('debug', message, meta);
  }

  info(message: string, meta?: LogMeta): void {
    this.write('info', message, meta);
  }

  warn(message: string, meta?: LogMeta): void {
    this.write('warn', message, meta);
  }

  error(message: string, meta?: LogMeta): void {
    this.write('error', message, meta);
  }

  private write(level: LogLevel, message: string, meta?: LogMeta): void {
    const entry = this.buildEntry(level, message, meta);
    for (const sink of this.sinks) {
      try {
        sink.write(entry);
      } catch {
        // Logging must never throw back into application code.
      }
    }
  }

  private buildEntry(level: LogLevel, message: string, meta?: LogMeta): LogEntry {
    try {
      return {
        ts: Date.now(),
        level,
        message: redactString(message),
        category: meta?.category,
        correlationId: meta?.correlationId,
        context:
          meta?.context !== undefined
            ? (redactContext(meta.context) as Record<string, unknown>)
            : undefined,
        error: meta?.error !== undefined ? redactError(meta.error) : undefined,
      };
    } catch {
      return { ts: Date.now(), level, message: '[log-build-failed]' };
    }
  }
}
