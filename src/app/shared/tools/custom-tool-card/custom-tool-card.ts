import { Component, computed, input, signal } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { SectionHeadComponent } from '../../ui/section-head/section-head';
import type { ToolCallStatus } from '../../../core/streaming/agent-event.store';

interface ValueEntry {
  readonly key: string;
  readonly node: ValueNode;
}

// Flat shape for recursive templates — Angular's template checker won't narrow unions across @switch/@case.
interface ValueNode {
  readonly kind: 'scalar' | 'object' | 'list';
  readonly text: string;
  readonly title: string | null;
  readonly entries: readonly ValueEntry[];
  readonly items: readonly ValueNode[];
}

const TITLE_KEYS = ['name', 'title', 'label'] as const;

@Component({
  selector: 'app-custom-tool-card',
  imports: [NgTemplateOutlet, MatCardModule, MatIconModule, SectionHeadComponent],
  templateUrl: './custom-tool-card.html',
  styleUrl: './custom-tool-card.scss',
})
export class CustomToolCardComponent {
  readonly callId = input<string>('');
  readonly args = input<Record<string, unknown>>({});
  readonly result = input<Record<string, unknown> | null>(null);
  readonly status = input<ToolCallStatus>('running');
  readonly errorMessage = input<string | null>(null);
  readonly interruptReason = input<string | null>(null);

  protected readonly rawOpen = signal(false);

  protected readonly toolName = computed(() => {
    const r = this.result();
    if (r && typeof r['toolName'] === 'string') return r['toolName'] as string;
    return 'Custom tool';
  });

  protected readonly toolDescription = computed(() => {
    const r = this.result();
    if (r && typeof r['toolDescription'] === 'string') return r['toolDescription'] as string;
    return null;
  });

  protected readonly argEntries = computed(() => Object.entries(this.args()));

  // Synthesized tools wrap payload under `response`; older results may be the object itself.
  private readonly responsePayload = computed<unknown>(() => {
    const r = this.result();
    if (!r) return undefined;
    return 'response' in r ? r['response'] : r;
  });

  // Recursive human-friendly view — nested arrays/objects never fall back to raw JSON.
  protected readonly responseNode = computed<ValueNode | null>(() => {
    const payload = this.responsePayload();
    if (payload === null || payload === undefined) return null;
    return toNode(payload);
  });

  protected readonly responseJson = computed(() => {
    const payload = this.responsePayload();
    if (payload === undefined) return null;
    try {
      return JSON.stringify(payload, null, 2);
    } catch {
      return String(payload);
    }
  });

  protected toggleRaw(): void {
    this.rawOpen.update((v) => !v);
  }

  protected formatValue(value: unknown): string {
    return formatScalar(value);
  }
}

function isPrimitive(v: unknown): boolean {
  return typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean';
}

function formatScalar(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function pickTitleKey(obj: Record<string, unknown>): string | null {
  for (const key of TITLE_KEYS) {
    if (typeof obj[key] === 'string' && (obj[key] as string).length > 0) return key;
  }
  return null;
}

function scalarNode(text: string): ValueNode {
  return { kind: 'scalar', text, title: null, entries: [], items: [] };
}

function toNode(value: unknown): ValueNode {
  if (value === null || value === undefined || isPrimitive(value)) {
    return scalarNode(formatScalar(value));
  }

  if (Array.isArray(value)) {
    return { kind: 'list', text: '', title: null, entries: [], items: value.map(toNode) };
  }

  const obj = value as Record<string, unknown>;
  const titleKey = pickTitleKey(obj);
  const entries: ValueEntry[] = Object.entries(obj)
    .filter(([key]) => key !== titleKey)
    .map(([key, val]) => ({ key, node: toNode(val) }));

  return {
    kind: 'object',
    text: '',
    title: titleKey ? (obj[titleKey] as string) : null,
    entries,
    items: [],
  };
}
