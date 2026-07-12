import { describe, expect, it, vi } from 'vitest';
import type { ToolCallEvent } from '../streaming/agent-event';
import type { InterruptDecision } from './interrupt.service';
import { settleSingleCall, settleToolCallsParallel } from './tool-execution';
import type { ToolExecutionDeps } from './tool-execution';
import type { ToolMeta } from './tool-descriptor';

function call(partial: Partial<ToolCallEvent> = {}): ToolCallEvent {
  return {
    type: 'tool_call',
    ts: 1000,
    turnId: 't1',
    callId: partial.callId ?? 'c1',
    name: partial.name ?? 'searchFlights',
    args: partial.args ?? { from: 'Bengaluru', to: 'Goa' },
  };
}

function makeDeps(opts: {
  meta?: ToolMeta | undefined;
  execute?: (
    name: string,
    args: unknown,
    ctx: { callId: string; signal: AbortSignal },
  ) => Promise<Record<string, unknown>>;
  pendingDecision?: (callId: string, signal: AbortSignal) => Promise<InterruptDecision>;
}): ToolExecutionDeps {
  return {
    registry: {
      get: vi.fn(() => opts.meta),
      execute:
        opts.execute ??
        vi.fn(async () => ({ ok: true })),
    } as unknown as ToolExecutionDeps['registry'],
    interrupts: {
      pendingDecision:
        opts.pendingDecision ??
        vi.fn(async () => ({ kind: 'approve' as const })),
    } as unknown as ToolExecutionDeps['interrupts'],
  };
}

const NON_INTERRUPTIVE: ToolMeta = {
  name: 'searchFlights',
  description: 'stub',
  declaration: { name: 'searchFlights' } as ToolMeta['declaration'],
  interruptive: false,
};

const INTERRUPTIVE: ToolMeta = {
  name: 'bookFlight',
  description: 'stub',
  declaration: { name: 'bookFlight' } as ToolMeta['declaration'],
  interruptive: true,
  interruptReason: 'Confirm before booking.',
};

describe('settleSingleCall — non-interruptive tool', () => {
  it('runs the executor and emits a single tool_result on success', async () => {
    const execute = vi.fn(async () => ({ flights: ['IndiGo 6E-101'] }));
    const deps = makeDeps({ meta: NON_INTERRUPTIVE, execute });

    const settled = await settleSingleCall(
      call(),
      't1',
      new AbortController().signal,
      deps,
    );

    expect(execute).toHaveBeenCalledOnce();
    expect(execute).toHaveBeenCalledWith(
      'searchFlights',
      { from: 'Bengaluru', to: 'Goa' },
      expect.objectContaining({ callId: 'c1' }),
    );
    expect(settled.events).toHaveLength(1);
    expect(settled.events[0]).toMatchObject({
      type: 'tool_result',
      callId: 'c1',
      result: { flights: ['IndiGo 6E-101'] },
    });
    expect(settled.responseForModel).toEqual({ flights: ['IndiGo 6E-101'] });
  });

  it('does NOT consult interrupts.pendingDecision for non-interruptive tools', async () => {
    const pendingDecision = vi.fn(async () => ({ kind: 'approve' as const }));
    const deps = makeDeps({ meta: NON_INTERRUPTIVE, pendingDecision });

    await settleSingleCall(call(), 't1', new AbortController().signal, deps);

    expect(pendingDecision).not.toHaveBeenCalled();
  });

  it('catches executor errors and returns a { error } payload', async () => {
    const execute = vi.fn(async () => {
      throw new Error('network down');
    });
    const deps = makeDeps({ meta: NON_INTERRUPTIVE, execute });

    const settled = await settleSingleCall(
      call(),
      't1',
      new AbortController().signal,
      deps,
    );

    expect(settled.events).toHaveLength(1);
    expect(settled.events[0]).toMatchObject({
      type: 'tool_result',
      callId: 'c1',
      result: { error: 'network down' },
    });
    expect(settled.responseForModel).toEqual({ error: 'network down' });
  });

  it('stringifies non-Error throws', async () => {
    const execute = vi.fn(async () => {
      throw 'plain string';
    });
    const deps = makeDeps({ meta: NON_INTERRUPTIVE, execute });

    const settled = await settleSingleCall(
      call(),
      't1',
      new AbortController().signal,
      deps,
    );

    expect(settled.responseForModel).toEqual({ error: 'plain string' });
  });
});

