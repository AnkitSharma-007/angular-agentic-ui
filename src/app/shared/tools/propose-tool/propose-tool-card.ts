import {
  Component,
  computed,
  inject,
  input,
  linkedSignal,
  signal,
} from '@angular/core';
import { applyEach, form, validate, FormField } from '@angular/forms/signals';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { InterruptService } from '../../../core/registry/interrupt.service';
import { CustomToolsService } from '../../../core/custom-tools/custom-tools.service';
import {
  applyResponseTemplate,
  clampToolDraft,
  validateParameterName,
  validateToolName,
  type CustomToolParameterType,
} from '../../../core/custom-tools/custom-tool.types';
import type { ToolCallStatus } from '../../../core/streaming/agent-event.store';
import { toolStatusFlags } from '../tool-card/tool-status-flags';
import type {
  ProposeToolArgs,
  ProposeToolDraft,
  ProposeToolResult,
} from './propose-tool.types';

interface EditableParam {
  name: string;
  type: CustomToolParameterType;
  description: string;
  required: boolean;
}

interface DraftForm {
  name: string;
  description: string;
  responseTemplate: string;
  parameters: EditableParam[];
}

const TYPE_OPTIONS: readonly { value: CustomToolParameterType; label: string }[] = [
  { value: 'string', label: 'string' },
  { value: 'number', label: 'number' },
  { value: 'boolean', label: 'boolean' },
];

function sampleValue(type: CustomToolParameterType): unknown {
  switch (type) {
    case 'number':
      return 1;
    case 'boolean':
      return true;
    default:
      return 'sample';
  }
}

@Component({
  selector: 'app-propose-tool-card',
  imports: [
    FormField,
    MatButtonModule,
    MatCardModule,
    MatCheckboxModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatSelectModule,
  ],
  templateUrl: './propose-tool-card.html',
  styleUrl: './propose-tool-card.scss',
})
export class ProposeToolCardComponent {
  private readonly interrupts = inject(InterruptService);
  private readonly customTools = inject(CustomToolsService);

  readonly callId = input.required<string>();
  readonly args = input.required<ProposeToolArgs>();
  readonly result = input<ProposeToolResult | null>(null);
  readonly status = input.required<ToolCallStatus>();
  readonly errorMessage = input<string | null>(null);
  readonly interruptReason = input<string | null>(null);

  protected readonly typeOptions = TYPE_OPTIONS;

  protected readonly flags = toolStatusFlags(this.status);

  // Writable Signal Forms copy; `linkedSignal` re-seeds from fixed per-call args for live edits before approval.
  protected readonly draftModel = linkedSignal<DraftForm>(() => {
    // Clamp untrusted model-authored proposal before render/edit; validators gate approval.
    const clamped = clampToolDraft(this.args());
    return {
      name: clamped.name,
      description: clamped.description,
      responseTemplate: clamped.responseTemplate,
      parameters: clamped.parameters.map((p) => ({
        name: p.name,
        type: p.type,
        description: p.description,
        required: p.required,
      })),
    };
  });

  protected readonly draft = form(this.draftModel, (p) => {
    validate(p.name, ({ value }) => {
      const name = value().trim();
      const err = validateToolName(name);
      if (err) return { kind: 'toolName', message: err };
      if (this.customTools.isNameInUse(name)) {
        return { kind: 'nameInUse', message: 'A tool with this name already exists — rename it.' };
      }
      return null;
    });
    validate(p.description, ({ value }) =>
      value().trim().length === 0 ? { kind: 'required', message: 'Required.' } : null,
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

  protected readonly showRejectNote = signal(false);
  protected readonly rejectionNote = signal('');

  protected readonly draftName = computed(() => this.draftModel().name);
  protected readonly nameError = computed<string | null>(
    () => this.draft.name().errors()[0]?.message ?? null,
  );

  protected readonly templatePreview = computed<{ ok: boolean; text: string }>(() => {
    const model = this.draftModel();
    const sample: Record<string, unknown> = {};
    for (const p of model.parameters) {
      const name = p.name.trim();
      if (name) sample[name] = sampleValue(p.type);
    }
    const result = applyResponseTemplate(model.responseTemplate, sample);
    if (result.ok) {
      try {
        return { ok: true, text: JSON.stringify(result.value, null, 2) };
      } catch {
        return { ok: true, text: String(result.value) };
      }
    }
    return { ok: false, text: result.error };
  });

  protected readonly canApprove = computed(
    () => this.draft().valid() && this.templatePreview().ok,
  );

  protected addParam(): void {
    this.draftModel.update((m) => ({
      ...m,
      parameters: [...m.parameters, { name: '', type: 'string', description: '', required: true }],
    }));
  }

  protected removeParam(index: number): void {
    this.draftModel.update((m) => ({
      ...m,
      parameters: m.parameters.filter((_, i) => i !== index),
    }));
  }

  protected updateParamType(index: number, value: CustomToolParameterType): void {
    this.draftModel.update((m) => ({
      ...m,
      parameters: m.parameters.map((p, i) => (i === index ? { ...p, type: value } : p)),
    }));
  }

  protected updateParamRequired(index: number, value: boolean): void {
    this.draftModel.update((m) => ({
      ...m,
      parameters: m.parameters.map((p, i) => (i === index ? { ...p, required: value } : p)),
    }));
  }

  protected toggleRejectNote(): void {
    this.showRejectNote.update((v) => !v);
  }

  protected confirmReject(): void {
    const note = this.rejectionNote().trim();
    this.interrupts.decide(this.callId(), { kind: 'reject', note: note || undefined });
  }

  protected async approve(): Promise<void> {
    if (!this.canApprove()) return;
    const model = this.draftModel();
    const draft: ProposeToolDraft = {
      name: model.name.trim(),
      description: model.description.trim(),
      parameters: model.parameters.map((p) => ({
        name: p.name.trim(),
        type: p.type,
        description: p.description.trim(),
        required: p.required,
      })),
      responseTemplate: model.responseTemplate,
    };

    const spec = this.customTools.finalizeDraft({ ...draft, origin: 'agent' });
    try {
      // Register before interrupt resolves so the new tool is callable on the next loop round.
      await this.customTools.save(spec);
    } catch {
      // IndexedDB unavailable — keep synthesis working for this session.
      this.customTools.registerEphemeral(spec);
    }

    this.interrupts.decide(this.callId(), {
      kind: 'select',
      selection: {
        registered: true,
        name: spec.name,
        description: spec.description,
      },
    });
  }
}
