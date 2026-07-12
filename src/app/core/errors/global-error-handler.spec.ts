import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GlobalErrorHandler } from './global-error-handler';
import { AppShellErrorService } from './app-shell-error.service';
import { AppError } from './app-error';
import { NotificationService } from '../../shared/notifications/notification.service';
import { LOG_SINKS, type LogEntry, type LogSink } from '../logging/log-sink';

class CapturingSink implements LogSink {
  readonly entries: LogEntry[] = [];
  write(entry: LogEntry): void {
    this.entries.push(entry);
  }
}

describe('GlobalErrorHandler', () => {
  let handler: GlobalErrorHandler;
  let shell: AppShellErrorService;
  let notifications: NotificationService;
  let sink: CapturingSink;

  beforeEach(() => {
    sink = new CapturingSink();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        { provide: LOG_SINKS, useValue: [sink] },
        GlobalErrorHandler,
      ],
    });
    handler = TestBed.inject(GlobalErrorHandler);
    shell = TestBed.inject(AppShellErrorService);
    notifications = TestBed.inject(NotificationService);
  });

  afterEach(() => notifications.clear());

  it('logs and surfaces a routine error as a toast (not the shell)', () => {
    handler.handleError(new Error('boom'));
    expect(sink.entries).toHaveLength(1);
    expect(notifications.items()).toHaveLength(1);
    expect(notifications.items()[0].kind).toBe('error');
    expect(shell.error()).toBeNull();
  });

  it('routes chunk-load failures to the shell boundary', () => {
    handler.handleError(new Error('Failed to fetch dynamically imported module: /x.js'));
    expect(shell.error()?.code).toBe('chunk_load');
    expect(shell.reloadSuggested()).toBe(true);
    expect(notifications.items()).toHaveLength(0);
  });

  it('does not surface silent (abort) errors', () => {
    handler.handleError(new DOMException('Aborted', 'AbortError'));
    expect(notifications.items()).toHaveLength(0);
    expect(shell.error()).toBeNull();
  });

  it('does not re-surface errors already handled by a closer layer', () => {
    handler.handleError(new AppError({ category: 'api', handled: true }));
    expect(notifications.items()).toHaveLength(0);
    expect(shell.error()).toBeNull();
  });

  it('unwraps promise-wrapped rejections before classifying', () => {
    handler.handleError({ rejection: new Error('401 Unauthorized') });
    expect(notifications.items()).toHaveLength(1);
    expect(sink.entries[0].category).toBe('auth');
  });
});
