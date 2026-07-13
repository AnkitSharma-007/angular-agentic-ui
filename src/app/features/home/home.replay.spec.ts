import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { provideRouter } from '@angular/router';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { HomeComponent } from './home';
import { ReplayService } from '../../core/replay/replay.service';
import { ToolRegistry } from '../../core/registry/tool-registry';
import { AgentRegistry } from '../../core/agents/agent-registry.service';
import { TokenAccountantService } from '../../core/observability/token-accountant.service';
import type { AgentEvent } from '../../core/streaming/agent-event';
import type { ReplayPayload } from '../../core/replay/replay.types';
import type { ToolDescriptor, ToolManifest } from '../../core/registry/tool-descriptor';
import { buildTurnEvents as buildEvents, makeReplayPayload } from '../../testing/replay-fixtures';
import { defineToolManifest, makeToolDescriptor } from '../../testing/tool-manifest';

// Mock tool reference so componentFor is truthy after load — not a real Angular component.
function makeMockTool(name: string): {
  manifest: ToolManifest;
  loadSpy: ReturnType<typeof vi.fn>;
} {
  const component = class MockComponent {} as unknown as ToolDescriptor['component'];
  const loadSpy = vi.fn(async () => makeToolDescriptor(name, { component }));
  return { manifest: defineToolManifest(name, { load: loadSpy }), loadSpy };
}

function makePayload(id: string, events: readonly AgentEvent[]): ReplayPayload {
  return makeReplayPayload({ id, events });
}

