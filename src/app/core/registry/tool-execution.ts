import type { AgentEvent, ToolCallEvent } from '../streaming/agent-event';
import type { InterruptDecision, InterruptService } from '../registry/interrupt.service';
import type { ToolMeta, ToolExecutionContext } from './tool-descriptor';
import type { ToolRegistry } from './tool-registry';

export interface SettledToolCall {
  readonly call: ToolCallEvent;
  readonly events: readonly AgentEvent[];
  readonly responseForModel: Record<string, unknown> | { readonly error: string };
}

export interface ToolExecutionDeps {
  readonly registry: Pick<ToolRegistry, 'get' | 'execute'>;
  readonly interrupts: Pick<InterruptService, 'pendingDecision'>;
}

export async function settleSingleCall(
  call: ToolCallEvent,
  turnId: string,
  signal: AbortSignal,
  deps: ToolExecutionDeps,
): Promise<SettledToolCall> {
  // Bail before doing any work if the batch was already cancelled (e.g. a
  // sibling rejected, or the user pressed Stop) so we don't kick off a new
  // interrupt prompt or side-effecting execution after abort (H1).
  if (signal.aborted) throw new DOMException('Aborted', 'AbortError');

  const events: AgentEvent[] = [];

  // L1: the model emitted a functionCall with no name (see the operator). It
  // can't resolve to any tool, so short-circuit with a synthetic error instead
  // of asking the registry to look up an empty name (which would reject with a
  // noisy "Unknown tool" and still needs a paired functionResponse anyway).
  if (!call.name) {
    const responseForModel = {
      error: 'The model emitted a tool call without a name; it was skipped.',
    } as const;
    events.push({
      type: 'tool_result',
      ts: Date.now(),
      turnId,
      callId: call.callId,
      result: responseForModel,
    });
    return { call, events, responseForModel };
  }

  const meta: ToolMeta | undefined = deps.registry.get(call.name);

  let decision: InterruptDecision = { kind: 'approve' };
  if (meta?.interruptive) {
    decision = await deps.interrupts.pendingDecision(call.callId, signal);
    events.push({
      type: 'interrupt_resolved',
      ts: Date.now(),
      turnId,
      callId: call.callId,
      decision: decision.kind,
      note: decision.kind === 'select' ? undefined : decision.note,
      selection: decision.kind === 'select' ? decision.selection : undefined,
    });
  }

  if (decision.kind === 'reject') {
    const reason = decision.note?.trim() || 'Cancelled by user.';
    const responseForModel = { rejected: true, reason } as const;
    events.push({
      type: 'tool_result',
      ts: Date.now(),
      turnId,
      callId: call.callId,
      result: responseForModel as unknown as Record<string, unknown>,
    });
    return { call, events, responseForModel };
  }

  if (decision.kind === 'select') {
    const responseForModel = { selected: decision.selection } as const;
    events.push({
      type: 'tool_result',
      ts: Date.now(),
      turnId,
      callId: call.callId,
      result: responseForModel as unknown as Record<string, unknown>,
    });
    return { call, events, responseForModel };
  }

  try {
    const ctx: ToolExecutionContext = { callId: call.callId, signal };
    const result = await deps.registry.execute(call.name, call.args, ctx);
    events.push({
      type: 'tool_result',
      ts: Date.now(),
      turnId,
      callId: call.callId,
      result,
    });
    return { call, events, responseForModel: result };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const responseForModel = { error: message } as const;
    events.push({
      type: 'tool_result',
      ts: Date.now(),
      turnId,
      callId: call.callId,
      result: responseForModel,
    });
    return { call, events, responseForModel };
  }
}

export async function* settleToolCallsParallel(
  calls: readonly ToolCallEvent[],
  turnId: string,
  signal: AbortSignal,
  deps: ToolExecutionDeps,
): AsyncGenerator<SettledToolCall> {
  // Thread a per-batch controller so that when the parent signal aborts — or one
  // call rejects (e.g. an interrupt decision that aborts) — we can cancel the
  // in-flight siblings instead of leaving them running (H1). A tool that honors
  // its `ctx.signal` will stop; ones that don't at least aren't awaited.
  const batch = new AbortController();
  const onParentAbort = () => batch.abort();
  if (signal.aborted) batch.abort();
  else signal.addEventListener('abort', onParentAbort, { once: true });

  const pending = new Map<string, Promise<SettledToolCall>>();
  for (const call of calls) {
    pending.set(call.callId, settleSingleCall(call, turnId, batch.signal, deps));
  }

  try {
    while (pending.size > 0) {
      const settled = await Promise.race(pending.values());
      pending.delete(settled.call.callId);
      yield settled;
    }
  } catch (err) {
    batch.abort();
    // Let the cancelled siblings unwind before propagating so their teardown
    // doesn't surface as an unhandled rejection after we've thrown.
    await Promise.allSettled(pending.values());
    throw err;
  } finally {
    signal.removeEventListener('abort', onParentAbort);
  }
}
