import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';

export type ErrorDialogTone = 'error' | 'warn' | 'question';

export interface ErrorDialogData {
  readonly title?: string;
  readonly message: string;
  // Optional, already-redacted technical detail shown in a collapsible block.
  readonly details?: string;
  readonly confirmLabel?: string;
  // When present, a secondary/cancel button is shown and the dialog behaves as
  // a confirm (resolves false on cancel/backdrop, true on confirm).
  readonly cancelLabel?: string;
  readonly tone?: ErrorDialogTone;
}

const ICON_BY_TONE: Record<ErrorDialogTone, string> = {
  error: 'error',
  warn: 'warning',
  question: 'help',
};

// A themed CDK dialog used for detailed error surfaces and confirmations. CDK
// Dialog provides the focus trap, restore-focus, and Escape handling; the M3
// tokens keep it consistent with the rest of the app.
@Component({
  selector: 'app-error-dialog',
  imports: [MatButtonModule, MatIconModule],
  templateUrl: './error-dialog.html',
  styleUrl: './error-dialog.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ErrorDialogComponent {
  protected readonly data = inject<ErrorDialogData>(DIALOG_DATA);
  private readonly ref = inject<DialogRef<boolean>>(DialogRef);

  protected readonly tone: ErrorDialogTone = this.data.tone ?? 'error';

  protected icon(): string {
    return ICON_BY_TONE[this.tone];
  }

  protected confirm(): void {
    this.ref.close(true);
  }

  protected cancel(): void {
    this.ref.close(false);
  }
}
