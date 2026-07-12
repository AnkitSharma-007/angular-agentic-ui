import { z } from 'zod';
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
  // Approximate encoded size of the run (bytes), recorded at save time so the
  // Library can flag heavy replays without loading each payload. Optional:
  // payloads saved before this field was added omit it (L10).
  readonly sizeBytes?: number;
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
  readonly sizeBytes?: number;
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
    sizeBytes: p.sizeBytes,
  };
}

// Events and history parts are large discriminated unions; validating only that
// each entry is an object with a string `type` (events) / a `parts` array
// (history) is enough to keep a corrupt row from crashing `toSummary`, the
// player, or `byDateDesc` without re-declaring the whole schema here.
const eventShape = z.object({ type: z.string() });
const historyShape = z.object({ parts: z.array(z.unknown()) });

const replayPayloadSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string().min(1),
  title: z.string(),
  savedAt: z.string().min(1),
  prompt: z.string(),
  model: z.string(),
  events: z.array(eventShape),
  rawHistory: z.array(historyShape),
  customToolSpecs: z.array(z.unknown()).optional(),
  durationMs: z.number(),
  eventCount: z.number(),
  sizeBytes: z.number().optional(),
  stats: z.object({
    chunks: z.number(),
    parts: z.number(),
    signedParts: z.number(),
  }),
});

// Validate an untrusted payload read from IndexedDB. On success we return the
// original object unchanged (narrowed) so no event/history internals are lost —
// the schema only guards the fields the app relies on, including
// `schemaVersion`. Invalid `customToolSpecs` are filtered separately at
// registration time via `isValidCustomToolSpec`.
export function isValidReplayPayload(value: unknown): value is ReplayPayload {
  return replayPayloadSchema.safeParse(value).success;
}

export function parseReplayPayload(value: unknown): ReplayPayload | null {
  return isValidReplayPayload(value) ? value : null;
}
