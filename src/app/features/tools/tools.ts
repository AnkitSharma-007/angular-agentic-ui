import {
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { applyEach, form, validate, FormField } from '@angular/forms/signals';
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

interface BuilderForm {
  name: string;
  description: string;
  parameters: DraftParameter[];
  responseTemplate: string;
}

const DEFAULT_TEMPLATE = '{\n  "result": "ok"\n}';

function emptyBuilder(): BuilderForm {
  return { name: '', description: '', parameters: [], responseTemplate: DEFAULT_TEMPLATE };
}

@Component({
  selector: 'app-tools',
  imports: [
    FormField,
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
})
export class ToolsComponent {
  protected readonly customTools = inject(CustomToolsService);

  protected readonly specs = this.customTools.specs;
  protected readonly editingId = signal<string | null>(null);

  // Editor validation (name format/uniqueness, description, parameters) lives in the schema below.
  protected readonly builderModel = signal<BuilderForm>(emptyBuilder());

  protected readonly builderForm = form(this.builderModel, (p) => {
    validate(p.name, ({ value }) => {
      const n = value().trim();
      const err = validateToolName(n);
      if (err) return { kind: 'toolName', message: err };
      if (this.customTools.isNameInUse(n, this.editingId() ?? undefined)) {
        return { kind: 'nameInUse', message: 'A tool with this name already exists.' };
      }
      return null;
    });
    validate(p.description, ({ value }) =>
      value().trim().length === 0 ? { kind: 'required', message: 'A description is required.' } : null,
    );
    applyEach(p.parameters, (param) => {
      validate(param.name, (ctx) => {
        const nm = ctx.value().trim();
        const err = validateParameterName(nm);
        if (err) return { kind: 'paramName', message: err };
        const count = ctx.valueOf(p.parameters).filter((q) => q.name.trim() === nm).length;
        return count > 1 ? { kind: 'dupParam', message: 'Duplicate parameter name.' } : null;
      });
    });
  });

  protected readonly saving = signal(false);
  protected readonly saveError = signal<string | null>(null);
  protected readonly justSaved = signal<string | null>(null);
  // Id awaiting two-step inline delete confirm instead of native confirm().
  protected readonly confirmingDeleteId = signal<string | null>(null);

  protected readonly typeOptions: readonly { value: CustomToolParameterType; label: string }[] = [
    { value: 'string', label: 'string' },
    { value: 'number', label: 'number' },
    { value: 'boolean', label: 'boolean' },
  ];

  protected readonly nameError = computed<string | null>(
    () => this.builderForm.name().errors()[0]?.message ?? null,
  );

  // rAF-coalesced mirrors so keystrokes don't re-run applyResponseTemplate + JSON.stringify each char.
  private readonly debouncedParameters = signal<readonly DraftParameter[]>([]);
  private readonly debouncedTemplate = signal(DEFAULT_TEMPLATE);

  constructor() {
    // First tick is synchronous so initial state settles before the test's first read.
    let synchronous = true;
    let rafHandle: number | null = null;

    effect(() => {
      const { responseTemplate: tpl, parameters: params } = this.builderModel();
      if (synchronous) {
        synchronous = false;
        this.debouncedTemplate.set(tpl);
        this.debouncedParameters.set(params);
        return;
      }
      if (rafHandle !== null) return;
      rafHandle = requestAnimationFrame(() => {
        rafHandle = null;
        const model = this.builderModel();
        this.debouncedTemplate.set(model.responseTemplate);
        this.debouncedParameters.set(model.parameters);
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
    () => this.builderForm().valid() && this.templatePreview().ok,
  );

  protected startNew(): void {
    this.editingId.set(null);
    this.builderModel.set(emptyBuilder());
    this.saveError.set(null);
    this.justSaved.set(null);
  }

  protected edit(spec: CustomToolSpec): void {
    this.editingId.set(spec.id);
    this.builderModel.set({
      name: spec.name,
      description: spec.description,
      parameters: spec.parameters.map((p) => ({
        name: p.name,
        type: p.type,
        description: p.description,
        required: p.required,
      })),
      responseTemplate: spec.responseTemplate,
    });
    this.saveError.set(null);
    this.justSaved.set(null);
  }

  protected addParameter(): void {
    this.builderModel.update((m) => ({
      ...m,
      parameters: [...m.parameters, { name: '', type: 'string', description: '', required: true }],
    }));
  }

  protected removeParameter(index: number): void {
    this.builderModel.update((m) => ({
      ...m,
      parameters: m.parameters.filter((_, i) => i !== index),
    }));
  }

  protected updateParameterType(index: number, value: CustomToolParameterType): void {
    this.builderModel.update((m) => ({
      ...m,
      parameters: m.parameters.map((p, i) => (i === index ? { ...p, type: value } : p)),
    }));
  }

  protected updateParameterRequired(index: number, value: boolean): void {
    this.builderModel.update((m) => ({
      ...m,
      parameters: m.parameters.map((p, i) => (i === index ? { ...p, required: value } : p)),
    }));
  }

  protected async save(): Promise<void> {
    if (!this.canSave() || this.saving()) return;
    this.saving.set(true);
    this.saveError.set(null);
    try {
      const model = this.builderModel();
      const id = this.editingId() ?? randomId();
      const now = Date.now();
      const spec: CustomToolSpec = {
        id,
        name: model.name.trim(),
        description: model.description.trim(),
        parameters: model.parameters.map((p) => ({
          name: p.name.trim(),
          type: p.type,
          description: p.description.trim(),
          required: p.required,
        })) as readonly CustomToolParameter[],
        responseTemplate: model.responseTemplate,
        // Preserve agent-authored provenance on edit; new tools are user-authored.
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
    // Two-step delete: first click arms, second commits.
    if (this.confirmingDeleteId() !== spec.id) {
      this.confirmingDeleteId.set(spec.id);
      return;
    }
    this.confirmingDeleteId.set(null);
    try {
      await this.customTools.delete(spec.id);
      if (this.editingId() === spec.id) this.startNew();
    } catch (err) {
      this.saveError.set(err instanceof Error ? err.message : 'Delete failed.');
    }
  }

  protected cancelDelete(): void {
    this.confirmingDeleteId.set(null);
  }

  protected loadExample(): void {
    this.editingId.set(null);
    this.builderModel.set({
      name: 'searchWeather',
      description: 'Get a weather forecast for a city on a specific date.',
      parameters: [
        { name: 'city', type: 'string', description: 'City name, e.g. "Goa".', required: true },
        { name: 'date', type: 'string', description: 'Date in YYYY-MM-DD format.', required: true },
      ],
      responseTemplate: `{
  "city": {{city}},
  "date": {{date}},
  "forecast": "Partly cloudy, 28°C with light breezes",
  "uvIndex": 6,
  "rainChance": 0.15
}`,
    });
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
