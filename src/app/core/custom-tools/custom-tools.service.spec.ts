import { beforeEach, describe, expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { TestBed } from '@angular/core/testing';
import { CustomToolsService } from './custom-tools.service';
import { ToolRegistry } from '../registry/tool-registry';
import { applyResponseTemplate, type CustomToolSpec } from './custom-tool.types';

function makeSpec(partial: Partial<CustomToolSpec> = {}): CustomToolSpec {
  return {
    id: partial.id ?? 'spec-1',
    name: partial.name ?? 'translate',
    description: partial.description ?? 'Translate text into a target language.',
    parameters: partial.parameters ?? [
      { name: 'text', type: 'string', description: 'Text', required: true },
      { name: 'lang', type: 'string', description: 'Target', required: false },
    ],
    responseTemplate:
      partial.responseTemplate ?? '{"translated": {{text}}, "lang": {{lang}}}',
    createdAt: partial.createdAt ?? 1_000_000,
    updatedAt: partial.updatedAt ?? 1_000_000,
  };
}

describe('CustomToolsService', () => {
  let service: CustomToolsService;
  let registry: ToolRegistry;

  beforeEach(() => {
    (globalThis as unknown as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({});
    service = TestBed.inject(CustomToolsService);
    registry = TestBed.inject(ToolRegistry);
  });

  it('starts empty and unavailable=false', () => {
    expect(service.count()).toBe(0);
    expect(service.specs()).toEqual([]);
    expect(service.unavailable()).toBe(false);
    expect(service.loaded()).toBe(false);
  });

  it('save() persists, exposes the spec, and registers a tool manifest', async () => {
    const spec = makeSpec();
    await service.save(spec);

    expect(service.count()).toBe(1);
    expect(service.specs()[0]).toEqual(spec);

    const meta = registry.get('translate');
    expect(meta).toBeDefined();
    expect(meta?.declaration.parameters.required).toEqual(['text']);
    expect(meta?.declaration.parameters.properties['text']?.type).toBe('STRING');
    expect(meta?.declaration.parameters.properties['lang']?.type).toBe('STRING');
  });

  it('save() upserts: saving the same id replaces the previous version', async () => {
    await service.save(makeSpec({ id: 'a', name: 'echo', description: 'v1' }));
    await service.save(makeSpec({ id: 'a', name: 'echo', description: 'v2' }));
    expect(service.count()).toBe(1);
    expect(service.specs()[0].description).toBe('v2');
  });

  it('load() reads specs back from IndexedDB after a save, sorted newest first', async () => {
    await service.save(makeSpec({ id: 'old', name: 'a', createdAt: 1 }));
    await service.save(makeSpec({ id: 'new', name: 'b', createdAt: 2 }));

    // Reset the service via a fresh injector while keeping the IDB instance.
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({});
    const fresh = TestBed.inject(CustomToolsService);
    await fresh.load();

    const ids = fresh.specs().map((s) => s.id);
    expect(ids).toEqual(['new', 'old']);
    expect(fresh.loaded()).toBe(true);
  });

  it('load() is idempotent', async () => {
    await service.save(makeSpec({ id: 'x', name: 'x' }));

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({});
    const fresh = TestBed.inject(CustomToolsService);
    await fresh.load();
    await fresh.load();
    expect(fresh.count()).toBe(1);
  });

  it('delete() removes the spec and unregisters the tool from the registry', async () => {
    const spec = makeSpec({ id: 'bye', name: 'farewell' });
    await service.save(spec);
    expect(registry.get('farewell')).toBeDefined();

    await service.delete('bye');

    expect(service.count()).toBe(0);
    expect(registry.get('farewell')).toBeUndefined();
  });

  it('delete() is a no-op for unknown ids', async () => {
    await service.delete('does-not-exist');
    expect(service.count()).toBe(0);
  });

  it('getById() returns the spec or undefined', async () => {
    await service.save(makeSpec({ id: 'a', name: 'alpha' }));
    expect(service.getById('a')?.name).toBe('alpha');
    expect(service.getById('missing')).toBeUndefined();
  });

  it('isNameInUse() flags duplicates from owned specs', async () => {
    await service.save(makeSpec({ id: 'a', name: 'translate' }));
    expect(service.isNameInUse('translate')).toBe(true);
    expect(service.isNameInUse('translate', 'a')).toBe(false);
    expect(service.isNameInUse('something-else')).toBe(false);
    expect(service.isNameInUse('')).toBe(false);
  });

  it('finalizeDraft() stamps a unique id and timestamps onto an id-less draft', () => {
    const draft = {
      name: 'weather',
      description: 'Get weather.',
      parameters: [{ name: 'city', type: 'string' as const, description: 'City', required: true }],
      responseTemplate: '{"ok": true}',
    };
    const a = service.finalizeDraft(draft);
    const b = service.finalizeDraft(draft);

    expect(a.name).toBe('weather');
    expect(a.id).toBeTruthy();
    expect(a.createdAt).toBeTypeOf('number');
    expect(a.updatedAt).toBe(a.createdAt);
    expect(a.id).not.toBe(b.id);
  });

  it('registerEphemeral() hot-registers into the registry without touching IndexedDB', () => {
    const spec = makeSpec({ id: 'eph', name: 'ephemeralTool' });
    service.registerEphemeral(spec);

    expect(service.count()).toBe(1);
    expect(service.specs()[0]).toEqual(spec);
    expect(registry.get('ephemeralTool')).toBeDefined();
    expect(service.customToolNames().has('ephemeralTool')).toBe(true);
  });

  it('ensureRegisteredForReplay() upserts into the registry only, leaving the library untouched', () => {
    const spec = makeSpec({ id: 'r1', name: 'replayTool' });
    service.ensureRegisteredForReplay(spec);

    // Registry can now resolve the tool so a replayed card renders…
    expect(registry.get('replayTool')).toBeDefined();
    // …but it never entered the user's saved tool library.
    expect(service.count()).toBe(0);
    expect(service.customToolNames().has('replayTool')).toBe(false);
  });

  it('ensureRegisteredForReplay() does not clobber an already-registered tool', async () => {
    await service.save(makeSpec({ id: 'live', name: 'shared', description: 'live version' }));
    const before = registry.get('shared');

    service.ensureRegisteredForReplay(
      makeSpec({ id: 'embedded', name: 'shared', description: 'stale replay version' }),
    );

    // The live manifest is preserved (same reference), replay copy is ignored.
    expect(registry.get('shared')).toBe(before);
    expect(service.count()).toBe(1);
  });

  it('finalizeDraft() carries an origin through onto the finalized spec', () => {
    const spec = service.finalizeDraft({
      name: 'weather',
      description: 'Get weather.',
      parameters: [],
      responseTemplate: '{"ok": true}',
      origin: 'agent',
    });
    expect(spec.origin).toBe('agent');
  });

  it('isNameInUse() flags collisions with non-owned tools in the registry', async () => {
    registry.register({
      name: 'searchFlights',
      description: 'eager tool',
      declaration: {
        name: 'searchFlights',
        description: 'eager',
        parameters: { type: 'OBJECT', properties: {} },
      },
      load: async () => {
        throw new Error('not needed');
      },
    });

    expect(service.isNameInUse('searchFlights')).toBe(true);
  });
});

describe('CustomToolsService — response template via the loaded descriptor', () => {
  beforeEach(() => {
    (globalThis as unknown as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({});
  });

  it('substitutes parameters into the response template and parses JSON', () => {
    // applyResponseTemplate is pure; cover it directly rather than waiting on
    // the lazy descriptor chunk (which depends on a Material component).
    const result = applyResponseTemplate(
      '{"translated": {{text}}, "lang": {{lang}}}',
      { text: 'hello', lang: 'fr' },
    );
    expect(result).toEqual({
      ok: true,
      value: { translated: 'hello', lang: 'fr' },
    });
  });

  it('reports parse errors when the substituted template is not valid JSON', () => {
    const result = applyResponseTemplate('{"a": {{a}}, "b": }', { a: 1 });
    expect(result.ok).toBe(false);
  });

  it('substitutes missing args as null', () => {
    const result = applyResponseTemplate('{"v": {{missing}}}', {});
    expect(result).toEqual({ ok: true, value: { v: null } });
  });
});
