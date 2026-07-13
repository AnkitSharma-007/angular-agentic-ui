import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { MetricComponent } from './metric';

describe('MetricComponent', () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection()] });
  });

  it('renders the label and value', async () => {
    const fixture = TestBed.createComponent(MetricComponent);
    fixture.componentRef.setInput('label', 'Total tokens');
    fixture.componentRef.setInput('value', '1.2k');
    await fixture.whenStable();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('.metric-label')?.textContent).toContain('Total tokens');
    expect(el.querySelector('.metric-value')?.textContent).toContain('1.2k');
  });

  it('renders a leading icon when provided', async () => {
    const fixture = TestBed.createComponent(MetricComponent);
    fixture.componentRef.setInput('label', 'In memory');
    fixture.componentRef.setInput('value', 'Yes');
    fixture.componentRef.setInput('icon', 'check_circle');
    await fixture.whenStable();

    const icon = (fixture.nativeElement as HTMLElement).querySelector('mat-icon');
    expect(icon?.textContent).toContain('check_circle');
  });

  it('reflects size/appearance/tone on the host for styling hooks', async () => {
    const fixture = TestBed.createComponent(MetricComponent);
    fixture.componentRef.setInput('label', 'Rounds');
    fixture.componentRef.setInput('size', 'lg');
    fixture.componentRef.setInput('appearance', 'tile');
    fixture.componentRef.setInput('tone', 'ok');
    await fixture.whenStable();

    const host = fixture.nativeElement as HTMLElement;
    expect(host.getAttribute('data-size')).toBe('lg');
    expect(host.getAttribute('data-appearance')).toBe('tile');
    expect(host.getAttribute('data-tone')).toBe('ok');
  });
});
