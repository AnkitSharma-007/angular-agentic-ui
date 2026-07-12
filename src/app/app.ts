import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { HeaderComponent } from './shared/header/header';
import { CostMeterComponent } from './shared/cost-meter/cost-meter';
import { ObservabilityDrawerComponent } from './shared/observability-drawer/observability-drawer';
import { NotificationHostComponent } from './shared/notifications/notification-host';
import { AppShellErrorService } from './core/errors/app-shell-error.service';

@Component({
  selector: 'app-root',
  imports: [
    RouterOutlet,
    MatButtonModule,
    MatIconModule,
    HeaderComponent,
    CostMeterComponent,
    ObservabilityDrawerComponent,
    NotificationHostComponent,
  ],
  templateUrl: './app.html',
  styleUrl: './app.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class App {
  protected readonly shellError = inject(AppShellErrorService);

  protected reload(): void {
    location.reload();
  }

  protected dismissError(): void {
    this.shellError.dismiss();
  }
}
