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
import { form, validate, FormField } from '@angular/forms/signals';
import { MatDividerModule } from '@angular/material/divider';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { Listbox, Option } from '@angular/aria/listbox';

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

interface BudgetForm {
  maxTokens: number | null;
  maxRounds: number | null;
  maxCost: number | null;
}

// A budget cap is either "unset" (null → no cap) or a positive number. Zero and
// negative values are meaningless as caps, so they surface an inline error and
// are coerced to null on save.
function coercePositive(value: number | null): number | null {
  return value !== null && Number.isFinite(value) && value > 0 ? value : null;
}

function positiveCapError(value: number | null): { kind: string; message: string } | null {
  if (value === null) return null;
  return Number.isFinite(value) && value > 0
    ? null
    : { kind: 'positiveCap', message: 'Enter a value greater than 0, or leave it empty for no cap.' };
}

const THEME_OPTIONS: readonly ThemeOption[] = [
  { value: 'system', label: 'System', icon: 'routine' },
  { value: 'light', label: 'Light', icon: 'light_mode' },
  { value: 'dark', label: 'Dark', icon: 'dark_mode' },
];

@Component({
  selector: 'app-settings',
  imports: [
    FormField,
    MatCardModule,
    MatButtonModule,
    MatSelectModule,
    MatFormFieldModule,
    MatInputModule,
    MatIconModule,
    MatDividerModule,
    MatSlideToggleModule,
    Listbox,
    Option,
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

  // Angular Aria's Listbox is the v22 single-selection pattern (roving tabindex,
  // arrow-key nav, typeahead — closes M18). It models the selection as an array,
  // so we adapt the ThemeService's single `preference` with a 1-element array.
  protected readonly themeSelection = computed<ThemePreference[]>(() => [
    this.theme.preference(),
  ]);

  protected onThemeChange(values: readonly ThemePreference[]): void {
    const next = values[0];
    if (next && next !== this.theme.preference()) {
      this.theme.set(next);
    }
  }

  // Human-readable label for the key-storage tier instead of the raw enum
  // (`encrypted-local` / `session`).
  protected readonly storageLabel = computed(() => {
    if (this.apiKey.storage() === 'encrypted-local' || this.apiKey.hasLockedBlob()) {
      return 'Encrypted on this device';
    }
    return this.apiKey.hasKey() ? 'This session only' : 'Not configured';
  });

  // Budget caps as a Signal Forms model: number | null (null = no cap). Each
  // field validates as "empty or > 0" so bad values surface inline instead of
  // being silently dropped on save.
  protected readonly budgetModel = signal<BudgetForm>({
    maxTokens: this.budget.config().maxTokens ?? null,
    maxRounds: this.budget.config().maxRounds ?? null,
    maxCost: this.budget.config().maxCostUsd ?? null,
  });

  protected readonly budgetForm = form(this.budgetModel, (p) => {
    validate(p.maxTokens, ({ value }) => positiveCapError(value()));
    validate(p.maxRounds, ({ value }) => positiveCapError(value()));
    validate(p.maxCost, ({ value }) => positiveCapError(value()));
  });

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
    const m = this.budgetModel();
    this.budget.update({
      maxTokens: coercePositive(m.maxTokens),
      maxRounds: coercePositive(m.maxRounds),
      maxCostUsd: coercePositive(m.maxCost),
    });
    this.flashSaved();
  }

  protected resetBudget(): void {
    this.budget.reset();
    this.budgetModel.set({ maxTokens: null, maxRounds: null, maxCost: null });
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
        this.budgetModel.set({ maxTokens: 40000, maxRounds: 6, maxCost: 0.1 });
        break;
      case 'tight':
        this.budgetModel.set({ maxTokens: 10000, maxRounds: 3, maxCost: 0.02 });
        break;
      case 'generous':
        this.budgetModel.set({ maxTokens: 200000, maxRounds: 8, maxCost: 1.0 });
        break;
    }
    this.saveBudget();
  }
}
