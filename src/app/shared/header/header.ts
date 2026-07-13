import { Component, inject } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';

import { ThemeService, ThemePreference } from '../../core/services/theme.service';
import { ApiKeyService } from '../../core/services/api-key.service';
import { ObservabilityDrawerService } from '../../core/observability/observability-drawer.service';
import { APP_CONFIG } from '../../core/app-config';

interface ThemeOption {
  readonly id: ThemePreference;
  readonly label: string;
  readonly icon: string;
}

interface NavLink {
  readonly path: string;
  readonly label: string;
  readonly icon: string;
  readonly exact?: boolean;
}

@Component({
  selector: 'app-header',
  imports: [
    RouterLink,
    RouterLinkActive,
    MatToolbarModule,
    MatButtonModule,
    MatIconModule,
    MatMenuModule,
  ],
  templateUrl: './header.html',
  styleUrl: './header.scss',
})
export class HeaderComponent {
  protected readonly theme = inject(ThemeService);
  protected readonly apiKey = inject(ApiKeyService);
  private readonly observabilityDrawer = inject(ObservabilityDrawerService);
  protected readonly config = APP_CONFIG;

  protected readonly themeOptions: readonly ThemeOption[] = [
    { id: 'system', label: 'System', icon: 'contrast' },
    { id: 'light', label: 'Light', icon: 'light_mode' },
    { id: 'dark', label: 'Dark', icon: 'dark_mode' },
  ];

  protected readonly navLinks: readonly NavLink[] = [
    { path: '/', label: 'Chat', icon: 'chat', exact: true },
    { path: '/library', label: 'Library', icon: 'video_library' },
    { path: '/tools', label: 'Tools', icon: 'handyman' },
    { path: '/guide', label: 'Guide', icon: 'explore' },
    { path: '/about', label: 'About', icon: 'info' },
    { path: '/security', label: 'Security', icon: 'shield_with_heart' },
  ];

  protected setTheme(preference: ThemePreference): void {
    this.theme.set(preference);
  }

  protected currentThemeIcon(): string {
    const pref = this.theme.preference();
    return this.themeOptions.find((o) => o.id === pref)?.icon ?? 'contrast';
  }

  protected openObservability(): void {
    this.observabilityDrawer.open();
  }
}
