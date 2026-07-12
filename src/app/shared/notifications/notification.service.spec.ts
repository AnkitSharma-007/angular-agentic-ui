import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NotificationService } from './notification.service';

describe('NotificationService', () => {
  let service: NotificationService;

  beforeEach(() => {
    vi.useFakeTimers();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection()] });
    service = TestBed.inject(NotificationService);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('adds notifications of each kind via the convenience methods', () => {
    service.info('i');
    service.success('s');
    service.warn('w');
    service.error('e');
    expect(service.items().map((n) => n.kind)).toEqual(['info', 'success', 'warn', 'error']);
  });

  it('auto-dismisses after the kind duration', () => {
    service.info('bye', { durationMs: 3000 });
    expect(service.items()).toHaveLength(1);
    vi.advanceTimersByTime(2999);
    expect(service.items()).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(service.items()).toHaveLength(0);
  });

  it('keeps sticky (durationMs 0) notifications until dismissed', () => {
    const id = service.error('stay', { durationMs: 0 });
    vi.advanceTimersByTime(60_000);
    expect(service.items()).toHaveLength(1);
    service.dismiss(id);
    expect(service.items()).toHaveLength(0);
  });

  it('collapses duplicates by dedupeKey into a single toast', () => {
    service.error('same', { dedupeKey: 'k', durationMs: 0 });
    service.error('same', { dedupeKey: 'k', durationMs: 0 });
    service.error('same', { dedupeKey: 'k', durationMs: 0 });
    expect(service.items()).toHaveLength(1);
  });

  it('caps the number of visible toasts, dropping the oldest', () => {
    for (let i = 0; i < 7; i++) service.info(`m${i}`, { durationMs: 0 });
    const items = service.items();
    expect(items).toHaveLength(4);
    expect(items[0].message).toBe('m3');
    expect(items.at(-1)?.message).toBe('m6');
  });

  it('carries an action', () => {
    const handler = vi.fn();
    service.error('with action', { action: { label: 'Retry', handler }, durationMs: 0 });
    service.items()[0].action?.handler();
    expect(handler).toHaveBeenCalledOnce();
  });

  it('clear() removes everything and cancels timers', () => {
    service.info('a');
    service.warn('b');
    service.clear();
    expect(service.items()).toHaveLength(0);
    vi.advanceTimersByTime(60_000);
    expect(service.items()).toHaveLength(0);
  });
});
