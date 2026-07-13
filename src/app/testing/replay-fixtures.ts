import type {
  AgentEvent,
  AgentHandoffEvent,
  ToolCallEvent,
  ToolResultEvent,
  TurnCompleteEvent,
  TurnStartEvent,
} from '../core/streaming/agent-event';
import type { ReplayPayload } from '../core/replay/replay.types';

const DEFAULT_EVENTS: readonly AgentEvent[] = [
  { type: 'turn_start', ts: 0, turnId: 't1' },
  { type: 'turn_complete', ts: 100, turnId: 't1', rounds: 1, finishReason: 'STOP' },
];

export function makeReplayPayload(partial: Partial<ReplayPayload> = {}): ReplayPayload {
  const events = partial.events ?? DEFAULT_EVENTS;
  const firstTs = events.at(0)?.ts ?? 0;
  const lastTs = events.at(-1)?.ts ?? firstTs;
  return {
    schemaVersion: 1,
    id: partial.id ?? 'r-1',
    title: partial.title ?? 'Test run',
    savedAt: partial.savedAt ?? '2026-05-10T10:00:00.000Z',
    prompt: partial.prompt ?? 'Plan a weekend in Goa.',
    model: partial.model ?? 'gemini-3-flash-preview',
    events,
    rawHistory: partial.rawHistory ?? [],
    ...(partial.customToolSpecs !== undefined ? { customToolSpecs: partial.customToolSpecs } : {}),
    durationMs: partial.durationMs ?? Math.max(0, lastTs - firstTs),
    eventCount: partial.eventCount ?? events.length,
    ...(partial.sizeBytes !== undefined ? { sizeBytes: partial.sizeBytes } : {}),
    stats: partial.stats ?? { chunks: 1, parts: 1, signedParts: 0 },
  };
}

// Build a turn's event stream with optional tool call/result pairs and a handoff.
export function buildTurnEvents(
  opts: { tools?: readonly string[]; withHandoff?: boolean } = {},
): AgentEvent[] {
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
