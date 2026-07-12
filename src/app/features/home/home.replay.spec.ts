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
import type {
  AgentEvent,
  AgentHandoffEvent,
  ToolCallEvent,
  ToolResultEvent,
  TurnCompleteEvent,
  TurnStartEvent,
} from '../../core/streaming/agent-event';
import type { ReplayPayload } from '../../core/replay/replay.types';
import type { ToolManifest } from '../../core/registry/tool-descriptor';

// Minimal in-memory tool that the registry can register and "load". The
// component class isn't a real Angular component — it just needs to be a
// non-null reference so `componentFor` returns truthy after loading.
function makeMockTool(name: string): {
  manifest: ToolManifest;
  loadSpy: ReturnType<typeof vi.fn>;
} {
  const component = class MockComponent {} as unknown as new () => unknown;
  const loadSpy = vi.fn(async () => ({
    name,
    description: `mock ${name}`,
    declaration: { name, description: 'mock', parameters: { type: 'OBJECT', properties: {} } },
    argsSchema: { safeParse: () => ({ success: true, data: {} }) },
    component,
    execute: async () => ({}),
  }));
  return {
    manifest: {
      name,
      description: `mock ${name}`,
      declaration: { name, description: 'mock', parameters: { type: 'OBJECT', properties: {} } },
      load: loadSpy,
    } as unknown as ToolManifest,
    loadSpy,
  };
}

function buildEvents(opts: { tools?: readonly string[]; withHandoff?: boolean }): AgentEvent[] {
  const turnId = 'saved-turn';
  const events: AgentEvent[] = [];
  const start: TurnStartEvent = { type: 'turn_start', ts: 0, turnId };
  events.push(start);
  for (const [i, name] of (opts.tools ?? []).entries()) {
    const call: ToolCallEvent = {
      type: 'tool_call',
      ts: 10 + i,
      turnId,
      callId: `call-${i}`,
      name,
      args: {},
    };
    const result: ToolResultEvent = {
      type: 'tool_result',
      ts: 20 + i,
      turnId,
      callId: `call-${i}`,
      result: { ok: true },
    };
    events.push(call, result);
  }
  if (opts.withHandoff) {
    const handoff: AgentHandoffEvent = {
      type: 'agent_handoff',
      ts: 50,
      turnId,
      fromAgentId: 'tripPlanner',
      toAgentId: 'experienceCurator',
      reason: 'user pivoted to activities',
    };
    events.push(handoff);
  }
  const complete: TurnCompleteEvent = {
    type: 'turn_complete',
    ts: 60,
    turnId,
    rounds: 1,
    finishReason: 'STOP',
  };
  events.push(complete);
  return events;
}

function makePayload(id: string, events: readonly AgentEvent[]): ReplayPayload {
  const firstTs = events.at(0)?.ts ?? 0;
  const lastTs = events.at(-1)?.ts ?? firstTs;
  return {
    schemaVersion: 1,
    id,
    title: 'mock',
    savedAt: new Date().toISOString(),
    prompt: 'mock prompt',
    model: 'gemini-test',
    events,
    rawHistory: [],
    durationMs: lastTs - firstTs,
    eventCount: events.length,
    stats: { chunks: 0, parts: 0, signedParts: 0 },
  };
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
    // Saved events span ~60ms of timeline; play() emits with real timers, so
    // give it a short real wait to drain to turn_complete.
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

    // Nothing saved under this id → load() resolves null → recovery banner state.
    await instance.loadAndReplay('does-not-exist');

    expect(instance.replayLoadError()).toBeTruthy();
    expect(instance.activeReplayId()).toBeNull();
  });

  it('retryToolLoad re-attempts a failed lazy module and clears the failed flag (M19)', async () => {
    const registry = TestBed.inject(ToolRegistry);
    const tool = makeMockTool('flakyTool');
    tool.loadSpy.mockRejectedValueOnce(new Error('network blip'));
    registry.register(tool.manifest);

    const fixture = TestBed.createComponent(HomeComponent);
    const instance = fixture.componentInstance as unknown as {
      retryToolLoad: (name: string) => void;
    };
    await fixture.whenStable();

    // First load fails → the registry flags it as failed.
    await expect(registry.loadImpl('flakyTool')).rejects.toThrow('network blip');
    expect(registry.hasFailed('flakyTool')).toBe(true);

    // Retry now succeeds → failed flag clears and the component resolves.
    instance.retryToolLoad('flakyTool');
    await vi.waitFor(() => expect(registry.hasFailed('flakyTool')).toBe(false));
    expect(registry.componentFor('flakyTool')).not.toBeNull();
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
