import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { AgentEventStore } from './agent-event.store';
import type { AgentEvent } from './agent-event';

describe('AgentEventStore', () => {
  let store: AgentEventStore;

  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({});
    store = TestBed.inject(AgentEventStore);
  });

  it('starts idle with empty histories', () => {
    expect(store.phase()).toBe('idle');
    expect(store.events()).toEqual([]);
    expect(store.rawHistory()).toEqual([]);
    expect(store.currentTurn().id).toBe('');
    expect(store.hasOutput()).toBe(false);
  });

  it('beginTurn() moves to streaming phase and resets counters', () => {
    store.beginTurn('t1');
    expect(store.phase()).toBe('streaming');
    expect(store.currentTurn().id).toBe('t1');
    expect(store.stats()).toEqual({ chunks: 0, parts: 0, signedParts: 0 });
    expect(store.isStreaming()).toBe(true);
  });

  it('pushEvent(text_delta) appends to responseText', () => {
    store.beginTurn('t1');
    pushTextDelta(store, 't1', 'Hello, ');
    pushTextDelta(store, 't1', 'world.');
    expect(store.responseText()).toBe('Hello, world.');
  });

  it('pushEvent(thought_delta) appends to thoughtText', () => {
    store.beginTurn('t1');
    pushThoughtDelta(store, 't1', 'thinking…');
    expect(store.thoughtText()).toBe('thinking…');
  });

  it('pushEvent(tool_call) creates a running tool-call entry', () => {
    store.beginTurn('t1');
    store.pushEvent({
      type: 'tool_call',
      ts: 1,
      turnId: 't1',
      callId: 'call-1',
      name: 'searchFlights',
      args: { from: 'BLR', to: 'GOA' },
    });
    expect(store.toolCalls()).toHaveLength(1);
    const call = store.toolCalls()[0];
    expect(call.status).toBe('running');
    expect(call.name).toBe('searchFlights');
  });

  it('pushEvent(tool_result) completes the matching tool call', () => {
    store.beginTurn('t1');
    store.pushEvent({
      type: 'tool_call',
      ts: 1,
      turnId: 't1',
      callId: 'c1',
      name: 'searchFlights',
      args: {},
    });
    store.pushEvent({
      type: 'tool_result',
      ts: 2,
      turnId: 't1',
      callId: 'c1',
      result: { flights: ['a'] },
    });
    const call = store.toolCalls()[0];
    expect(call.status).toBe('complete');
    expect(call.result).toEqual({ flights: ['a'] });
  });

  it('pushEvent(tool_result) maps { error } payload to status=error', () => {
    store.beginTurn('t1');
    store.pushEvent({
      type: 'tool_call',
      ts: 1,
      turnId: 't1',
      callId: 'c1',
      name: 'tool',
      args: {},
    });
    store.pushEvent({
      type: 'tool_result',
      ts: 2,
      turnId: 't1',
      callId: 'c1',
      result: { error: 'network down' },
    });
    const call = store.toolCalls()[0];
    expect(call.status).toBe('error');
    expect(call.errorMessage).toBe('network down');
  });

  it('pushEvent(tool_result) does NOT flag success payloads that happen to carry a string `error` field', () => {
    store.beginTurn('t1');
    store.pushEvent({
      type: 'tool_call',
      ts: 1,
      turnId: 't1',
      callId: 'c1',
      name: 'customTool',
      args: {},
    });
    // A custom-tool response that legitimately includes an `error` field as
    // status metadata (e.g. "no error occurred") must NOT be misrendered as
    // a failure. Only the canonical single-key { error: msg } envelope is.
    store.pushEvent({
      type: 'tool_result',
      ts: 2,
      turnId: 't1',
      callId: 'c1',
      result: { status: 'ok', error: 'none', data: [1, 2] },
    });
    const call = store.toolCalls()[0];
    expect(call.status).toBe('complete');
    expect(call.errorMessage).toBeNull();
    expect(call.result).toEqual({ status: 'ok', error: 'none', data: [1, 2] });
  });

  it('pushEvent(tool_result) treats { error: "" } as success (empty error string is not a failure)', () => {
    store.beginTurn('t1');
    store.pushEvent({
      type: 'tool_call',
      ts: 1,
      turnId: 't1',
      callId: 'c1',
      name: 'tool',
      args: {},
    });
    store.pushEvent({
      type: 'tool_result',
      ts: 2,
      turnId: 't1',
      callId: 'c1',
      result: { error: '' },
    });
    const call = store.toolCalls()[0];
    expect(call.status).toBe('complete');
    expect(call.errorMessage).toBeNull();
  });

  it('pushEvent(interrupt_request → resolved reject) marks the call as rejected', () => {
    store.beginTurn('t1');
    store.pushEvent({
      type: 'tool_call',
      ts: 1,
      turnId: 't1',
      callId: 'c1',
      name: 'bookFlight',
      args: {},
    });
    store.pushEvent({
      type: 'interrupt_request',
      ts: 2,
      turnId: 't1',
      callId: 'c1',
      reason: 'Approve?',
    });
    expect(store.toolCalls()[0].status).toBe('pending_approval');

    store.pushEvent({
      type: 'interrupt_resolved',
      ts: 3,
      turnId: 't1',
      callId: 'c1',
      decision: 'reject',
      note: 'too expensive',
    });
    expect(store.toolCalls()[0].status).toBe('rejected');
    expect(store.toolCalls()[0].interruptReason).toBe('too expensive');
  });

  it('interrupt_resolved reject without a note leaves interruptReason null', () => {
    store.beginTurn('t1');
    store.pushEvent({
      type: 'tool_call',
      ts: 1,
      turnId: 't1',
      callId: 'c1',
      name: 'bookFlight',
      args: {},
    });
    store.pushEvent({
      type: 'interrupt_resolved',
      ts: 2,
      turnId: 't1',
      callId: 'c1',
      decision: 'reject',
    });
    const call = store.toolCalls()[0];
    expect(call.status).toBe('rejected');
    expect(call.interruptReason).toBeNull();
  });

  it('interrupt_resolved reject treats a whitespace-only note as no note', () => {
    store.beginTurn('t1');
    store.pushEvent({
      type: 'tool_call',
      ts: 1,
      turnId: 't1',
      callId: 'c1',
      name: 'bookFlight',
      args: {},
    });
    store.pushEvent({
      type: 'interrupt_resolved',
      ts: 2,
      turnId: 't1',
      callId: 'c1',
      decision: 'reject',
      note: '   ',
    });
    expect(store.toolCalls()[0].interruptReason).toBeNull();
  });

  it('turn_complete event flips phase to complete and stores the finishReason', () => {
    store.beginTurn('t1');
    store.pushEvent({
      type: 'turn_complete',
      ts: 1,
      turnId: 't1',
      rounds: 2,
      finishReason: 'STOP',
    });
    expect(store.phase()).toBe('complete');
    expect(store.currentTurn().finishReason).toBe('STOP');
  });

  it('appendUserPrompt + appendToolResponses produce a coherent Content[] sequence', () => {
    store.appendUserPrompt('Find flights');
    store.appendToolResponses([
      { name: 'searchFlights', response: { ok: true } },
    ]);
    const history = store.rawHistory();
    expect(history[0].role).toBe('user');
    expect(history[1].role).toBe('tool');
    expect((history[1].parts[0] as { functionResponse?: { name?: string } }).functionResponse?.name)
      .toBe('searchFlights');
  });

  it('appendUserTurn writes a text part followed by inlineData parts', () => {
    store.appendUserTurn({
      text: 'What is this place?',
      attachments: [
        {
          id: 'a1',
          kind: 'image',
          mimeType: 'image/jpeg',
          dataBase64: 'QUJD',
          sizeBytes: 3,
        },
      ],
    });
    const [entry] = store.rawHistory();
    expect(entry.role).toBe('user');
    expect((entry.parts[0] as { text?: string }).text).toBe('What is this place?');
    expect((entry.parts[1] as { inlineData?: { mimeType?: string; data?: string } }).inlineData)
      .toEqual({ mimeType: 'image/jpeg', data: 'QUJD' });
  });

  it('appendUserTurn with attachments only still yields a valid user part', () => {
    store.appendUserTurn({
      text: '',
      attachments: [
        { id: 'a1', kind: 'image', mimeType: 'image/png', dataBase64: 'AAAA', sizeBytes: 3 },
      ],
    });
    const [entry] = store.rawHistory();
    expect(entry.parts).toHaveLength(1);
    expect((entry.parts[0] as { inlineData?: unknown }).inlineData).toBeDefined();
  });

  it('currentUserTurn derives text + attachment previews from the latest user turn', () => {
    store.appendUserPrompt('an earlier turn');
    store.appendUserTurn({
      text: 'Plan around this',
      attachments: [
        { id: 'a1', kind: 'image', mimeType: 'image/jpeg', dataBase64: 'QUJD', sizeBytes: 3 },
      ],
    });
    const view = store.currentUserTurn();
    expect(view.text).toBe('Plan around this');
    expect(view.attachments).toEqual([
      { kind: 'image', mimeType: 'image/jpeg', dataUrl: 'data:image/jpeg;base64,QUJD' },
    ]);
  });

  it('bumpStats accumulates chunk/part/signedPart counts', () => {
    store.beginTurn('t1');
    store.bumpStats({ chunks: 1, parts: 2, signedParts: 1 });
    store.bumpStats({ chunks: 1, parts: 3 });
    expect(store.stats()).toEqual({ chunks: 2, parts: 5, signedParts: 1 });
  });

  it('markCancelled / markError move to the terminal phases', () => {
    store.beginTurn('t1');
    store.markError('boom');
    expect(store.phase()).toBe('error');
    expect(store.error()).toBe('boom');

    store.markCancelled();
    expect(store.phase()).toBe('cancelled');
  });

  it('beginTurn() prunes the previous turn\u2019s UI events but preserves rawHistory (H5)', () => {
    store.beginTurn('t1');
    store.appendUserPrompt('Turn one');
    pushTextDelta(store, 't1', 'first answer');
    store.pushEvent({ type: 'turn_complete', ts: 1, turnId: 't1', rounds: 1, finishReason: 'STOP' });
    expect(store.events().length).toBeGreaterThan(0);

    store.beginTurn('t2');

    // UI events reset for the new turn…
    expect(store.events()).toEqual([]);
    // …but the multi-turn model context (rawHistory) is retained.
    expect(store.rawHistory().length).toBeGreaterThan(0);
  });

  it('events() returns an independent snapshot (later pushes do not mutate it)', () => {
    store.beginTurn('t1');
    pushTextDelta(store, 't1', 'first');
    const snapshot = store.events();
    expect(snapshot).toHaveLength(1);

    // A subsequent streamed delta must not retroactively grow an earlier
    // snapshot — save() relies on reading a stable, point-in-time event list.
    pushTextDelta(store, 't1', 'second');
    expect(snapshot).toHaveLength(1);
    expect(store.events()).toHaveLength(2);
  });

  it('reset() returns the store to its initial state', () => {
    store.beginTurn('t1');
    pushTextDelta(store, 't1', 'hi');
    store.reset();
    expect(store.phase()).toBe('idle');
    expect(store.events()).toEqual([]);
    expect(store.responseText()).toBe('');
  });
});

function pushTextDelta(store: AgentEventStore, turnId: string, chunk: string): void {
  const ev: AgentEvent = { type: 'text_delta', ts: 0, turnId, chunk };
  store.pushEvent(ev);
}

function pushThoughtDelta(store: AgentEventStore, turnId: string, chunk: string): void {
  const ev: AgentEvent = { type: 'thought_delta', ts: 0, turnId, chunk };
  store.pushEvent(ev);
}
