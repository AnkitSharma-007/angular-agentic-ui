import { Service, type Type, computed, signal } from '@angular/core';
import type {
  FunctionDeclaration,
  ToolDescriptor,
  ToolExecutionContext,
  ToolManifest,
  ToolMeta,
} from './tool-descriptor';

@Service()
export class ToolRegistry {
  private readonly manifests = new Map<string, ToolManifest>();
  private readonly descriptors = new Map<string, ToolDescriptor>();
  private readonly loading = new Map<string, Promise<ToolDescriptor>>();
  private readonly _loadedNames = signal<readonly string[]>([]);
  private readonly _failedNames = signal<readonly string[]>([]);

  readonly loadedNames = this._loadedNames.asReadonly();
  readonly failedNames = this._failedNames.asReadonly();
  readonly loadedCount = computed(() => this._loadedNames().length);

  hasFailed(name: string): boolean {
    return this._failedNames().includes(name);
  }

  register<TArgs, TResult>(manifest: ToolManifest<TArgs, TResult>): void {
    if (this.manifests.has(manifest.name)) {
      throw new Error(`Tool already registered: ${manifest.name}`);
    }
    this.manifests.set(manifest.name, manifest as ToolManifest);
  }

  upsert<TArgs, TResult>(manifest: ToolManifest<TArgs, TResult>): void {
    this.manifests.set(manifest.name, manifest as ToolManifest);
    this.descriptors.delete(manifest.name);
    this.loading.delete(manifest.name);
    this._loadedNames.update((list) => list.filter((n) => n !== manifest.name));
    this._failedNames.update((list) => list.filter((n) => n !== manifest.name));
  }

  unregister(name: string): void {
    this.manifests.delete(name);
    this.descriptors.delete(name);
    this.loading.delete(name);
    this._loadedNames.update((list) => list.filter((n) => n !== name));
    this._failedNames.update((list) => list.filter((n) => n !== name));
  }

  get(name: string): ToolMeta | undefined {
    return this.manifests.get(name);
  }

  list(): readonly ToolMeta[] {
    return [...this.manifests.values()];
  }

  declarations(): readonly FunctionDeclaration[] {
    return this.list().map((t) => t.declaration);
  }

  componentFor(name: string): Type<unknown> | null {
    return this.descriptors.get(name)?.component ?? null;
  }

  loadImpl(name: string): Promise<ToolDescriptor> {
    const cached = this.loading.get(name);
    if (cached) return cached;

    const manifest = this.manifests.get(name);
    if (!manifest) {
      return Promise.reject(new Error(`Unknown tool: ${name}`));
    }

    const promise = manifest
      .load()
      .then((descriptor) => {
        this.descriptors.set(name, descriptor as ToolDescriptor);
        this._loadedNames.update((list) =>
          list.includes(name) ? list : [...list, name],
        );
        this._failedNames.update((list) => list.filter((n) => n !== name));
        return descriptor as ToolDescriptor;
      })
      .catch((err) => {
        this.loading.delete(name);
        this._failedNames.update((list) =>
          list.includes(name) ? list : [...list, name],
        );
        throw err;
      });

    this.loading.set(name, promise);
    return promise;
  }

  async execute(
    name: string,
    rawArgs: unknown,
    ctx: ToolExecutionContext,
  ): Promise<Record<string, unknown>> {
    const descriptor = await this.loadImpl(name);
    const parsed = descriptor.argsSchema.safeParse(rawArgs);
    if (!parsed.success) {
      throw new Error(`Invalid args for ${name}: ${parsed.error.message}`);
    }
    const result = await descriptor.execute(parsed.data, ctx);
    return (result ?? {}) as Record<string, unknown>;
  }
}
