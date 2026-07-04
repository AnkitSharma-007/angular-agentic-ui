import { Service, signal } from '@angular/core';

// Names from https://ai.google.dev/gemini-api/docs/gemini-3.
// Kept in its own service so the eagerly-loaded cost meter doesn't pull
// `@google/genai` into the initial bundle just to read the selected model.
export const GEMINI_MODELS = [
  { id: 'gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro (paid)', tier: 'pro' },
  { id: 'gemini-3-flash-preview', label: 'Gemini 3 Flash (free tier)', tier: 'flash' },
  {
    id: 'gemini-3.1-flash-lite-preview',
    label: 'Gemini 3.1 Flash-Lite (free tier, lowest cost)',
    tier: 'flash-lite',
  },
] as const;

export type GeminiModelId = (typeof GEMINI_MODELS)[number]['id'];

export const DEFAULT_MODEL: GeminiModelId = 'gemini-3-flash-preview';

@Service()
export class ModelSelectionService {
  private readonly _selectedModel = signal<GeminiModelId>(DEFAULT_MODEL);
  readonly selectedModel = this._selectedModel.asReadonly();

  selectModel(model: GeminiModelId): void {
    this._selectedModel.set(model);
  }
}
