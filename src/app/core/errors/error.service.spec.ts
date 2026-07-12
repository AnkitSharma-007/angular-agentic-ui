import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { ErrorService } from './error.service';
import { AppError } from './app-error';
import { LOG_SINKS, type LogEntry, type LogSink } from '../logging/log-sink';

class CapturingSink implements LogSink {
  readonly entries: LogEntry[] = [];
  write(entry: LogEntry): void {
    this.entries.push(entry);
  }
}

describe('ErrorService', () => {
  let service: ErrorService;
  let sink: CapturingSink;

  beforeEach(() => {
    sink = new CapturingSink();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [provideZonelessChangeDetection(), { provide: LOG_SINKS, useValue: [sink] }],
    });
    service = TestBed.inject(ErrorService);
  });

  it('normalizes, logs, and returns the AppError', () => {
    const out = service.handle(new Error('401 Unauthorized'));
    expect(out).toBeInstanceOf(AppError);
    expect(out.category).toBe('auth');
    expect(sink.entries).toHaveLength(1);
    expect(sink.entries[0].category).toBe('auth');
  });

  it('maps severity to the log level (validation warns, network errors)', () => {
    service.handle(new Error('Failed to fetch'));
    service.handle(Object.assign(new Error('bad'), { name: 'ZodError', issues: [] }));

    expect(sink.entries[0].level).toBe('error'); // network
    expect(sink.entries[1].level).toBe('warn'); // validation
  });

  it('logs aborts quietly at debug and marks them silent', () => {
    const out = service.handle(new DOMException('Aborted', 'AbortError'));
    expect(out.isSilent).toBe(true);
    expect(sink.entries[0].level).toBe('debug');
  });

  it('normalize() classifies without logging', () => {
    const out = service.normalize(new Error('429 rate limit'));
    expect(out.category).toBe('api');
    expect(sink.entries).toHaveLength(0);
  });

  it('carries correlationId + context into the log entry', () => {
    service.handle(new AppError({ category: 'api', correlationId: 'turn-3', context: { round: 2 } }));
    expect(sink.entries[0].correlationId).toBe('turn-3');
    expect((sink.entries[0].context as Record<string, unknown>)['round']).toBe(2);
  });
});
