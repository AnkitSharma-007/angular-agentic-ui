import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  linkedSignal,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
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
  validateParameterName,
  validateToolName,
  type CustomToolParameterType,
} from '../../../core/custom-tools/custom-tool.types';
import type { ToolCallStatus } from '../../../core/streaming/agent-event.store';
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
    FormsModule,
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
  changeDetection: ChangeDetectionStrategy.OnPush,
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

  protected readonly isPending = computed(() => this.status() === 'pending_approval');
  protected readonly isRunning = computed(() => this.status() === 'running');
  protected readonly isComplete = computed(() => this.status() === 'complete');
  protected readonly isRejected = computed(() => this.status() === 'rejected');
  protected readonly isError = computed(() => this.status() === 'error');

  // Editable copies of the proposed draft. `linkedSignal` re-seeds from the
  // incoming args (which are fixed for a given call) yet stays writable so the
  // presenter can tweak the definition live before approving.
  protected readonly draftName = linkedSignal(() => this.args().name);
  protected readonly draftDescription = linkedSignal(() => this.args().description);
  protected readonly draftTemplate = linkedSignal(() => this.args().responseTemplate);
  protected readonly draftParams = linkedSignal<EditableParam[]>(() =>
    this.args().parameters.map((p) => ({
      name: p.name,
      type: p.type,
      description: p.description,
      required: p.required,
    })),
  );

  protected readonly showRejectNote = signal(false);
  protected readonly rejectionNote = signal('');

  protected readonly nameError = computed<string | null>(() => {
    const name = this.draftName().trim();
    const err = validateToolName(name);
    if (err) return err;
    if (this.customTools.isNameInUse(name)) {
      return 'A tool with this name already exists — rename it.';
    }
    return null;
  });

  protected readonly descriptionError = computed<string | null>(() =>
    this.draftDescription().trim().length === 0 ? 'Required.' : null,
  );

  protected readonly paramErrors = computed<readonly (string | null)[]>(() => {
    const list = this.draftParams();
    return list.map((p, idx) => {
      const err = validateParameterName(p.name.trim());
      if (err) return err;
      const duplicate = list.findIndex((q, i) => i < idx && q.name.trim() === p.name.trim()) >= 0;
      return duplicate ? 'Duplicate parameter name.' : null;
    });
  });

  protected readonly templatePreview = computed<{ ok: boolean; text: string }>(() => {
    const sample: Record<string, unknown> = {};
    for (const p of this.draftParams()) {
      const name = p.name.trim();
      if (name) sample[name] = sampleValue(p.type);
    }
    const result = applyResponseTemplate(this.draftTemplate(), sample);
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
    () =>
      !this.nameError() &&
      !this.descriptionError() &&
      !this.paramErrors().some((e) => e !== null) &&
      this.templatePreview().ok,
  );

  protected addParam(): void {
    this.draftParams.update((list) => [
      ...list,
      { name: '', type: 'string', description: '', required: true },
    ]);
  }

  protected removeParam(index: number): void {
    this.draftParams.update((list) => list.filter((_, i) => i !== index));
  }

  protected updateParamName(index: number, value: string): void {
    this.draftParams.update((list) =>
      list.map((p, i) => (i === index ? { ...p, name: value } : p)),
    );
  }

  protected updateParamType(index: number, value: CustomToolParameterType): void {
    this.draftParams.update((list) =>
      list.map((p, i) => (i === index ? { ...p, type: value } : p)),
    );
  }

  protected updateParamDescription(index: number, value: string): void {
    this.draftParams.update((list) =>
      list.map((p, i) => (i === index ? { ...p, description: value } : p)),
    );
  }

  protected updateParamRequired(index: number, value: boolean): void {
    this.draftParams.update((list) =>
      list.map((p, i) => (i === index ? { ...p, required: value } : p)),
    );
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
    const draft: ProposeToolDraft = {
      name: this.draftName().trim(),
      description: this.draftDescription().trim(),
      parameters: this.draftParams().map((p) => ({
        name: p.name.trim(),
        type: p.type,
        description: p.description.trim(),
        required: p.required,
      })),
      responseTemplate: this.draftTemplate(),
    };

    const spec = this.customTools.finalizeDraft({ ...draft, origin: 'agent' });
    try {
      // Persist + hot-register. Registration completes before the interrupt
      // resolves, so the new tool is in the registry when the loop advances.
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
