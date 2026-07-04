import { Service, computed, inject } from '@angular/core';
import { Observable } from 'rxjs';
import type { GoogleGenAI, ThinkingLevel as SdkThinkingLevel } from '@google/genai';
import { ApiKeyService } from './api-key.service';
import {
  GEMINI_MODELS,
  DEFAULT_MODEL,
  ModelSelectionService,
  type GeminiModelId,
} from './model-selection.service';
import {
  runAgentTurn,
  type AgentLoopDeps,
  type StreamRoundRequest,
} from './agent-loop';
import type { AgentEvent } from '../streaming/agent-event';
import { AgentEventStore } from '../streaming/agent-event.store';
import type { UserTurnInput } from '../media/attachment.types';
import type { GeminiChunk } from '../streaming/to-agent-event.operator';
import { InterruptService } from '../registry/interrupt.service';
import { ToolRegistry } from '../registry/tool-registry';
import { TokenAccountantService } from '../observability/token-accountant.service';
import { BudgetService } from '../observability/budget.service';
import { AgentRegistry } from '../agents/agent-registry.service';
import { CustomToolsService } from '../custom-tools/custom-tools.service';
import { ToolSynthesisSettings } from '../settings/tool-synthesis.settings';

export { GEMINI_MODELS, DEFAULT_MODEL };
export type { GeminiModelId };

type ThinkingLevel = 'minimal' | 'low' | 'medium' | 'high';

// The SDK's ThinkingLevel enum members hold the same lowercase string values;
// hard-coding them lets us keep @google/genai out of the initial bundle.
const THINKING_LEVEL_MAP: Record<ThinkingLevel, SdkThinkingLevel> = {
  minimal: 'minimal' as SdkThinkingLevel,
  low: 'low' as SdkThinkingLevel,
  medium: 'medium' as SdkThinkingLevel,
  high: 'high' as SdkThinkingLevel,
};

let sdkModulePromise: Promise<typeof import('@google/genai')> | null = null;
function loadSdk(): Promise<typeof import('@google/genai')> {
  if (!sdkModulePromise) {
    sdkModulePromise = import('@google/genai');
  }
  return sdkModulePromise;
}

interface StreamOptions {
  readonly model?: GeminiModelId;
  readonly thinkingLevel?: ThinkingLevel;
  readonly includeThoughts?: boolean;
  readonly signal?: AbortSignal;
}

class MissingApiKeyError extends Error {
  constructor() {
    super('No Gemini API key set. Complete the onboarding flow first.');
    this.name = 'MissingApiKeyError';
  }
}

@Service()
export class GeminiService {
  private readonly apiKey = inject(ApiKeyService);
  private readonly store = inject(AgentEventStore);
  private readonly registry = inject(ToolRegistry);
  private readonly interrupts = inject(InterruptService);
  private readonly tokenAccountant = inject(TokenAccountantService);
  private readonly budget = inject(BudgetService);
  private readonly modelSelection = inject(ModelSelectionService);
  private readonly agents = inject(AgentRegistry);
  private readonly customTools = inject(CustomToolsService);
  private readonly toolSynthesis = inject(ToolSynthesisSettings);

  readonly selectedModel = this.modelSelection.selectedModel;
  readonly ready = computed(() => this.apiKey.hasKey());

  selectModel(model: GeminiModelId): void {
    this.modelSelection.selectModel(model);
  }

  async testConnection(candidateKey: string): Promise<true> {
    const trimmed = candidateKey?.trim();
    if (!trimmed) throw new Error('Enter a key first.');

    const { GoogleGenAI: GenAI } = await loadSdk();
    const ai = new GenAI({ apiKey: trimmed });
    const stream = await ai.models.generateContentStream({
      model: 'gemini-3-flash-preview',
      contents: 'Reply with one word: ok',
      config: { thinkingConfig: { thinkingLevel: 'minimal' as SdkThinkingLevel } },
    });
    // Drain the iterator so the underlying HTTP connection closes cleanly.
    for await (const _chunk of stream) {
      void _chunk;
    }
    return true;
  }

  streamAgentTurn(
    input: string | UserTurnInput,
    turnId: string,
    options: StreamOptions = {},
  ): Observable<AgentEvent> {
    return new Observable<AgentEvent>((subscriber) => {
      const abort = new AbortController();
      const externalSignal = options.signal;
      // Held in a named ref so teardown can removeEventListener — otherwise a
      // long-lived caller signal leaks one listener per subscription.
      let onExternalAbort: (() => void) | null = null;
      if (externalSignal) {
        if (externalSignal.aborted) {
          abort.abort();
        } else {
          onExternalAbort = () => abort.abort();
          externalSignal.addEventListener('abort', onExternalAbort);
        }
      }

      (async () => {
        try {
          const ai = await this.createClient();
          const deps = this.buildDeps(ai);
          const loopOptions = {
            model: options.model ?? this.selectedModel(),
            thinkingConfig: buildThinkingConfig(options),
          };

          for await (const event of runAgentTurn(
            input,
            turnId,
            loopOptions,
            abort.signal,
            deps,
          )) {
            if (abort.signal.aborted) {
              // External abort between iterations — always terminate the
              // subscriber so callers don't sit on an open Observable.
              subscriber.complete();
              return;
            }
            subscriber.next(event);
          }
          subscriber.complete();
        } catch (err) {
          if (abort.signal.aborted) subscriber.complete();
          else subscriber.error(err);
        }
      })();

      return () => {
        abort.abort();
        if (externalSignal && onExternalAbort) {
          externalSignal.removeEventListener('abort', onExternalAbort);
        }
      };
    });
  }

  private buildDeps(ai: GoogleGenAI): AgentLoopDeps {
    return {
      streamChunks: async (req: StreamRoundRequest) => {
        const stream = await ai.models.generateContentStream({
          model: req.model,
          contents: req.contents as Parameters<
            typeof ai.models.generateContentStream
          >[0]['contents'],
          config: req.config as Parameters<
            typeof ai.models.generateContentStream
          >[0]['config'],
        });
        return stream as AsyncIterable<GeminiChunk>;
      },
      store: this.store,
      registry: this.registry,
      interrupts: this.interrupts,
      tokenAccountant: this.tokenAccountant,
      budget: this.budget,
      agents: this.agents,
      customToolNames: () => this.customTools.customToolNames(),
      allowToolSynthesis: () => this.toolSynthesis.enabled(),
    };
  }

  private async createClient(): Promise<GoogleGenAI> {
    const key = this.apiKey.key();
    if (!key) throw new MissingApiKeyError();
    const { GoogleGenAI: GenAI } = await loadSdk();
    return new GenAI({ apiKey: key });
  }
}

function buildThinkingConfig(options: StreamOptions) {
  return {
    includeThoughts: options.includeThoughts ?? true,
    thinkingLevel: THINKING_LEVEL_MAP[options.thinkingLevel ?? 'high'],
  };
}
