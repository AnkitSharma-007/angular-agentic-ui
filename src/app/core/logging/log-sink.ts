import { InjectionToken, Service, isDevMode } from '@angular/core';

// A single, already-redacted log record. Sinks receive these verbatim — all
// scrubbing happens upstream in `LoggerService`, so a sink can serialize an
// entry safely without re-checking for secrets.
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  readonly ts: number;
  readonly level: LogLevel;
  readonly message: string;
  readonly category?: string;
  readonly correlationId?: string;
  readonly context?: Readonly<Record<string, unknown>>;
  readonly error?: { readonly name?: string; readonly message?: string; readonly stack?: string };
}

// A destination for log entries. Implementations must never throw and never
// perform their own redaction (entries arrive pre-redacted).
export interface LogSink {
  write(entry: LogEntry): void;
}

// Multi-provider token. `LoggerService` fans each entry out to every registered
// sink. Wired in `app.config.ts` (Phase 1); absent this, the logger falls back
// to a lone console sink so it is usable in isolation and in tests.
export const LOG_SINKS = new InjectionToken<readonly LogSink[]>('atlas.log-sinks');

const LEVEL_RANK: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

// Discards everything. Useful as a test double or to silence logging entirely.
export class NoopLogSink implements LogSink {
  write(_entry: LogEntry): void {
    // intentionally empty
  }
}

// Writes to the browser console. Verbose in dev; in production only warn/error
// are emitted (and terse), so a normal session stays quiet.
export class ConsoleLogSink implements LogSink {
  private readonly minLevel: LogLevel = isDevMode() ? 'debug' : 'warn';

  write(entry: LogEntry): void {
    if (LEVEL_RANK[entry.level] < LEVEL_RANK[this.minLevel]) return;
    const tag = `[atlas${entry.correlationId ? `:${entry.correlationId}` : ''}${
      entry.category ? `/${entry.category}` : ''
    }]`;
    const detail = isDevMode() ? buildDetail(entry) : undefined;
    const args: unknown[] = detail === undefined ? [tag, entry.message] : [tag, entry.message, detail];
    switch (entry.level) {
      case 'debug':
        console.debug(...args);
        break;
      case 'info':
        console.info(...args);
        break;
      case 'warn':
        console.warn(...args);
        break;
      case 'error':
        console.error(...args);
        break;
    }
  }
}

function buildDetail(entry: LogEntry): Record<string, unknown> | undefined {
  const detail: Record<string, unknown> = {};
  if (entry.context) detail['context'] = entry.context;
  if (entry.error) detail['error'] = entry.error;
  return Object.keys(detail).length > 0 ? detail : undefined;
}

export const RING_BUFFER_CAPACITY = 200;

// Keeps the most recent N entries in memory so a "Copy diagnostics" affordance
// (Phase: observability drawer) can export a redacted trail without any remote
// transport. A root singleton so the buffer is shared app-wide; also registered
// into `LOG_SINKS` via `useExisting`.
@Service()
export class RingBufferLogSink implements LogSink {
  private buffer: LogEntry[] = [];

  write(entry: LogEntry): void {
    this.buffer.push(entry);
    if (this.buffer.length > RING_BUFFER_CAPACITY) {
      this.buffer.splice(0, this.buffer.length - RING_BUFFER_CAPACITY);
    }
  }

  snapshot(): readonly LogEntry[] {
    return this.buffer.slice();
  }

  clear(): void {
    this.buffer = [];
  }
}
