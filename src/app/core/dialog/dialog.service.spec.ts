import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { Dialog } from '@angular/cdk/dialog';
import { Subject } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DialogService } from './dialog.service';
import { ErrorDialogComponent } from '../../shared/error-dialog/error-dialog';

describe('DialogService', () => {
  let service: DialogService;
  let openSpy: ReturnType<typeof vi.fn>;
  let lastClosed: Subject<boolean | undefined>;

  beforeEach(() => {
    openSpy = vi.fn(() => {
      lastClosed = new Subject<boolean | undefined>();
      return { closed: lastClosed, close: vi.fn() };
    });

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        { provide: Dialog, useValue: { open: openSpy } },
      ],
    });
    service = TestBed.inject(DialogService);
  });

  it('opens the error dialog with app defaults and the error tone', () => {
    service.error({ message: 'boom', details: 'detail' });
    expect(openSpy).toHaveBeenCalledTimes(1);
    const [component, config] = openSpy.mock.calls[0];
    expect(component).toBe(ErrorDialogComponent);
    expect(config.hasBackdrop).toBe(true);
    expect(config.data).toMatchObject({ message: 'boom', tone: 'error' });
  });

  it('confirm() resolves true only when the dialog closes with true', async () => {
    const confirmed = service.confirm({ message: 'Sure?' });
    lastClosed.next(true);
    await expect(confirmed).resolves.toBe(true);

    const cancelled = service.confirm({ message: 'Sure?' });
    lastClosed.next(undefined); // backdrop/escape dismissal
    await expect(cancelled).resolves.toBe(false);
  });

  it('confirm() passes the question tone and default labels', () => {
    void service.confirm({ message: 'Delete it?' });
    const [, config] = openSpy.mock.calls[0];
    expect(config.data).toMatchObject({
      tone: 'question',
      confirmLabel: 'Confirm',
      cancelLabel: 'Cancel',
      message: 'Delete it?',
    });
  });
});
