import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { Observable } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GeminiService, GEMINI_MODELS } from './gemini.service';
import { ApiKeyService } from './api-key.service';
import { BudgetService } from '../observability/budget.service';
import type { AgentEvent } from '../streaming/agent-event';
import type { GeminiChunk } from '../streaming/to-agent-event.operator';
import { asAsync } from '../../testing/gemini-chunks';

// Mock dynamic SDK import; vi.hoisted shares spies with the hoisted vi.mock factory.
const { generateContentStream, sdkConstructorCalls } = vi.hoisted(() => ({
  generateContentStream: vi.fn(),
  sdkConstructorCalls: [] as Array<{ apiKey: string }>,
}));

vi.mock('@google/genai', () => ({
  GoogleGenAI: class {
    models = { generateContentStream };
    constructor(opts: { apiKey: string }) {
      sdkConstructorCalls.push(opts);
    }
  },
}));

const OK_CHUNKS: readonly GeminiChunk[] = [
  { candidates: [{ content: { role: 'model', parts: [{ text: 'Hello there.' }] } }] },
  {
    candidates: [{ content: { role: 'model', parts: [] }, finishReason: 'STOP' }],
    usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 3, totalTokenCount: 8 },
  },
];

function collect(
  obs: Observable<AgentEvent>,
): Promise<{ events: AgentEvent[]; error?: unknown; completed: boolean }> {
  return new Promise((resolve) => {
    const events: AgentEvent[] = [];
    obs.subscribe({
      next: (e) => events.push(e),
      error: (error) => resolve({ events, error, completed: false }),
      complete: () => resolve({ events, completed: true }),
    });
  });
}

describe('GeminiService', () => {
  let gemini: GeminiService;
  let apiKey: ApiKeyService;

  beforeEach(() => {
    sdkConstructorCalls.length = 0;
    generateContentStream.mockReset();
    generateContentStream.mockImplementation(async () => asAsync(OK_CHUNKS));

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [provideZonelessChangeDetection()],
    });
    gemini = TestBed.inject(GeminiService);
    apiKey = TestBed.inject(ApiKeyService);
    TestBed.inject(BudgetService).reset();
    apiKey.clear();
  });

  describe('streamAgentTurn', () => {
    it('errors with MissingApiKeyError when no key is set (SDK never called)', async () => {
      const { events, error, completed } = await collect(gemini.streamAgentTurn('hi', 'turn-1'));

      expect(completed).toBe(false);
      expect(events).toHaveLength(0);
      expect((error as Error).name).toBe('MissingApiKeyError');
      expect(generateContentStream).not.toHaveBeenCalled();
    });

    it('streams a full turn to completion and constructs the client with the key', async () => {
      apiKey.setForSession('test-key');

      const { events, error, completed } = await collect(
        gemini.streamAgentTurn('plan a trip', 'turn-1'),
      );

      expect(error).toBeUndefined();
      expect(completed).toBe(true);
      const types = events.map((e) => e.type);
      expect(types[0]).toBe('turn_start');
      expect(types).toContain('text_delta');
      expect(types).toContain('round_complete');
      expect(types.at(-1)).toBe('turn_complete');

      expect(sdkConstructorCalls).toEqual([{ apiKey: 'test-key' }]);
    });

    it('requests the currently selected model', async () => {
      apiKey.setForSession('test-key');

      await collect(gemini.streamAgentTurn('hi', 'turn-1'));

      expect(generateContentStream).toHaveBeenCalledTimes(1);
      const req = generateContentStream.mock.calls[0][0] as { model: string };
      expect(req.model).toBe(gemini.selectedModel());
    });

    it('completes without emitting when the external signal is already aborted', async () => {
      apiKey.setForSession('test-key');
      const controller = new AbortController();
      controller.abort();

      const { events, error, completed } = await collect(
        gemini.streamAgentTurn('hi', 'turn-1', { signal: controller.signal }),
      );

      expect(completed).toBe(true);
      expect(error).toBeUndefined();
      expect(events).toHaveLength(0);
      expect(generateContentStream).not.toHaveBeenCalled();
    });

    it('surfaces SDK stream failures as an Observable error', async () => {
      apiKey.setForSession('test-key');
      generateContentStream.mockRejectedValueOnce(new Error('500 upstream boom'));

      const { error, completed } = await collect(gemini.streamAgentTurn('hi', 'turn-1'));

      expect(completed).toBe(false);
      expect((error as Error).message).toContain('boom');
    });

    it('does not retry a non-retryable setup failure', async () => {
      apiKey.setForSession('test-key');
      generateContentStream.mockRejectedValueOnce(new Error('500 upstream boom'));

      await collect(gemini.streamAgentTurn('hi', 'turn-1'));

      // Unknown/5xx is not retryable — exactly one attempt.
      expect(generateContentStream).toHaveBeenCalledTimes(1);
    });

    it('retries a transient (network) setup failure with backoff before surfacing it', async () => {
      vi.useFakeTimers();
      try {
        apiKey.setForSession('test-key');
        generateContentStream.mockReset();
        generateContentStream.mockRejectedValue(new Error('Failed to fetch'));

        const resultPromise = collect(gemini.streamAgentTurn('hi', 'turn-1'));
        await vi.advanceTimersByTimeAsync(20_000);
        const { error, completed } = await resultPromise;

        expect(completed).toBe(false);
        expect(error).toBeDefined();
        // Default policy: 1 try + 2 retries.
        expect(generateContentStream).toHaveBeenCalledTimes(3);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe('testConnection', () => {
    it('rejects when no key is provided', async () => {
      await expect(gemini.testConnection('  ')).rejects.toThrow(/Enter a key/i);
      expect(generateContentStream).not.toHaveBeenCalled();
    });

    it('resolves true after draining the probe stream', async () => {
      await expect(gemini.testConnection('probe-key')).resolves.toBe(true);
      expect(sdkConstructorCalls).toContainEqual({ apiKey: 'probe-key' });
      expect(generateContentStream).toHaveBeenCalledTimes(1);
    });
  });

  describe('model selection', () => {
    it('delegates selectModel/selectedModel to ModelSelectionService', () => {
      const other = GEMINI_MODELS.find((m) => m.id !== gemini.selectedModel());
      expect(other).toBeDefined();
      gemini.selectModel(other!.id);
      expect(gemini.selectedModel()).toBe(other!.id);
    });
  });
});
