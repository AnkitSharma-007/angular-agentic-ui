import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ConsoleLogSink,
  type LogEntry,
  NoopLogSink,
  RING_BUFFER_CAPACITY,
  RingBufferLogSink,
} from './log-sink';

function entry(partial: Partial<LogEntry> = {}): LogEntry {
  return { ts: Date.now(), level: 'info', message: 'msg', ...partial };
}

describe('NoopLogSink', () => {
  it('discards without throwing', () => {
    expect(() => new NoopLogSink().write(entry())).not.toThrow();
  });
});

describe('RingBufferLogSink', () => {
  it('retains entries up to capacity, dropping the oldest', () => {
    const sink = new RingBufferLogSink();
    for (let i = 0; i < RING_BUFFER_CAPACITY + 10; i++) {
      sink.write(entry({ message: `m${i}` }));
    }
    const snap = sink.snapshot();
    expect(snap.length).toBe(RING_BUFFER_CAPACITY);
    expect(snap[0].message).toBe('m10');
    expect(snap.at(-1)?.message).toBe(`m${RING_BUFFER_CAPACITY + 9}`);
  });

  it('snapshot() returns a defensive copy', () => {
    const sink = new RingBufferLogSink();
    sink.write(entry());
    const snap = sink.snapshot();
    sink.write(entry());
    expect(snap.length).toBe(1);
  });

  it('clear() empties the buffer', () => {
    const sink = new RingBufferLogSink();
    sink.write(entry());
    sink.clear();
    expect(sink.snapshot()).toEqual([]);
  });
});

describe('ConsoleLogSink', () => {
  afterEach(() => vi.restoreAllMocks());

  it('routes each level to the matching console method', () => {
    const sink = new ConsoleLogSink();
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    sink.write(entry({ level: 'error', message: 'nope' }));
    sink.write(entry({ level: 'warn', message: 'careful' }));

    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });
});
