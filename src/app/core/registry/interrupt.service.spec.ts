import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { InterruptService } from './interrupt.service';

describe('InterruptService', () => {
  let interrupts: InterruptService;

  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({});
    interrupts = TestBed.inject(InterruptService);
  });

  it('starts with no pending decisions', () => {
    expect(interrupts.pendingIds()).toEqual([]);
    expect(interrupts.pendingCount()).toBe(0);
    expect(interrupts.hasPending()).toBe(false);
  });

  it('pendingDecision() resolves when decide() is called for the matching callId', async () => {
    const controller = new AbortController();
    const promise = interrupts.pendingDecision('c1', controller.signal);

    expect(interrupts.isPending('c1')).toBe(true);
    expect(interrupts.pendingIds()).toEqual(['c1']);

    interrupts.decide('c1', { kind: 'approve' });
    await expect(promise).resolves.toEqual({ kind: 'approve' });
    expect(interrupts.isPending('c1')).toBe(false);
  });

  it('decide() carries over the chosen kind and any payload', async () => {
    const controller = new AbortController();
    const promise = interrupts.pendingDecision('c2', controller.signal);
    interrupts.decide('c2', { kind: 'select', selection: { id: 'opt-1' } });
    await expect(promise).resolves.toEqual({ kind: 'select', selection: { id: 'opt-1' } });
  });

  it('decide() for an unknown callId does not throw or register a pending id', () => {
    expect(() => interrupts.decide('nope', { kind: 'approve' })).not.toThrow();
    expect(interrupts.pendingIds()).toEqual([]);
  });

  it('buffers a decision that arrives before pendingDecision registers (M5)', async () => {
    // The UI can render the approval card and a fast/auto approver can dispatch
    // a decision before settlement calls pendingDecision — the decision must be
    // honoured on registration, not dropped.
    interrupts.decide('early', { kind: 'select', selection: { id: 'opt-1' } });
    expect(interrupts.pendingIds()).toEqual([]);

    const promise = interrupts.pendingDecision('early', new AbortController().signal);
    await expect(promise).resolves.toEqual({ kind: 'select', selection: { id: 'opt-1' } });
    // The buffered decision is consumed once — a second registration waits.
    expect(interrupts.isPending('early')).toBe(false);
  });

  it('a fresh pendingDecision() for the same callId supersedes the previous one', async () => {
    const controller = new AbortController();
    const first = interrupts.pendingDecision('c3', controller.signal);
    const second = interrupts.pendingDecision('c3', controller.signal);

    await expect(first).rejects.toThrow(/Superseded/);

    interrupts.decide('c3', { kind: 'reject', note: 'no thanks' });
    await expect(second).resolves.toEqual({ kind: 'reject', note: 'no thanks' });
  });

  it('rejects immediately when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(interrupts.pendingDecision('c4', controller.signal)).rejects.toThrow(
      /Aborted before decision/,
    );
  });

  it('rejects pending decision when the signal aborts later', async () => {
    const controller = new AbortController();
    const promise = interrupts.pendingDecision('c5', controller.signal);
    controller.abort();
    await expect(promise).rejects.toThrow(/Aborted while awaiting decision/);
    expect(interrupts.isPending('c5')).toBe(false);
  });
});