describe('settleSingleCall — nameless call (L1)', () => {
  it('short-circuits with a synthetic error without consulting the registry', async () => {
    const get = vi.fn(() => NON_INTERRUPTIVE);
    const execute = vi.fn(async () => ({ ok: true }));
    const deps: ToolExecutionDeps = {
      registry: { get, execute } as unknown as ToolExecutionDeps['registry'],
      interrupts: {
        pendingDecision: vi.fn(async () => ({ kind: 'approve' as const })),
      } as unknown as ToolExecutionDeps['interrupts'],
    };

    const settled = await settleSingleCall(
      call({ callId: 'nameless', name: '' }),
      't1',
      new AbortController().signal,
      deps,
    );

    expect(get).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
    expect(settled.events).toHaveLength(1);
    expect(settled.events[0]).toMatchObject({ type: 'tool_result', callId: 'nameless' });
    expect(settled.responseForModel).toMatchObject({
      error: expect.stringContaining('without a name'),
    });
  });
});

describe('settleSingleCall — interruptive tool, approve branch', () => {
  it('awaits pendingDecision, emits interrupt_resolved, then runs executor', async () => {
    const pendingDecision = vi.fn(
      async (): Promise<InterruptDecision> => ({ kind: 'approve' }),
    );
    const execute = vi.fn(async () => ({ confirmation: 'CONF-42' }));
    const deps = makeDeps({ meta: INTERRUPTIVE, pendingDecision, execute });

    const settled = await settleSingleCall(
      call({ name: 'bookFlight' }),
      't1',
      new AbortController().signal,
      deps,
    );

    expect(pendingDecision).toHaveBeenCalledOnce();
    expect(execute).toHaveBeenCalledOnce();
    expect(settled.events).toHaveLength(2);
    expect(settled.events[0]).toMatchObject({
      type: 'interrupt_resolved',
      decision: 'approve',
    });
    expect(settled.events[1]).toMatchObject({
      type: 'tool_result',
      result: { confirmation: 'CONF-42' },
    });
  });

  it('forwards approve `note` on the interrupt_resolved event', async () => {
    const pendingDecision = vi.fn(
      async (): Promise<InterruptDecision> => ({
        kind: 'approve',
        note: 'go ahead',
      }),
    );
    const deps = makeDeps({ meta: INTERRUPTIVE, pendingDecision });

    const settled = await settleSingleCall(
      call({ name: 'bookFlight' }),
      't1',
      new AbortController().signal,
      deps,
    );

    expect(settled.events[0]).toMatchObject({
      type: 'interrupt_resolved',
      note: 'go ahead',
    });
  });
});

describe('settleSingleCall — interruptive tool, reject branch', () => {
  it('short-circuits the executor and returns { rejected, reason }', async () => {
    const execute = vi.fn();
    const pendingDecision = vi.fn(
      async (): Promise<InterruptDecision> => ({
        kind: 'reject',
        note: 'too expensive',
      }),
    );
    const deps = makeDeps({ meta: INTERRUPTIVE, pendingDecision, execute });

    const settled = await settleSingleCall(
      call({ name: 'bookFlight' }),
      't1',
      new AbortController().signal,
      deps,
    );

    expect(execute).not.toHaveBeenCalled();
    expect(settled.events).toHaveLength(2);
    expect(settled.events[0]).toMatchObject({
      type: 'interrupt_resolved',
      decision: 'reject',
      note: 'too expensive',
    });
    expect(settled.events[1]).toMatchObject({
      type: 'tool_result',
      result: { rejected: true, reason: 'too expensive' },
    });
    expect(settled.responseForModel).toEqual({
      rejected: true,
      reason: 'too expensive',
    });
  });

  it('falls back to "Cancelled by user." when no note is provided', async () => {
    const pendingDecision = vi.fn(
      async (): Promise<InterruptDecision> => ({ kind: 'reject' }),
    );
    const deps = makeDeps({ meta: INTERRUPTIVE, pendingDecision });

    const settled = await settleSingleCall(
      call({ name: 'bookFlight' }),
      't1',
      new AbortController().signal,
      deps,
    );

    expect(settled.responseForModel).toEqual({
      rejected: true,
      reason: 'Cancelled by user.',
    });
  });

  it('treats whitespace-only notes as missing', async () => {
    const pendingDecision = vi.fn(
      async (): Promise<InterruptDecision> => ({
        kind: 'reject',
        note: '   ',
      }),
    );
    const deps = makeDeps({ meta: INTERRUPTIVE, pendingDecision });

    const settled = await settleSingleCall(
      call({ name: 'bookFlight' }),
      't1',
      new AbortController().signal,
      deps,
    );

    expect(settled.responseForModel).toEqual({
      rejected: true,
      reason: 'Cancelled by user.',
    });
  });
});

