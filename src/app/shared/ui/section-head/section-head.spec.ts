import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { SectionHeadComponent } from './section-head';

describe('SectionHeadComponent', () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection()] });
  });

  it('renders the label without meta by default', async () => {
    const fixture = TestBed.createComponent(SectionHeadComponent);
    fixture.componentRef.setInput('label', 'Cost breakdown');
    await fixture.whenStable();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('.section-label')?.textContent).toContain('Cost breakdown');
    expect(el.querySelector('.section-meta')).toBeNull();
  });

  it('renders trailing meta when provided', async () => {
    const fixture = TestBed.createComponent(SectionHeadComponent);
    fixture.componentRef.setInput('label', 'Context window');
    fixture.componentRef.setInput('meta', '1M tokens');
    await fixture.whenStable();

    expect(
      (fixture.nativeElement as HTMLElement).querySelector('.section-meta')?.textContent,
    ).toContain('1M tokens');
  });
});
