import { Component } from '@angular/core';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';

import { APP_CONFIG } from '../../core/app-config';
import { PageHeaderComponent } from '../../shared/page-header/page-header';

@Component({
  selector: 'app-security',
  imports: [MatCardModule, MatIconModule, PageHeaderComponent],
  templateUrl: './security.html',
  styleUrl: './security.scss',
})
export class SecurityComponent {
  protected readonly config = APP_CONFIG;
}
