import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { MeterComponent } from './meter';

describe('MeterComponent', () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection()] });
  });

  it('clamps the fill width to the 0..100% range', async () => {
    const fixture = TestBed.createComponent(MeterComponent);
    const fill = () =>
      (fixture.nativeElement as HTMLElement).querySelector('.meter-fill') as HTMLElement;

    fixture.componentRef.setInput('value', 1.5);
    await fixture.whenStable();
    expect(fill().style.width).toBe('100%');

    fixture.componentRef.setInput('value', -0.2);
    await fixture.whenStable();
    expect(fill().style.width).toBe('0%');

    fixture.componentRef.setInput('value', 0.5);
    await fixture.whenStable();
    expect(fill().style.width).toBe('50%');
  });

  it('applies warn/danger state classes to the fill', async () => {
    const fixture = TestBed.createComponent(MeterComponent);
    fixture.componentRef.setInput('value', 0.9);
    fixture.componentRef.setInput('warn', true);
    await fixture.whenStable();

    const fill = (fixture.nativeElement as HTMLElement).querySelector('.meter-fill') as HTMLElement;
    expect(fill.classList.contains('warn')).toBe(true);
    expect(fill.classList.contains('danger')).toBe(false);
  });

  it('marks the host as decorative', async () => {
    const fixture = TestBed.createComponent(MeterComponent);
    await fixture.whenStable();

    const host = fixture.nativeElement as HTMLElement;
    expect(host.getAttribute('aria-hidden')).toBe('true');
    expect(host.getAttribute('role')).toBe('presentation');
  });
});
