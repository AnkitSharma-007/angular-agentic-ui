import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import {
  type AppNotification,
  type NotificationKind,
  NotificationService,
} from './notification.service';

const ICON_BY_KIND: Record<NotificationKind, string> = {
  info: 'info',
  success: 'check_circle',
  warn: 'warning',
  error: 'error',
};

// Renders the live toast stack. Kept dead-simple (no logic that can throw) since
// it can surface errors raised by the global handler — a throwing toast would
// loop the error pipeline.
@Component({
  selector: 'app-notification-host',
  imports: [MatButtonModule, MatIconModule],
  templateUrl: './notification-host.html',
  styleUrl: './notification-host.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NotificationHostComponent {
  protected readonly notifications = inject(NotificationService);

  protected iconFor(kind: NotificationKind): string {
    return ICON_BY_KIND[kind];
  }

  protected runAction(item: AppNotification): void {
    item.action?.handler();
    this.notifications.dismiss(item.id);
  }
}