describe('settleSingleCall — interruptive tool, select branch', () => {
  it('short-circuits the executor and returns { selected: selection }', async () => {
    const execute = vi.fn();
    const selection = {
      id: 'opt-2',
      label: 'IndiGo 6E-101',
      meta: { price: 4200 },
    };
    const pendingDecision = vi.fn(
      async (): Promise<InterruptDecision> => ({ kind: 'select', selection }),
    );
    const deps = makeDeps({ meta: INTERRUPTIVE, pendingDecision, execute });

    const settled = await settleSingleCall(
      call({ name: 'letUserChoose' }),
      't1',
      new AbortController().signal,
      deps,
    );

    expect(execute).not.toHaveBeenCalled();
    expect(settled.events).toHaveLength(2);
    expect(settled.events[0]).toMatchObject({
      type: 'interrupt_resolved',
      decision: 'select',
      selection,
    });
    expect((settled.events[0] as { note?: string }).note).toBeUndefined();
    expect(settled.responseForModel).toEqual({ selected: selection });
  });
});

describe('settleToolCallsParallel', () => {
  it('yields results in completion order, NOT submission order', async () => {
    const order: string[] = [];
    const execute = vi.fn(async (name: string) => {
      order.push(`start:${name}`);
      const delay = name === 'searchFlights' ? 30 : 5;
      await new Promise((r) => setTimeout(r, delay));
      order.push(`end:${name}`);
      return { name };
    });
    const deps = makeDeps({ meta: NON_INTERRUPTIVE, execute });

    const calls: ToolCallEvent[] = [
      call({ callId: 'c1', name: 'searchFlights' }),
      call({ callId: 'c2', name: 'searchHotels' }),
    ];

    const seen: string[] = [];
    for await (const settled of settleToolCallsParallel(
      calls,
      't1',
      new AbortController().signal,
      deps,
    )) {
      seen.push(settled.call.callId);
    }

    expect(seen).toEqual(['c2', 'c1']);
    expect(order.slice(0, 2)).toEqual(['start:searchFlights', 'start:searchHotels']);
  });

  it('settles every call exactly once', async () => {
    const deps = makeDeps({
      meta: NON_INTERRUPTIVE,
      execute: vi.fn(async () => ({ ok: true })),
    });
    const calls: ToolCallEvent[] = [
      call({ callId: 'a' }),
      call({ callId: 'b' }),
      call({ callId: 'c' }),
    ];

    const seen: string[] = [];
    for await (const settled of settleToolCallsParallel(
      calls,
      't1',
      new AbortController().signal,
      deps,
    )) {
      seen.push(settled.call.callId);
    }

    expect(seen.sort()).toEqual(['a', 'b', 'c']);
  });
});

describe('cancellation (H1)', () => {
  it('settleSingleCall throws immediately when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const deps = makeDeps({ meta: NON_INTERRUPTIVE });

    await expect(
      settleSingleCall(call(), 't1', controller.signal, deps),
    ).rejects.toThrow(/Abort/);
  });

  it('passes each call a batch signal that aborts when the parent aborts, cancelling siblings', async () => {
    const controller = new AbortController();
    let captured: AbortSignal | undefined;
    const pendingDecision = vi.fn((_callId: string, signal: AbortSignal) => {
      captured = signal;
      return new Promise<InterruptDecision>((_, reject) => {
        signal.addEventListener(
          'abort',
          () => reject(new DOMException('Aborted', 'AbortError')),
          { once: true },
        );
      });
    });
    const deps = makeDeps({ meta: INTERRUPTIVE, pendingDecision });

    const iterate = (async () => {
      for await (const _s of settleToolCallsParallel(
        [call({ name: 'bookFlight' })],
        't1',
        controller.signal,
        deps,
      )) {
        void _s;
      }
    })();

    await vi.waitFor(() => expect(captured).toBeDefined());
    // The child signal is derived, not the parent itself…
    expect(captured).not.toBe(controller.signal);
    controller.abort();

    await expect(iterate).rejects.toThrow(/Abort/);
    // …and aborting the parent propagates to the batch signal.
    expect(captured?.aborted).toBe(true);
  });
});
