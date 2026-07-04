import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatCheckboxModule } from '@angular/material/checkbox';

import { CustomToolsService } from '../../core/custom-tools/custom-tools.service';
import {
  applyResponseTemplate,
  validateParameterName,
  validateToolName,
  type CustomToolParameter,
  type CustomToolParameterType,
  type CustomToolSpec,
} from '../../core/custom-tools/custom-tool.types';
import { PageHeaderComponent } from '../../shared/page-header/page-header';

interface DraftParameter {
  name: string;
  type: CustomToolParameterType;
  description: string;
  required: boolean;
}

const DEFAULT_TEMPLATE = '{\n  "result": "ok"\n}';

@Component({
  selector: 'app-tools',
  imports: [
    FormsModule,
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatCheckboxModule,
    PageHeaderComponent,
  ],
  templateUrl: './tools.html',
  styleUrl: './tools.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ToolsComponent {
  protected readonly customTools = inject(CustomToolsService);

  protected readonly specs = this.customTools.specs;
  protected readonly editingId = signal<string | null>(null);

  protected readonly name = signal('');
  protected readonly description = signal('');
  protected readonly parameters = signal<readonly DraftParameter[]>([]);
  protected readonly responseTemplate = signal(DEFAULT_TEMPLATE);

  protected readonly saving = signal(false);
  protected readonly saveError = signal<string | null>(null);
  protected readonly justSaved = signal<string | null>(null);

  protected readonly typeOptions: readonly { value: CustomToolParameterType; label: string }[] = [
    { value: 'string', label: 'string' },
    { value: 'number', label: 'number' },
    { value: 'boolean', label: 'boolean' },
  ];

  protected readonly nameError = computed<string | null>(() => {
    const n = this.name().trim();
    const err = validateToolName(n);
    if (err) return err;
    if (this.customTools.isNameInUse(n, this.editingId() ?? undefined)) {
      return 'A tool with this name already exists.';
    }
    return null;
  });

  protected readonly parameterErrors = computed<readonly (string | null)[]>(() => {
    const list = this.parameters();
    return list.map((p, idx) => {
      const err = validateParameterName(p.name);
      if (err) return err;
      const duplicate = list.findIndex((q, i) => i < idx && q.name === p.name) >= 0;
      return duplicate ? 'Duplicate parameter name.' : null;
    });
  });

  // rAF-coalesced mirrors so the template-editor keystrokes don't re-run
  // `applyResponseTemplate` + `JSON.stringify` on every character.
  private readonly debouncedParameters = signal<readonly DraftParameter[]>([]);
  private readonly debouncedTemplate = signal(DEFAULT_TEMPLATE);

  constructor() {
    // First tick is synchronous so initial state + `loadExample()` settle
    // before the test's first read.
    let synchronous = true;
    let rafHandle: number | null = null;

    effect(() => {
      const tpl = this.responseTemplate();
      const params = this.parameters();
      if (synchronous) {
        synchronous = false;
        this.debouncedTemplate.set(tpl);
        this.debouncedParameters.set(params);
        return;
      }
      if (rafHandle !== null) return;
      rafHandle = requestAnimationFrame(() => {
        rafHandle = null;
        this.debouncedTemplate.set(this.responseTemplate());
        this.debouncedParameters.set(this.parameters());
      });
    });

    inject(DestroyRef).onDestroy(() => {
      if (rafHandle !== null) {
        cancelAnimationFrame(rafHandle);
        rafHandle = null;
      }
    });
  }

  protected readonly templatePreview = computed<{ ok: boolean; text: string }>(() => {
    const args: Record<string, unknown> = {};
    for (const p of this.debouncedParameters()) {
      if (!p.name) continue;
      args[p.name] = sampleValue(p.type);
    }
    const result = applyResponseTemplate(this.debouncedTemplate(), args);
    if (result.ok) {
      try {
        return { ok: true, text: JSON.stringify(result.value, null, 2) };
      } catch {
        return { ok: true, text: String(result.value) };
      }
    }
    return { ok: false, text: result.error };
  });

  protected readonly canSave = computed(
    () =>
      !this.nameError() &&
      this.description().trim().length > 0 &&
      !this.parameterErrors().some((e) => e !== null) &&
      this.templatePreview().ok,
  );

  protected startNew(): void {
    this.editingId.set(null);
    this.name.set('');
    this.description.set('');
    this.parameters.set([]);
    this.responseTemplate.set(DEFAULT_TEMPLATE);
    this.saveError.set(null);
    this.justSaved.set(null);
  }

  protected edit(spec: CustomToolSpec): void {
    this.editingId.set(spec.id);
    this.name.set(spec.name);
    this.description.set(spec.description);
    this.parameters.set(
      spec.parameters.map((p) => ({
        name: p.name,
        type: p.type,
        description: p.description,
        required: p.required,
      })),
    );
    this.responseTemplate.set(spec.responseTemplate);
    this.saveError.set(null);
    this.justSaved.set(null);
  }

  protected addParameter(): void {
    this.parameters.update((list) => [
      ...list,
      {
        name: '',
        type: 'string',
        description: '',
        required: true,
      },
    ]);
  }

  protected removeParameter(index: number): void {
    this.parameters.update((list) => list.filter((_, i) => i !== index));
  }

  protected updateParameterName(index: number, value: string): void {
    this.parameters.update((list) =>
      list.map((p, i) => (i === index ? { ...p, name: value } : p)),
    );
  }

  protected updateParameterType(index: number, value: CustomToolParameterType): void {
    this.parameters.update((list) =>
      list.map((p, i) => (i === index ? { ...p, type: value } : p)),
    );
  }

  protected updateParameterDescription(index: number, value: string): void {
    this.parameters.update((list) =>
      list.map((p, i) => (i === index ? { ...p, description: value } : p)),
    );
  }

  protected updateParameterRequired(index: number, value: boolean): void {
    this.parameters.update((list) =>
      list.map((p, i) => (i === index ? { ...p, required: value } : p)),
    );
  }

  protected async save(): Promise<void> {
    if (!this.canSave() || this.saving()) return;
    this.saving.set(true);
    this.saveError.set(null);
    try {
      const id = this.editingId() ?? randomId();
      const now = Date.now();
      const spec: CustomToolSpec = {
        id,
        name: this.name().trim(),
        description: this.description().trim(),
        parameters: this.parameters().map((p) => ({
          name: p.name.trim(),
          type: p.type,
          description: p.description.trim(),
          required: p.required,
        })) as readonly CustomToolParameter[],
        responseTemplate: this.responseTemplate(),
        // Preserve provenance when editing (an agent-authored tool stays labelled
        // as such); brand-new tools built here are user-authored.
        origin: this.editingId() ? this.customTools.getById(id)?.origin ?? 'user' : 'user',
        createdAt: this.editingId()
          ? this.customTools.getById(id)?.createdAt ?? now
          : now,
        updatedAt: now,
      };
      await this.customTools.save(spec);
      this.editingId.set(id);
      this.justSaved.set(spec.name);
    } catch (err) {
      this.saveError.set(err instanceof Error ? err.message : 'Unknown error.');
    } finally {
      this.saving.set(false);
    }
  }

  protected async delete(spec: CustomToolSpec): Promise<void> {
    if (!confirm(`Delete custom tool "${spec.name}"?`)) return;
    try {
      await this.customTools.delete(spec.id);
      if (this.editingId() === spec.id) this.startNew();
    } catch (err) {
      this.saveError.set(err instanceof Error ? err.message : 'Delete failed.');
    }
  }

  protected loadExample(): void {
    this.editingId.set(null);
    this.name.set('searchWeather');
    this.description.set('Get a weather forecast for a city on a specific date.');
    this.parameters.set([
      {
        name: 'city',
        type: 'string',
        description: 'City name, e.g. "Goa".',
        required: true,
      },
      {
        name: 'date',
        type: 'string',
        description: 'Date in YYYY-MM-DD format.',
        required: true,
      },
    ]);
    this.responseTemplate.set(
      `{
  "city": {{city}},
  "date": {{date}},
  "forecast": "Partly cloudy, 28°C with light breezes",
  "uvIndex": 6,
  "rainChance": 0.15
}`,
    );
    this.saveError.set(null);
    this.justSaved.set(null);
  }
}

function randomId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `tool_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function sampleValue(type: CustomToolParameterType): unknown {
  switch (type) {
    case 'string':
      return 'example';
    case 'number':
      return 42;
    case 'boolean':
      return true;
  }
}
