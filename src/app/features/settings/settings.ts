import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
} from '@angular/core';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatSelectModule } from '@angular/material/select';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatIconModule } from '@angular/material/icon';
import { FormsModule } from '@angular/forms';
import { MatDividerModule } from '@angular/material/divider';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';

import { ApiKeyService } from '../../core/services/api-key.service';
import { GeminiService, GEMINI_MODELS, GeminiModelId } from '../../core/services/gemini.service';
import { MAX_TOOL_SYNTHESIS_PER_TURN } from '../../core/services/agent-loop';
import { ThemeService, type ThemePreference } from '../../core/services/theme.service';
import { BudgetService } from '../../core/observability/budget.service';
import { ToolSynthesisSettings } from '../../core/settings/tool-synthesis.settings';
import { PageHeaderComponent } from '../../shared/page-header/page-header';

interface ThemeOption {
  readonly value: ThemePreference;
  readonly label: string;
  readonly icon: string;
}

const THEME_OPTIONS: readonly ThemeOption[] = [
  { value: 'system', label: 'System', icon: 'routine' },
  { value: 'light', label: 'Light', icon: 'light_mode' },
  { value: 'dark', label: 'Dark', icon: 'dark_mode' },
];

@Component({
  selector: 'app-settings',
  imports: [
    FormsModule,
    MatCardModule,
    MatButtonModule,
    MatSelectModule,
    MatFormFieldModule,
    MatInputModule,
    MatIconModule,
    MatDividerModule,
    MatSlideToggleModule,
    PageHeaderComponent,
  ],
  templateUrl: './settings.html',
  styleUrl: './settings.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SettingsComponent {
  protected readonly apiKey = inject(ApiKeyService);
  protected readonly gemini = inject(GeminiService);
  protected readonly theme = inject(ThemeService);
  protected readonly budget = inject(BudgetService);
  protected readonly toolSynthesis = inject(ToolSynthesisSettings);
  protected readonly maxToolSynthesisPerTurn = MAX_TOOL_SYNTHESIS_PER_TURN;
  protected readonly models = GEMINI_MODELS;
  protected readonly themeOptions = THEME_OPTIONS;

  protected readonly selectedModelMeta = computed(() =>
    this.models.find((m) => m.id === this.gemini.selectedModel()),
  );

  // Human-readable label for the key-storage tier instead of the raw enum
  // (`encrypted-local` / `session`).
  protected readonly storageLabel = computed(() => {
    if (this.apiKey.storage() === 'encrypted-local' || this.apiKey.hasLockedBlob()) {
      return 'Encrypted on this device';
    }
    return this.apiKey.hasKey() ? 'This session only' : 'Not configured';
  });

  protected readonly maxTokensInput = signal<string>(
    this.budget.config().maxTokens?.toString() ?? '',
  );
  protected readonly maxRoundsInput = signal<string>(
    this.budget.config().maxRounds?.toString() ?? '',
  );
  protected readonly maxCostInput = signal<string>(
    this.budget.config().maxCostUsd?.toString() ?? '',
  );

  protected readonly budgetSaveStatus = signal<'idle' | 'saved'>('idle');

  // Tracked so the timer is cancelled on destroy and coalesced across saves.
  private saveStatusTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    inject(DestroyRef).onDestroy(() => this.clearSaveStatusTimer());
  }

  protected selectModel(id: GeminiModelId): void {
    this.gemini.selectModel(id);
  }

  protected setToolSynthesis(enabled: boolean): void {
    this.toolSynthesis.setEnabled(enabled);
  }

  protected clearKey(): void {
    const confirmed = confirm(
      'Clear the API key from this device? You will need to re-enter it.',
    );
    if (confirmed) void this.apiKey.clear();
  }

  protected saveBudget(): void {
    const max = (raw: string): number | null => {
      const v = parseFloat(raw);
      return Number.isFinite(v) && v > 0 ? v : null;
    };
    this.budget.update({
      maxTokens: max(this.maxTokensInput()),
      maxRounds: max(this.maxRoundsInput()),
      maxCostUsd: max(this.maxCostInput()),
    });
    this.flashSaved();
  }

  protected resetBudget(): void {
    this.budget.reset();
    this.maxTokensInput.set('');
    this.maxRoundsInput.set('');
    this.maxCostInput.set('');
    this.flashSaved();
  }

  private flashSaved(): void {
    this.clearSaveStatusTimer();
    this.budgetSaveStatus.set('saved');
    this.saveStatusTimer = setTimeout(() => {
      this.budgetSaveStatus.set('idle');
      this.saveStatusTimer = null;
    }, 1800);
  }

  private clearSaveStatusTimer(): void {
    if (this.saveStatusTimer !== null) {
      clearTimeout(this.saveStatusTimer);
      this.saveStatusTimer = null;
    }
  }

  protected applyPreset(preset: 'demo' | 'tight' | 'generous'): void {
    switch (preset) {
      case 'demo':
        this.maxTokensInput.set('40000');
        this.maxRoundsInput.set('6');
        this.maxCostInput.set('0.10');
        break;
      case 'tight':
        this.maxTokensInput.set('10000');
        this.maxRoundsInput.set('3');
        this.maxCostInput.set('0.02');
        break;
      case 'generous':
        this.maxTokensInput.set('200000');
        this.maxRoundsInput.set('8');
        this.maxCostInput.set('1.00');
        break;
    }
    this.saveBudget();
  }
}
