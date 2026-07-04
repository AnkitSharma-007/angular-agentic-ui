import { Injectable, computed, inject, signal } from '@angular/core';
import { idbDelete, idbGetAll, idbPut, openDb } from '../storage/indexeddb.helpers';
import { ToolRegistry } from '../registry/tool-registry';
import type { ToolManifest } from '../registry/tool-descriptor';
import { specToDeclaration } from './custom-tool-declaration';
import type { CustomToolSpec } from './custom-tool.types';

const DB_NAME = 'atlas-custom-tools';
const DB_VERSION = 1;
const STORE = 'tools';

@Injectable({ providedIn: 'root' })
export class CustomToolsService {
  private readonly registry = inject(ToolRegistry);

  private dbPromise: Promise<IDBDatabase> | null = null;
  private readonly _specs = signal<readonly CustomToolSpec[]>([]);
  private readonly _unavailable = signal(false);
  private readonly _loaded = signal(false);

  readonly specs = this._specs.asReadonly();
  readonly unavailable = this._unavailable.asReadonly();
  readonly loaded = this._loaded.asReadonly();
  readonly count = computed(() => this._specs().length);
  // Exposed so the agent loop can union user-defined tools into every agent's
  // declarations — without this, custom tools are silently invisible to the
  // model whenever the active agent's hard-coded allow-list doesn't list them.
  readonly customToolNames = computed<ReadonlySet<string>>(
    () => new Set(this._specs().map((s) => s.name)),
  );

  async load(): Promise<void> {
    if (this._loaded()) return;
    try {
      const db = await this.db();
      const stored = await idbGetAll<CustomToolSpec>(db, STORE);
      const sorted = [...stored].sort(byCreatedDesc);
      for (const spec of sorted) {
        this.registry.upsert(this.buildManifest(spec));
      }
      this._specs.set(sorted);
    } catch {
      this._unavailable.set(true);
    } finally {
      this._loaded.set(true);
    }
  }

  async save(spec: CustomToolSpec): Promise<void> {
    const db = await this.db();
    await idbPut(db, STORE, spec);
    this._specs.update((list) =>
      [spec, ...list.filter((s) => s.id !== spec.id)].sort(byCreatedDesc),
    );
    this.registry.upsert(this.buildManifest(spec));
  }

  // Turn an id-less draft (e.g. one the agent proposed) into a full spec by
  // stamping a fresh id and timestamps.
  finalizeDraft(draft: Omit<CustomToolSpec, 'id' | 'createdAt' | 'updatedAt'>): CustomToolSpec {
    const now = Date.now();
    return { ...draft, id: randomId(), createdAt: now, updatedAt: now };
  }

  // Register a tool for this session only — hot-registers into the registry and
  // updates `specs`/`customToolNames`, but skips IndexedDB. Used as a graceful
  // fallback when persistence is unavailable so agent tool synthesis still works
  // in the demo.
  registerEphemeral(spec: CustomToolSpec): void {
    this._specs.update((list) =>
      [spec, ...list.filter((s) => s.id !== spec.id)].sort(byCreatedDesc),
    );
    this.registry.upsert(this.buildManifest(spec));
  }

  // Register a spec into the tool registry only — no `specs` signal update, no
  // IndexedDB. Used when rehydrating a saved replay so an embedded synthesized
  // tool's card can resolve its descriptor, without polluting the user's tool
  // library. Skips names already registered so a live tool always wins.
  ensureRegisteredForReplay(spec: CustomToolSpec): void {
    if (this.registry.get(spec.name)) return;
    this.registry.upsert(this.buildManifest(spec));
  }

  async delete(id: string): Promise<void> {
    const existing = this._specs().find((s) => s.id === id);
    if (!existing) return;
    const db = await this.db();
    await idbDelete(db, STORE, id);
    this._specs.update((list) => list.filter((s) => s.id !== id));
    this.registry.unregister(existing.name);
  }

  getById(id: string): CustomToolSpec | undefined {
    return this._specs().find((s) => s.id === id);
  }

  isNameInUse(name: string, exceptId?: string): boolean {
    if (!name) return false;
    const ownedNames = new Set(this._specs().map((s) => s.name));
    if (this._specs().some((s) => s.name === name && s.id !== exceptId)) return true;
    return this.registry.list().some((t) => t.name === name && !ownedNames.has(t.name));
  }

  private buildManifest(spec: CustomToolSpec): ToolManifest {
    return {
      name: spec.name,
      description: spec.description,
      declaration: specToDeclaration(spec),
      load: async () => {
        const [{ specToDescriptor }, { CustomToolCardComponent }] = await Promise.all([
          import('./custom-tool-descriptor'),
          import('../../shared/tools/custom-tool-card/custom-tool-card'),
        ]);
        return specToDescriptor(spec, CustomToolCardComponent);
      },
    };
  }

  private db(): Promise<IDBDatabase> {
    if (!this.dbPromise) {
      this.dbPromise = openDb(DB_NAME, DB_VERSION, (db) => {
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: 'id' });
        }
      }).catch((err) => {
        this._unavailable.set(true);
        throw err;
      });
    }
    return this.dbPromise;
  }
}

function byCreatedDesc(a: CustomToolSpec, b: CustomToolSpec): number {
  return b.createdAt - a.createdAt;
}

function randomId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `tool_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}
