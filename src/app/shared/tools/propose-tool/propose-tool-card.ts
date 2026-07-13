import {
  Component,
  computed,
  inject,
  input,
  linkedSignal,
  signal,
} from '@angular/core';
import { form, FormField } from '@angular/forms/signals';
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
  clampToolDraft,
  type CustomToolParameterType,
} from '../../../core/custom-tools/custom-tool.types';
import {
  addDraftParam,
  applyToolDraftValidators,
  buildTemplatePreview,
  removeDraftParam,
  setDraftParamRequired,
  setDraftParamType,
  TYPE_OPTIONS,
  type ToolDraftModel,
} from '../../../core/custom-tools/tool-draft-form';
import type { ToolCallStatus } from '../../../core/streaming/agent-event.store';
import { toolStatusFlags } from '../tool-card/tool-status-flags';
import { SectionHeadComponent } from '../../ui/section-head/section-head';
import type {
  ProposeToolArgs,
  ProposeToolDraft,
  ProposeToolResult,
} from './propose-tool.types';

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
    SectionHeadComponent,
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
  protected readonly draftModel = linkedSignal<ToolDraftModel>(() => {
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

  protected readonly draft = form(this.draftModel, (p) =>
    applyToolDraftValidators(p, {
      isNameInUse: (name) => this.customTools.isNameInUse(name),
      nameInUseMessage: 'A tool with this name already exists — rename it.',
      descriptionMessage: 'Required.',
    }),
  );

  protected readonly showRejectNote = signal(false);
  protected readonly rejectionNote = signal('');

  protected readonly draftName = computed(() => this.draftModel().name);
  protected readonly nameError = computed<string | null>(
    () => this.draft.name().errors()[0]?.message ?? null,
  );

  protected readonly templatePreview = computed(() => {
    const model = this.draftModel();
    const sample: Record<string, unknown> = {};
    for (const p of model.parameters) {
      const name = p.name.trim();
      if (name) sample[name] = sampleValue(p.type);
    }
    return buildTemplatePreview(model.responseTemplate, sample);
  });

  protected readonly canApprove = computed(
    () => this.draft().valid() && this.templatePreview().ok,
  );

  protected addParam(): void {
    this.draftModel.update(addDraftParam);
  }

  protected removeParam(index: number): void {
    this.draftModel.update((m) => removeDraftParam(m, index));
  }

  protected updateParamType(index: number, value: CustomToolParameterType): void {
    this.draftModel.update((m) => setDraftParamType(m, index, value));
  }

  protected updateParamRequired(index: number, value: boolean): void {
    this.draftModel.update((m) => setDraftParamRequired(m, index, value));
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
