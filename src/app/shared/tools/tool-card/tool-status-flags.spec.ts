import { signal } from '@angular/core';
import type { ToolCallStatus } from '../../../core/streaming/agent-event.store';
import { toolStatusFlags } from './tool-status-flags';

describe('toolStatusFlags', () => {
  it('reflects each status as exactly one active flag', () => {
    const status = signal<ToolCallStatus>('pending_approval');
    const flags = toolStatusFlags(status);

    const cases: readonly [ToolCallStatus, keyof typeof flags][] = [
      ['pending_approval', 'isPending'],
      ['running', 'isRunning'],
      ['complete', 'isComplete'],
      ['error', 'isError'],
      ['rejected', 'isRejected'],
    ];

    for (const [value, active] of cases) {
      status.set(value);
      for (const key of Object.keys(flags) as (keyof typeof flags)[]) {
        expect(flags[key]()).toBe(key === active);
      }
    }
  });

  it('tracks status changes reactively', () => {
    const status = signal<ToolCallStatus>('running');
    const flags = toolStatusFlags(status);

    expect(flags.isRunning()).toBe(true);
    status.set('complete');
    expect(flags.isRunning()).toBe(false);
    expect(flags.isComplete()).toBe(true);
  });
});
