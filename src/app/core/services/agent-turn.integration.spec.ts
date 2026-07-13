import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { runAgentTurn, type AgentLoopDeps, type StreamRoundRequest } from './agent-loop';
import type { AgentEvent } from '../streaming/agent-event';
import { AgentEventStore } from '../streaming/agent-event.store';
import type { GeminiChunk } from '../streaming/to-agent-event.operator';
import { InterruptService } from '../registry/interrupt.service';
import { ToolRegistry } from '../registry/tool-registry';
import { TokenAccountantService } from '../observability/token-accountant.service';
import { BudgetService } from '../observability/budget.service';
import { AgentRegistry } from '../agents/agent-registry.service';
import { CustomToolsService } from '../custom-tools/custom-tools.service';
import { proposeToolManifest } from '../../shared/tools/propose-tool/propose-tool.manifest';
import { asAsync, finishChunk, textChunk, toolChunk } from '../../testing/gemini-chunks';

const NOOP_OPTIONS = { model: 'gemini-3-test', thinkingConfig: { thinkingLevel: 'minimal' } };

const DRAFT = {
  name: 'searchWeather',
  description: 'Look up the weather for a city.',
  parameters: [
    { name: 'city', type: 'string' as const, description: 'City name', required: true },
  ],
  responseTemplate: '{"city": {{city}}, "forecast": "Sunny, 29C"}',
};

describe('agent tool synthesis — full loop integration', () => {
  beforeEach(() => {
    (globalThis as unknown as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({});
  });

  afterEach(() => TestBed.resetTestingModule());

  it('proposes a tool, registers it on approval, then calls it the next round', async () => {
    const registry = TestBed.inject(ToolRegistry);
    registry.register(proposeToolManifest);

    const customTools = TestBed.inject(CustomToolsService);
    const store = TestBed.inject(AgentEventStore);
    const interrupts = TestBed.inject(InterruptService);
    const tokens = TestBed.inject(TokenAccountantService);
    const budget = TestBed.inject(BudgetService);
    const agents = TestBed.inject(AgentRegistry);
    budget.reset();

    const responses: GeminiChunk[][] = [
      [toolChunk('proposeTool', DRAFT), finishChunk('STOP')],
      [toolChunk('searchWeather', { city: 'Goa' }), finishChunk('STOP')],
      [textChunk('The weather in Goa is sunny.'), finishChunk('STOP')],
    ];
    const streamChunks = vi.fn(async (_req: StreamRoundRequest) => {
      const chunks = responses.shift();
      if (!chunks) throw new Error('streamChunks called more times than scripted');
      return asAsync(chunks);
    });

    const deps: AgentLoopDeps = {
      streamChunks,
      store,
      registry,
      interrupts,
      tokenAccountant: tokens,
      budget,
      agents,
      customToolNames: () => customTools.customToolNames(),
      allowToolSynthesis: () => true,
    };

    const events: AgentEvent[] = [];
    const run = (async () => {
      for await (const e of runAgentTurn(
        'What is the weather in Goa?',
        't1',
        NOOP_OPTIONS,
        new AbortController().signal,
        deps,
      )) {
        events.push(e);
      }
    })();

    // Approve like ProposeToolCard.approve(): register tool, then resolve interrupt.
    await vi.waitFor(() => expect(interrupts.hasPending()).toBe(true));
    const callId = interrupts.pendingIds()[0];
    const spec = customTools.finalizeDraft({ ...DRAFT, origin: 'agent' });
    await customTools.save(spec);
    interrupts.decide(callId, {
      kind: 'select',
      selection: { registered: true, name: spec.name, description: spec.description },
    });

    await run;

    const round0Names = declaredNames(streamChunks, 0);
    expect(round0Names).toContain('proposeTool');

    const round1Names = declaredNames(streamChunks, 1);
    expect(round1Names).toContain('searchWeather');

    const toolResults = events.filter(
      (e): e is Extract<AgentEvent, { type: 'tool_result' }> => e.type === 'tool_result',
    );
    const weatherResult = toolResults.find(
      (e) => (e.result as { toolName?: string }).toolName === 'searchWeather',
    );
    expect(weatherResult).toBeDefined();
    expect((weatherResult!.result as { response: unknown }).response).toEqual({
      city: 'Goa',
      forecast: 'Sunny, 29C',
    });

    expect(customTools.customToolNames().has('searchWeather')).toBe(true);
    expect(customTools.getById(spec.id)?.origin).toBe('agent');

    const last = events.at(-1) as Extract<AgentEvent, { type: 'turn_complete' }>;
    expect(last.type).toBe('turn_complete');
    expect(streamChunks).toHaveBeenCalledTimes(3);
  });
});

function declaredNames(
  streamChunks: ReturnType<typeof vi.fn>,
  callIndex: number,
): readonly string[] {
  const req = streamChunks.mock.calls[callIndex][0] as StreamRoundRequest;
  const decls = req.config.tools?.[0].functionDeclarations as
    | readonly { name: string }[]
    | undefined;
  return (decls ?? []).map((d) => d.name);
}
