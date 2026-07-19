import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { beforeEach, describe, expect, it } from 'vitest';
import { ReplayListItemComponent } from './replay-list-item';
import type { ReplaySummary } from '../../../core/replay/replay.types';

const SUMMARY: ReplaySummary = {
  id: 'run-1',
  title: 'Weekend in Goa',
  prompt: 'Plan a weekend trip',
  model: 'gemini-3.5-flash',
  savedAt: new Date('2026-06-13T10:00:00Z').toISOString(),
  durationMs: 1500,
  eventCount: 42,
};

function createItem(summary: ReplaySummary, confirming = false) {
  const fixture = TestBed.createComponent(ReplayListItemComponent);
  fixture.componentRef.setInput('summary', summary);
  fixture.componentRef.setInput('confirming', confirming);
  return fixture;
}

describe('ReplayListItemComponent', () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [provideZonelessChangeDetection(), provideAnimationsAsync()],
    });
  });

  it('formatDuration handles ms / seconds / minutes', () => {
    const fixture = createItem(SUMMARY);
    const fmt = (
      fixture.componentInstance as unknown as { formatDuration: (ms: number) => string }
    ).formatDuration;
    expect(fmt(150)).toBe('150 ms');
    expect(fmt(1500)).toBe('1.5 s');
    expect(fmt(125000)).toMatch(/2m \d+s/);
  });

  it('renders the summary title, prompt, and event count', async () => {
    const fixture = createItem(SUMMARY);
    await fixture.whenStable();
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Weekend in Goa');
    expect(text).toContain('Plan a weekend trip');
    expect(text).toContain('42 steps');
  });

  it('flags a large replay with the warning icon', async () => {
    const fixture = createItem({ ...SUMMARY, sizeBytes: 5_000_000 });
    await fixture.whenStable();
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('warning');
  });

  it('emits play and delete outputs from the action buttons', async () => {
    const fixture = createItem(SUMMARY);
    await fixture.whenStable();

    let played = 0;
    let deleted = 0;
    fixture.componentInstance.play.subscribe(() => (played += 1));
    fixture.componentInstance.delete.subscribe(() => (deleted += 1));

    const buttons = (fixture.nativeElement as HTMLElement).querySelectorAll('button');
    const deleteBtn = Array.from(buttons).find((b) =>
      b.getAttribute('aria-label')?.includes('Delete'),
    );
    const replayBtn = Array.from(buttons).find((b) => b.textContent?.includes('Replay'));

    deleteBtn?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    replayBtn?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(deleted).toBe(1);
    expect(played).toBe(1);
  });
});
