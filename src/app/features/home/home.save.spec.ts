import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { provideRouter } from '@angular/router';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { HomeComponent } from './home';
import { AgentEventStore } from '../../core/streaming/agent-event.store';
import { ReplayService } from '../../core/replay/replay.service';
import type { AgentEvent } from '../../core/streaming/agent-event';
import type { ReplayPayload } from '../../core/replay/replay.types';
import type { HistoryContent } from '../../core/streaming/raw-history.reducer';

describe('HomeComponent.save() — turn scoping', () => {
  beforeEach(() => {
    (globalThis as unknown as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [provideZonelessChangeDetection(), provideAnimationsAsync(), provideRouter([])],
    });
  });

  it('snapshots only the latest turn when the store has accumulated multiple turns', async () => {
    const store = TestBed.inject(AgentEventStore);
    const replays = TestBed.inject(ReplayService);

    // Turn 1 events must not appear in the saved payload.
    store.beginTurn('turn-1');
    const oldEvents: AgentEvent[] = [
      { type: 'turn_start', ts: 100, turnId: 'turn-1' },
      { type: 'text_delta', ts: 101, turnId: 'turn-1', chunk: 'first response' },
      { type: 'turn_complete', ts: 110, turnId: 'turn-1', rounds: 1, finishReason: 'STOP' },
    ];
    for (const ev of oldEvents) store.pushEvent(ev);

    // Turn 2 is the current turn being saved.
    store.beginTurn('turn-2');
    const newEvents: AgentEvent[] = [
      { type: 'turn_start', ts: 200, turnId: 'turn-2' },
      { type: 'text_delta', ts: 201, turnId: 'turn-2', chunk: 'second response' },
      { type: 'turn_complete', ts: 220, turnId: 'turn-2', rounds: 1, finishReason: 'STOP' },
    ];
    for (const ev of newEvents) store.pushEvent(ev);

    // Persist rawHistory from the latest user message only.
    const fullHistory: readonly HistoryContent[] = [
      { role: 'user', parts: [{ text: 'first prompt' }] },
      { role: 'model', parts: [{ text: 'first response' }] },
      { role: 'user', parts: [{ text: 'second prompt' }] },
      { role: 'model', parts: [{ text: 'second response' }] },
    ];
    store.loadRawHistory(fullHistory);

    const fixture = TestBed.createComponent(HomeComponent);
    const instance = fixture.componentInstance as unknown as {
      lastPrompt: { set: (v: string) => void };
      save: () => Promise<void>;
    };
    await fixture.whenStable();
    instance.lastPrompt.set('second prompt');

    const saveSpy = vi.spyOn(replays, 'save').mockResolvedValue();

    await instance.save();

    expect(saveSpy).toHaveBeenCalledTimes(1);
    const payload = saveSpy.mock.calls[0][0] as ReplayPayload;

    expect(payload.events.every((e) => e.turnId === 'turn-2')).toBe(true);
    expect(payload.events).toHaveLength(newEvents.length);
    expect(payload.eventCount).toBe(newEvents.length);
    expect(payload.durationMs).toBe(220 - 200);
    expect(payload.prompt).toBe('second prompt');

    expect(payload.rawHistory).toHaveLength(2);
    expect(payload.rawHistory[0]).toEqual({
      role: 'user',
      parts: [{ text: 'second prompt' }],
    });
    expect(payload.rawHistory[1]).toEqual({
      role: 'model',
      parts: [{ text: 'second response' }],
    });
  });

  it('falls back to the full history when no user message has been recorded yet', async () => {
    const store = TestBed.inject(AgentEventStore);
    const replays = TestBed.inject(ReplayService);

    store.beginTurn('turn-only');
    store.pushEvent({ type: 'turn_start', ts: 1, turnId: 'turn-only' });
    store.pushEvent({
      type: 'text_delta',
      ts: 2,
      turnId: 'turn-only',
      chunk: 'hello',
    });
    store.pushEvent({
      type: 'turn_complete',
      ts: 3,
      turnId: 'turn-only',
      rounds: 1,
      finishReason: 'STOP',
    });

    const onlyModel: readonly HistoryContent[] = [{ role: 'model', parts: [{ text: 'orphan' }] }];
    store.loadRawHistory(onlyModel);

    const fixture = TestBed.createComponent(HomeComponent);
    const instance = fixture.componentInstance as unknown as {
      lastPrompt: { set: (v: string) => void };
      save: () => Promise<void>;
    };
    await fixture.whenStable();
    instance.lastPrompt.set('hi');

    const saveSpy = vi.spyOn(replays, 'save').mockResolvedValue();
    await instance.save();

    const payload = saveSpy.mock.calls[0][0] as ReplayPayload;
    expect(payload.rawHistory).toEqual(onlyModel);
  });

  it('classifies a failed save and surfaces an actionable reason instead of swallowing it', async () => {
    const store = TestBed.inject(AgentEventStore);
    const replays = TestBed.inject(ReplayService);

    store.beginTurn('turn-fail');
    store.pushEvent({ type: 'turn_start', ts: 1, turnId: 'turn-fail' });
    store.pushEvent({ type: 'text_delta', ts: 2, turnId: 'turn-fail', chunk: 'hello' });
    store.pushEvent({
      type: 'turn_complete',
      ts: 3,
      turnId: 'turn-fail',
      rounds: 1,
      finishReason: 'STOP',
    });
    store.loadRawHistory([
      { role: 'user', parts: [{ text: 'hi' }] },
      { role: 'model', parts: [{ text: 'hello' }] },
    ]);

    const fixture = TestBed.createComponent(HomeComponent);
    const instance = fixture.componentInstance as unknown as {
      lastPrompt: { set: (v: string) => void };
      save: () => Promise<void>;
      saveStatus: () => string;
      saveWarning: () => string | null;
    };
    await fixture.whenStable();
    instance.lastPrompt.set('hi');

    vi.spyOn(replays, 'save').mockRejectedValue(new DOMException('exceeded', 'QuotaExceededError'));

    await instance.save();

    expect(instance.saveStatus()).toBe('error');
    expect(instance.saveWarning()).toBe(
      'Your browser storage is full. Delete some saved conversations and try again.',
    );
  });
});
