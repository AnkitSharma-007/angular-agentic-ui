import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BookingConfirmationCardComponent } from './booking-confirmation-card';
import { InterruptService } from '../../../core/registry/interrupt.service';
import type {
  BookFlightArgs,
  BookFlightResult,
} from './booking-confirmation-card.types';

const FIXTURE_ARGS: BookFlightArgs = {
  flightId: 'indigo-1',
  airline: 'IndiGo',
  from: 'BLR',
  to: 'GOA',
  date: '2026-06-15',
  passengerName: 'Anita Sharma',
  price: 4500,
  currency: 'INR',
};

const FIXTURE_RESULT: BookFlightResult = {
  status: 'confirmed',
  bookingRef: 'CONF-42',
  bookedAt: '2026-06-14T00:00:00.000Z',
  flightId: 'indigo-1',
  passengerName: 'Anita Sharma',
  totalCharged: 4500,
  currency: 'INR',
};

describe('BookingConfirmationCardComponent', () => {
  let interrupts: InterruptService;

  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [provideZonelessChangeDetection(), provideAnimationsAsync()],
    });
    interrupts = TestBed.inject(InterruptService);
  });

  it('renders the pending state with action buttons', async () => {
    const fixture = TestBed.createComponent(BookingConfirmationCardComponent);
    fixture.componentRef.setInput('callId', 'c1');
    fixture.componentRef.setInput('args', FIXTURE_ARGS);
    fixture.componentRef.setInput('status', 'pending_approval');
    await fixture.whenStable();

    const text = fixture.nativeElement.textContent ?? '';
    expect(text).toContain('Anita Sharma');
    expect(text).toContain('Approve & book');
    expect(text).toContain('awaiting approval');
  });

  it('approve() calls InterruptService.decide with kind: approve', async () => {
    const decide = vi.spyOn(interrupts, 'decide');
    void interrupts.pendingDecision('c1', new AbortController().signal);

    const fixture = TestBed.createComponent(BookingConfirmationCardComponent);
    fixture.componentRef.setInput('callId', 'c1');
    fixture.componentRef.setInput('args', FIXTURE_ARGS);
    fixture.componentRef.setInput('status', 'pending_approval');
    await fixture.whenStable();

    (fixture.componentInstance as unknown as { approve: () => void }).approve();
    expect(decide).toHaveBeenCalledWith('c1', { kind: 'approve' });
  });

  it('confirmReject() forwards the note when provided', async () => {
    const decide = vi.spyOn(interrupts, 'decide');
    void interrupts.pendingDecision('c1', new AbortController().signal);

    const fixture = TestBed.createComponent(BookingConfirmationCardComponent);
    fixture.componentRef.setInput('callId', 'c1');
    fixture.componentRef.setInput('args', FIXTURE_ARGS);
    fixture.componentRef.setInput('status', 'pending_approval');
    await fixture.whenStable();

    const inst = fixture.componentInstance as unknown as {
      rejectionNote: { set: (v: string) => void };
      confirmReject: () => void;
    };
    inst.rejectionNote.set('  too expensive  ');
    inst.confirmReject();
    expect(decide).toHaveBeenCalledWith('c1', {
      kind: 'reject',
      note: 'too expensive',
    });
  });

  it('renders the complete state with the booking reference', async () => {
    const fixture = TestBed.createComponent(BookingConfirmationCardComponent);
    fixture.componentRef.setInput('callId', 'c1');
    fixture.componentRef.setInput('args', FIXTURE_ARGS);
    fixture.componentRef.setInput('status', 'complete');
    fixture.componentRef.setInput('result', FIXTURE_RESULT);
    await fixture.whenStable();

    expect(fixture.nativeElement.textContent).toContain('CONF-42');
    expect(fixture.nativeElement.textContent).toContain('confirmed');
  });

  it('renders the rejected state', async () => {
    const fixture = TestBed.createComponent(BookingConfirmationCardComponent);
    fixture.componentRef.setInput('callId', 'c1');
    fixture.componentRef.setInput('args', FIXTURE_ARGS);
    fixture.componentRef.setInput('status', 'rejected');
    fixture.componentRef.setInput('interruptReason', 'too expensive');
    await fixture.whenStable();
    expect(fixture.nativeElement.textContent).toContain('Cancelled by you');
    expect(fixture.nativeElement.textContent).toContain('too expensive');
    expect(fixture.nativeElement.textContent).toContain('and the note');
  });

  it('renders the rejected state without a note clause when no reason supplied', async () => {
    const fixture = TestBed.createComponent(BookingConfirmationCardComponent);
    fixture.componentRef.setInput('callId', 'c1');
    fixture.componentRef.setInput('args', FIXTURE_ARGS);
    fixture.componentRef.setInput('status', 'rejected');
    fixture.componentRef.setInput('interruptReason', null);
    await fixture.whenStable();
    const text = fixture.nativeElement.textContent ?? '';
    expect(text).toContain('Cancelled by you');
    expect(text).not.toContain('and the note');
    expect(text).not.toContain('Cancelled by user.');
  });
});
