import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { LoggerService } from './logger.service';
import { LOG_SINKS, type LogEntry, type LogSink } from './log-sink';

class CapturingSink implements LogSink {
  readonly entries: LogEntry[] = [];
  write(entry: LogEntry): void {
    this.entries.push(entry);
  }
}

class ThrowingSink implements LogSink {
  write(): void {
    throw new Error('sink is broken');
  }
}

describe('LoggerService', () => {
  let logger: LoggerService;
  let capturing: CapturingSink;

  beforeEach(() => {
    capturing = new CapturingSink();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        { provide: LOG_SINKS, useValue: [capturing] },
      ],
    });
    logger = TestBed.inject(LoggerService);
  });

  it('fans each level out to the registered sinks with a timestamp', () => {
    logger.debug('d');
    logger.info('i');
    logger.warn('w');
    logger.error('e');

    expect(capturing.entries.map((x) => x.level)).toEqual(['debug', 'info', 'warn', 'error']);
    expect(capturing.entries.every((x) => typeof x.ts === 'number')).toBe(true);
  });

  it('redacts the message, context, and error before writing', () => {
    logger.error('failed with key AIzaSyA1234567890abcdefghijklmnop', {
      category: 'api',
      correlationId: 'turn-9',
      context: { passphrase: 'hunter2', model: 'gemini' },
      error: new Error('inner AIzaSyA1234567890abcdefghijklmnop'),
    });

    const [e] = capturing.entries;
    expect(e.message).not.toContain('AIzaSy');
    expect(e.category).toBe('api');
    expect(e.correlationId).toBe('turn-9');
    expect((e.context as Record<string, unknown>)['passphrase']).toBe('[redacted]');
    expect((e.context as Record<string, unknown>)['model']).toBe('gemini');
    expect(e.error?.message).not.toContain('AIzaSy');
  });

  it('never throws even when a sink throws', () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        { provide: LOG_SINKS, useValue: [new ThrowingSink(), capturing] },
      ],
    });
    const resilient = TestBed.inject(LoggerService);

    expect(() => resilient.error('boom')).not.toThrow();
    // A later well-behaved sink still receives the entry.
    expect(capturing.entries).toHaveLength(1);
  });
});
