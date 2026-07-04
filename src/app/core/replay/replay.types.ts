import type { AgentEvent } from '../streaming/agent-event';
import type { HistoryContent } from '../streaming/raw-history.reducer';
import type { CustomToolSpec } from '../custom-tools/custom-tool.types';

export interface ReplayPayload {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly title: string;
  readonly savedAt: string;
  readonly prompt: string;
  readonly model: string;
  readonly events: readonly AgentEvent[];
  readonly rawHistory: readonly HistoryContent[];
  // Specs for any custom tools this run invoked (agent-synthesized or
  // hand-built). Embedded so the replay renders its tool cards even after the
  // tool is deleted or on another device. Optional: older payloads omit it.
  readonly customToolSpecs?: readonly CustomToolSpec[];
  readonly durationMs: number;
  readonly eventCount: number;
  readonly stats: {
    readonly chunks: number;
    readonly parts: number;
    readonly signedParts: number;
  };
}

export interface ReplaySummary {
  readonly id: string;
  readonly title: string;
  readonly savedAt: string;
  readonly prompt: string;
  readonly model: string;
  readonly durationMs: number;
  readonly eventCount: number;
}

export function toSummary(p: ReplayPayload): ReplaySummary {
  return {
    id: p.id,
    title: p.title,
    savedAt: p.savedAt,
    prompt: p.prompt,
    model: p.model,
    durationMs: p.durationMs,
    eventCount: p.eventCount,
  };
}
