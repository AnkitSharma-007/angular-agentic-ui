export type AgentEvent =
  | TurnStartEvent
  | ThoughtDeltaEvent
  | ThoughtCompleteEvent
  | ToolCallEvent
  | ToolResultEvent
  | InterruptRequestEvent
  | InterruptResolvedEvent
  | TextDeltaEvent
  | RoundCompleteEvent
  | TurnCompleteEvent
  | AgentHandoffEvent;

interface BaseEvent {
  readonly ts: number;
  readonly turnId: string;
}

export interface TurnStartEvent extends BaseEvent {
  readonly type: 'turn_start';
}

export interface ThoughtDeltaEvent extends BaseEvent {
  readonly type: 'thought_delta';
  readonly chunk: string;
}

export interface ThoughtCompleteEvent extends BaseEvent {
  readonly type: 'thought_complete';
}

export interface ToolCallEvent extends BaseEvent {
  readonly type: 'tool_call';
  readonly callId: string;
  readonly name: string;
  readonly args: Record<string, unknown>;
}

export interface ToolResultEvent extends BaseEvent {
  readonly type: 'tool_result';
  readonly callId: string;
  readonly result: Record<string, unknown> | { readonly error: string };
}

export interface InterruptRequestEvent extends BaseEvent {
  readonly type: 'interrupt_request';
  readonly callId: string;
  readonly reason: string;
}

export interface InterruptResolvedEvent extends BaseEvent {
  readonly type: 'interrupt_resolved';
  readonly callId: string;
  readonly decision: 'approve' | 'reject' | 'select';
  readonly note?: string;
  readonly selection?: Record<string, unknown>;
}

export interface TextDeltaEvent extends BaseEvent {
  readonly type: 'text_delta';
  readonly chunk: string;
}

export interface RoundCompleteEvent extends BaseEvent {
  readonly type: 'round_complete';
  readonly roundIndex: number;
  readonly finishReason: string;
  readonly latencyMs?: number;
  readonly usage?: {
    readonly inputTokens: number;
    readonly outputTokens: number;
    readonly thoughtTokens: number;
    readonly totalTokens: number;
  };
  // False when the round carried no usageMetadata — `usage` is then a zero
  // placeholder rather than a real measurement (M2).
  readonly usageAvailable?: boolean;
}

export interface TurnCompleteEvent extends BaseEvent {
  readonly type: 'turn_complete';
  readonly rounds: number;
  readonly finishReason: string;
}

export interface AgentHandoffEvent extends BaseEvent {
  readonly type: 'agent_handoff';
  readonly fromAgentId: string;
  readonly toAgentId: string;
  readonly reason: string;
}
