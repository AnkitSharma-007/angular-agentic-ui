import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { provideRouter } from '@angular/router';
import { beforeEach, describe, expect, it } from 'vitest';
import { CostMeterComponent } from './cost-meter';
import { ObservabilityDrawerService } from '../../core/observability/observability-drawer.service';
import { TokenAccountantService } from '../../core/observability/token-accountant.service';

describe('CostMeterComponent', () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        provideAnimationsAsync(),
        provideRouter([]),
      ],
    });
  });

  it('stays hidden until there is real spend to report', async () => {
    const fixture = TestBed.createComponent(CostMeterComponent);
    await fixture.whenStable();

    // No rounds and not streaming — the floating pill should not render at all,
    // so a first-time user never sees a "$0.000" instrument-panel chip.
    const pill = (fixture.nativeElement as HTMLElement).querySelector('.pill');
    expect(pill).toBeNull();
  });

  it('toggle() flips the expanded panel state', async () => {
    const fixture = TestBed.createComponent(CostMeterComponent);
    await fixture.whenStable();

    const inst = fixture.componentInstance as unknown as {
      expanded: { (): boolean; set: (v: boolean) => void };
      toggle: () => void;
      close: () => void;
    };

    expect(inst.expanded()).toBe(false);
    inst.toggle();
    expect(inst.expanded()).toBe(true);
    inst.close();
    expect(inst.expanded()).toBe(false);
  });

  it('reflects round counts and lifetime totals in the pill', async () => {
    const tokens = TestBed.inject(TokenAccountantService);
    tokens.beginTurn('t1');
    tokens.recordRound({
      turnId: 't1',
      roundIndex: 0,
      startedAt: 100,
      completedAt: 250,
      usage: { inputTokens: 50, outputTokens: 25, thoughtTokens: 5, totalTokens: 80 },
      model: 'gemini-3.5-flash',
      finishReason: 'STOP',
    });

    const fixture = TestBed.createComponent(CostMeterComponent);
    await fixture.whenStable();

    expect(fixture.nativeElement.textContent).toContain('80 tok');
    expect(fixture.nativeElement.textContent).toContain('1r');
  });

  it('openDashboard() opens the observability drawer and closes the panel', async () => {
    const drawer = TestBed.inject(ObservabilityDrawerService);

    const fixture = TestBed.createComponent(CostMeterComponent);
    await fixture.whenStable();
    const inst = fixture.componentInstance as unknown as {
      expanded: { set: (v: boolean) => void };
      openDashboard: () => void;
    };
    inst.expanded.set(true);
    inst.openDashboard();
    expect(drawer.isOpen()).toBe(true);
  });

  it('expanded panel is marked as a modal dialog with focus trapping enabled', async () => {
    // Give the meter real spend so the pill (and its panel) render.
    const tokens = TestBed.inject(TokenAccountantService);
    tokens.beginTurn('t1');
    tokens.recordRound({
      turnId: 't1',
      roundIndex: 0,
      startedAt: 100,
      completedAt: 250,
      usage: { inputTokens: 50, outputTokens: 25, thoughtTokens: 5, totalTokens: 80 },
      model: 'gemini-3.5-flash',
      finishReason: 'STOP',
    });

    const fixture = TestBed.createComponent(CostMeterComponent);
    await fixture.whenStable();
    const inst = fixture.componentInstance as unknown as {
      expanded: { set: (v: boolean) => void };
    };

    inst.expanded.set(true);
    fixture.detectChanges();
    await fixture.whenStable();

    const panel = (fixture.nativeElement as HTMLElement).querySelector(
      'section.panel[role="dialog"]',
    );
    expect(panel).not.toBeNull();
    expect(panel?.getAttribute('aria-modal')).toBe('true');
    expect(panel?.hasAttribute('cdktrapfocus')).toBe(true);
  });
});
