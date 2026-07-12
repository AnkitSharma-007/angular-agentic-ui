import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorDialogComponent, type ErrorDialogData } from './error-dialog';

function setup(data: ErrorDialogData) {
  const close = vi.fn();
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      provideZonelessChangeDetection(),
      provideAnimationsAsync(),
      { provide: DIALOG_DATA, useValue: data },
      { provide: DialogRef, useValue: { close } },
    ],
  });
  return { close };
}

describe('ErrorDialogComponent', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('renders the message, title, and technical details', async () => {
    setup({ title: 'Boom', message: 'It broke.', details: 'stack line 1' });
    const fixture = TestBed.createComponent(ErrorDialogComponent);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;

    expect(el.textContent).toContain('Boom');
    expect(el.textContent).toContain('It broke.');
    expect(el.querySelector('.dialog-details')).not.toBeNull();
    expect(el.textContent).toContain('stack line 1');
  });

  it('confirms with true', async () => {
    const { close } = setup({ message: 'Proceed?', confirmLabel: 'Yes', cancelLabel: 'No' });
    const fixture = TestBed.createComponent(ErrorDialogComponent);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;

    const buttons = el.querySelectorAll<HTMLButtonElement>('.dialog-actions button');
    expect(buttons).toHaveLength(2);
    buttons[1].click(); // confirm is the last (primary) button
    expect(close).toHaveBeenCalledWith(true);
  });

  it('omits the cancel button when no cancelLabel is given', async () => {
    setup({ message: 'Just so you know.' });
    const fixture = TestBed.createComponent(ErrorDialogComponent);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelectorAll('.dialog-actions button')).toHaveLength(1);
  });
});
