import { Service, inject } from '@angular/core';
import { Dialog, type DialogConfig, type DialogRef } from '@angular/cdk/dialog';
import type { ComponentType } from '@angular/cdk/portal';
import { ErrorDialogComponent, type ErrorDialogData } from '../../shared/error-dialog/error-dialog';

export interface ConfirmOptions {
  readonly title?: string;
  readonly message: string;
  readonly confirmLabel?: string;
  readonly cancelLabel?: string;
  readonly tone?: ErrorDialogData['tone'];
}

// Thin wrapper over CDK's `Dialog` that applies app-wide defaults (backdrop,
// focus behavior, themed panel) so callers don't repeat config. CDK Dialog is
// used over MatDialog to stay light; the overlay structural styles are already
// present (the app uses CDK overlays elsewhere).
@Service()
export class DialogService {
  private readonly dialog = inject(Dialog);

  open<R = unknown>(
    component: ComponentType<unknown>,
    config?: DialogConfig<unknown, DialogRef<R>>,
  ): DialogRef<R> {
    const merged: DialogConfig<unknown, DialogRef<R>> = {
      hasBackdrop: true,
      backdropClass: ['cdk-overlay-dark-backdrop', 'atlas-dialog-backdrop'],
      panelClass: 'atlas-dialog-panel',
      autoFocus: 'first-tabbable',
      restoreFocus: true,
      ...config,
    };
    return this.dialog.open<R>(component, merged);
  }

  // Show a detailed, dismissible error dialog.
  error(data: ErrorDialogData): DialogRef<boolean> {
    return this.open<boolean>(ErrorDialogComponent, {
      data: { tone: 'error', ...data } satisfies ErrorDialogData,
    });
  }

  // Ask the user to confirm an action; resolves true only on explicit confirm.
  confirm(options: ConfirmOptions): Promise<boolean> {
    const ref = this.open<boolean>(ErrorDialogComponent, {
      data: {
        tone: 'question',
        confirmLabel: 'Confirm',
        cancelLabel: 'Cancel',
        ...options,
      } satisfies ErrorDialogData,
    });
    return new Promise((resolve) => {
      ref.closed.subscribe((result) => resolve(result === true));
    });
  }
}