describe('HomeComponent replay flow', () => {
  beforeEach(() => {
    (globalThis as unknown as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        provideAnimationsAsync(),
        provideRouter([]),
      ],
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('pre-loads tool descriptors for every unique tool in the saved events before play()', async () => {
    const registry = TestBed.inject(ToolRegistry);
    const flights = makeMockTool('findFlights');
    const hotels = makeMockTool('findHotels');
    registry.register(flights.manifest);
    registry.register(hotels.manifest);

    const fixture = TestBed.createComponent(HomeComponent);
    const instance = fixture.componentInstance as unknown as {
      loadAndReplay: (id: string) => Promise<void>;
    };
    await fixture.whenStable();

    const replays = TestBed.inject(ReplayService);
    const payload = makePayload(
      'r1',
      buildEvents({ tools: ['findFlights', 'findHotels', 'findFlights'] }),
    );
    await replays.save(payload);

    await instance.loadAndReplay('r1');

    expect(flights.loadSpy).toHaveBeenCalledTimes(1);
    expect(hotels.loadSpy).toHaveBeenCalledTimes(1);
    expect(registry.componentFor('findFlights')).not.toBeNull();
    expect(registry.componentFor('findHotels')).not.toBeNull();
  });

  it('skips preloading for tools with no registered manifest (graceful)', async () => {
    const fixture = TestBed.createComponent(HomeComponent);
    const instance = fixture.componentInstance as unknown as {
      loadAndReplay: (id: string) => Promise<void>;
    };
    await fixture.whenStable();

    const replays = TestBed.inject(ReplayService);
    const payload = makePayload('r2', buildEvents({ tools: ['ghostTool'] }));
    await replays.save(payload);

    await expect(instance.loadAndReplay('r2')).resolves.toBeUndefined();
  });

  it('resets AgentRegistry and per-turn TokenAccountant at the start of a replay', async () => {
    const agents = TestBed.inject(AgentRegistry);
    const tokens = TestBed.inject(TokenAccountantService);
    const resetAgentsSpy = vi.spyOn(agents, 'resetForNewTurn');
    const resetTurnSpy = vi.spyOn(tokens, 'resetTurn');

    const fixture = TestBed.createComponent(HomeComponent);
    const instance = fixture.componentInstance as unknown as {
      loadAndReplay: (id: string) => Promise<void>;
    };
    await fixture.whenStable();

    const replays = TestBed.inject(ReplayService);
    await replays.save(makePayload('r3', buildEvents({})));

    await instance.loadAndReplay('r3');

    expect(resetAgentsSpy).toHaveBeenCalledTimes(1);
    expect(resetTurnSpy).toHaveBeenCalledTimes(1);
  });

  it('dispatches agent_handoff events through AgentRegistry.switchActive during replay', async () => {
    const agents = TestBed.inject(AgentRegistry);
    const switchSpy = vi.spyOn(agents, 'switchActive');
    const flights = makeMockTool('findFlights');
    TestBed.inject(ToolRegistry).register(flights.manifest);

    const fixture = TestBed.createComponent(HomeComponent);
    const instance = fixture.componentInstance as unknown as {
      loadAndReplay: (id: string) => Promise<void>;
    };
    await fixture.whenStable();

    const replays = TestBed.inject(ReplayService);
    await replays.save(
      makePayload('r4', buildEvents({ tools: ['findFlights'], withHandoff: true })),
    );

    await instance.loadAndReplay('r4');
    // play() uses real timers over a ~60ms timeline; wait briefly for turn_complete.
    await new Promise((r) => setTimeout(r, 200));

    expect(switchSpy).toHaveBeenCalled();
    const handoffCall = switchSpy.mock.calls.find(
      (args) => args[0]?.toAgentId === 'experienceCurator',
    );
    expect(handoffCall).toBeDefined();
    expect(handoffCall?.[0]).toMatchObject({
      toAgentId: 'experienceCurator',
      reason: 'user pivoted to activities',
    });
    expect(agents.activeAgentId()).toBe('experienceCurator');
  });

  it('keeps activeReplayId set after Stop so the banner can offer Restart', async () => {
    const fixture = TestBed.createComponent(HomeComponent);
    const instance = fixture.componentInstance as unknown as {
      activeReplayId: { (): string | null };
      loadAndReplay: (id: string) => Promise<void>;
      cancel: () => void;
    };
    await fixture.whenStable();

    const replays = TestBed.inject(ReplayService);
    await replays.save(makePayload('r5', buildEvents({})));

    await instance.loadAndReplay('r5');
    expect(instance.activeReplayId()).toBe('r5');

    instance.cancel();
    expect(instance.activeReplayId()).toBe('r5');
  });

  it('restart() re-runs loadAndReplay for the currently active replay id', async () => {
    const fixture = TestBed.createComponent(HomeComponent);
    const instance = fixture.componentInstance as unknown as {
      activeReplayId: { (): string | null };
      loadAndReplay: (id: string) => Promise<void>;
      restart: () => Promise<void>;
      cancel: () => void;
    };
    await fixture.whenStable();

    const replays = TestBed.inject(ReplayService);
    const loadSpy = vi.spyOn(replays, 'load');
    await replays.save(makePayload('r6', buildEvents({})));

    await instance.loadAndReplay('r6');
    expect(loadSpy).toHaveBeenCalledTimes(1);

    instance.cancel();
    await instance.restart();

    expect(loadSpy).toHaveBeenCalledTimes(2);
    expect(loadSpy).toHaveBeenLastCalledWith('r6');
  });

  it('surfaces a Back-to-Library recovery error for a missing replay id (M19)', async () => {
    const fixture = TestBed.createComponent(HomeComponent);
    const instance = fixture.componentInstance as unknown as {
      loadAndReplay: (id: string) => Promise<void>;
      replayLoadError: () => string | null;
      activeReplayId: () => string | null;
    };
    await fixture.whenStable();

    // load() resolves null when nothing is saved under this id.
    await instance.loadAndReplay('does-not-exist');

    expect(instance.replayLoadError()).toBeTruthy();
    expect(instance.activeReplayId()).toBeNull();
  });

  it('reset() clears activeReplayId and resets the agent registry', async () => {
    const agents = TestBed.inject(AgentRegistry);
    const resetAgentsSpy = vi.spyOn(agents, 'resetForNewTurn');

    const fixture = TestBed.createComponent(HomeComponent);
    const instance = fixture.componentInstance as unknown as {
      activeReplayId: { (): string | null };
      loadAndReplay: (id: string) => Promise<void>;
      reset: () => void;
    };
    await fixture.whenStable();

    const replays = TestBed.inject(ReplayService);
    await replays.save(makePayload('r7', buildEvents({})));

    await instance.loadAndReplay('r7');
    expect(instance.activeReplayId()).toBe('r7');

    resetAgentsSpy.mockClear();
    instance.reset();

    expect(instance.activeReplayId()).toBeNull();
    expect(resetAgentsSpy).toHaveBeenCalledTimes(1);
  });
});
