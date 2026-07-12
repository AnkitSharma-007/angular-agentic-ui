import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ComparisonTableComponent } from './comparison-table';
import { InterruptService } from '../../../core/registry/interrupt.service';
import type { LetUserChooseArgs } from './comparison-table.types';

const FIXTURE_ARGS: LetUserChooseArgs = {
  context: 'Pick a flight',
  instruction: 'Choose one of the following options.',
  options: [
    {
      id: 'opt-a',
      title: 'IndiGo 6E-101',
      subtitle: '06:00 → 07:35',
      details: [{ label: 'Price', value: '₹4,500' }],
    },
    {
      id: 'opt-b',
      title: 'Vistara UK-810',
      details: [{ label: 'Price', value: '₹5,200' }],
      highlight: 'Recommended',
    },
  ],
};

describe('ComparisonTableComponent', () => {
  let interrupts: InterruptService;

  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [provideZonelessChangeDetection(), provideAnimationsAsync()],
    });
    interrupts = TestBed.inject(InterruptService);
  });

  it('renders both option titles in the pending state', async () => {
    const fixture = TestBed.createComponent(ComparisonTableComponent);
    fixture.componentRef.setInput('callId', 'c1');
    fixture.componentRef.setInput('args', FIXTURE_ARGS);
    fixture.componentRef.setInput('status', 'pending_approval');
    await fixture.whenStable();

    const text = fixture.nativeElement.textContent ?? '';
    expect(text).toContain('IndiGo 6E-101');
    expect(text).toContain('Vistara UK-810');
    expect(text).toContain('Recommended');
    expect(text).toContain('Choose this');
  });

  it('choose() forwards the selection to InterruptService', async () => {
    const decide = vi.spyOn(interrupts, 'decide');
    const controller = new AbortController();
    // pre-register pending so decide is not a no-op
    void interrupts.pendingDecision('c1', controller.signal);

    const fixture = TestBed.createComponent(ComparisonTableComponent);
    fixture.componentRef.setInput('callId', 'c1');
    fixture.componentRef.setInput('args', FIXTURE_ARGS);
    fixture.componentRef.setInput('status', 'pending_approval');
    await fixture.whenStable();

    (fixture.componentInstance as unknown as {
      choose: (opt: unknown) => void;
    }).choose(FIXTURE_ARGS.options[1]);

    expect(decide).toHaveBeenCalledWith('c1', {
      kind: 'select',
      selection: FIXTURE_ARGS.options[1],
    });
  });

  it('renders a Cancel selection action while pending (H11)', async () => {
    const fixture = TestBed.createComponent(ComparisonTableComponent);
    fixture.componentRef.setInput('callId', 'c1');
    fixture.componentRef.setInput('args', FIXTURE_ARGS);
    fixture.componentRef.setInput('status', 'pending_approval');
    await fixture.whenStable();

    expect(fixture.nativeElement.textContent).toContain('Cancel selection');
  });

  it('cancel() rejects the interrupt so the agent can re-plan (H11)', async () => {
    const decide = vi.spyOn(interrupts, 'decide');
    const controller = new AbortController();
    void interrupts.pendingDecision('c1', controller.signal);

    const fixture = TestBed.createComponent(ComparisonTableComponent);
    fixture.componentRef.setInput('callId', 'c1');
    fixture.componentRef.setInput('args', FIXTURE_ARGS);
    fixture.componentRef.setInput('status', 'pending_approval');
    await fixture.whenStable();

    (fixture.componentInstance as unknown as { cancel: () => void }).cancel();

    expect(decide).toHaveBeenCalledWith('c1', { kind: 'reject' });
  });

  it('renders the error state with a fallback message', async () => {
    const fixture = TestBed.createComponent(ComparisonTableComponent);
    fixture.componentRef.setInput('callId', 'c1');
    fixture.componentRef.setInput('args', FIXTURE_ARGS);
    fixture.componentRef.setInput('status', 'error');
    await fixture.whenStable();
    expect(fixture.nativeElement.textContent).toContain('Selection failed');
  });

  it('highlights the chosen row from the `{ selected }` result envelope', async () => {
    const fixture = TestBed.createComponent(ComparisonTableComponent);
    fixture.componentRef.setInput('callId', 'c1');
    fixture.componentRef.setInput('args', FIXTURE_ARGS);
    fixture.componentRef.setInput('status', 'complete');
    fixture.componentRef.setInput('result', { selected: FIXTURE_ARGS.options[1] });
    await fixture.whenStable();

    const items = (fixture.nativeElement as HTMLElement).querySelectorAll('.option');
    expect(items).toHaveLength(2);
    expect(items[0].classList.contains('chosen')).toBe(false);
    expect(items[1].classList.contains('chosen')).toBe(true);
    expect(items[0].classList.contains('dimmed')).toBe(true);
  });
});
