import {
  Component,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { InterruptService } from '../../../core/registry/interrupt.service';
import type { BookFlightArgs, BookFlightResult } from './booking-confirmation-card.types';

@Component({
  selector: 'app-booking-confirmation-card',
  imports: [
    FormsModule,
    MatButtonModule,
    MatCardModule,
    MatFormFieldModule,
    MatInputModule,
    MatProgressBarModule,
  ],
  templateUrl: './booking-confirmation-card.html',
  styleUrl: './booking-confirmation-card.scss',
})
export class BookingConfirmationCardComponent {
  private readonly interrupts = inject(InterruptService);

  readonly callId = input.required<string>();
  readonly args = input.required<BookFlightArgs>();
  readonly result = input<BookFlightResult | null>(null);
  readonly status = input.required<
    'pending_approval' | 'running' | 'complete' | 'error' | 'rejected'
  >();
  readonly errorMessage = input<string | null>(null);
  readonly interruptReason = input<string | null>(null);

  protected readonly isPending = computed(() => this.status() === 'pending_approval');
  protected readonly isRunning = computed(() => this.status() === 'running');
  protected readonly isComplete = computed(() => this.status() === 'complete');
  protected readonly isRejected = computed(() => this.status() === 'rejected');
  protected readonly isError = computed(() => this.status() === 'error');

  protected readonly showRejectNote = signal(false);
  protected readonly rejectionNote = signal('');

  protected approve(): void {
    this.interrupts.decide(this.callId(), { kind: 'approve' });
  }

  protected toggleRejectNote(): void {
    this.showRejectNote.update((v) => !v);
  }

  protected confirmReject(): void {
    const note = this.rejectionNote().trim();
    this.interrupts.decide(this.callId(), { kind: 'reject', note: note || undefined });
  }

  protected formatPrice(amount: number, currency: string): string {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency,
      maximumFractionDigits: 0,
    }).format(amount);
  }
}
