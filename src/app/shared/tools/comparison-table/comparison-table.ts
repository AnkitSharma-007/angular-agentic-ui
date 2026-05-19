import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { InterruptService } from '../../../core/registry/interrupt.service';
import type {
  ComparisonOption,
  LetUserChooseArgs,
  LetUserChooseResult,
} from './comparison-table.types';

@Component({
  selector: 'app-comparison-table',
  imports: [MatButtonModule, MatCardModule],
  templateUrl: './comparison-table.html',
  styleUrl: './comparison-table.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ComparisonTableComponent {
  private readonly interrupts = inject(InterruptService);

  readonly callId = input.required<string>();
  readonly args = input.required<LetUserChooseArgs>();
  readonly result = input<LetUserChooseResult | null>(null);
  readonly status = input.required<
    'pending_approval' | 'running' | 'complete' | 'error' | 'rejected'
  >();
  readonly errorMessage = input<string | null>(null);
  readonly interruptReason = input<string | null>(null);

  protected readonly isPending = computed(() => this.status() === 'pending_approval');
  protected readonly isSettled = computed(() => {
    const s = this.status();
    return s === 'running' || s === 'complete';
  });
  protected readonly isError = computed(() => this.status() === 'error');
  protected readonly isRejected = computed(() => this.status() === 'rejected');

  protected readonly chosenId = computed(() => this.result()?.selected?.id ?? null);

  protected choose(option: ComparisonOption): void {
    this.interrupts.decide(this.callId(), {
      kind: 'select',
      selection: option as unknown as Record<string, unknown>,
    });
  }
}
