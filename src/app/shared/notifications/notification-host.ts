import { Component, inject } from '@angular/core';
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

// Dead-simple toast host — must not throw when surfacing global-handler errors.
@Component({
  selector: 'app-notification-host',
  imports: [MatButtonModule, MatIconModule],
  templateUrl: './notification-host.html',
  styleUrl: './notification-host.scss',
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
