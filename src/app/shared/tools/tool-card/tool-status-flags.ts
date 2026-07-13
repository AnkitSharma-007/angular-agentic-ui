import { computed, type Signal } from '@angular/core';
import type { ToolCallStatus } from '../../../core/streaming/agent-event.store';

export interface ToolStatusFlags {
  readonly isPending: Signal<boolean>;
  readonly isRunning: Signal<boolean>;
  readonly isComplete: Signal<boolean>;
  readonly isError: Signal<boolean>;
  readonly isRejected: Signal<boolean>;
}

export function toolStatusFlags(status: Signal<ToolCallStatus>): ToolStatusFlags {
  return {
    isPending: computed(() => status() === 'pending_approval'),
    isRunning: computed(() => status() === 'running'),
    isComplete: computed(() => status() === 'complete'),
    isError: computed(() => status() === 'error'),
    isRejected: computed(() => status() === 'rejected'),
  };
}
