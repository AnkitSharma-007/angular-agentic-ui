import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NotificationHostComponent } from './notification-host';
import { NotificationService } from './notification.service';

describe('NotificationHostComponent', () => {
  let notifications: NotificationService;

  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [provideZonelessChangeDetection(), provideAnimationsAsync()],
    });
    notifications = TestBed.inject(NotificationService);
  });

  it('renders active toasts with an aria-live region', async () => {
    notifications.error('Network error reaching Gemini.', { durationMs: 0 });
    const fixture = TestBed.createComponent(NotificationHostComponent);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;

    expect(el.querySelector('[aria-live]')).not.toBeNull();
    expect(el.textContent).toContain('Network error reaching Gemini.');
    // error toasts announce assertively
    expect(el.querySelector('.toast--error')?.getAttribute('role')).toBe('alert');
  });

  it('runs a toast action then dismisses it', async () => {
    const handler = vi.fn();
    notifications.error('Failed', { action: { label: 'Retry', handler }, durationMs: 0 });
    const fixture = TestBed.createComponent(NotificationHostComponent);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;

    const actionBtn = el.querySelector<HTMLButtonElement>('.toast-action');
    expect(actionBtn).not.toBeNull();
    actionBtn!.click();
    await fixture.whenStable();

    expect(handler).toHaveBeenCalledOnce();
    expect(notifications.items()).toHaveLength(0);
  });
});
