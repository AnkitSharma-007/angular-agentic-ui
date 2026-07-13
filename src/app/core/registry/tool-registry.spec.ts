import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { ToolRegistry } from './tool-registry';
import type { ToolDescriptor, ToolManifest } from './tool-descriptor';
import { defineToolManifest, makeToolDescriptor } from '../../testing/tool-manifest';

function makeManifest(name: string, load?: () => Promise<ToolDescriptor>): ToolManifest {
  return defineToolManifest(name, load ? { load } : {});
}

describe('ToolRegistry', () => {
  let registry: ToolRegistry;

  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({});
    registry = TestBed.inject(ToolRegistry);
  });

  it('register() adds a manifest exposed via get() and list()', () => {
    registry.register(makeManifest('alpha'));
    expect(registry.get('alpha')?.name).toBe('alpha');
    expect(registry.list().map((t) => t.name)).toEqual(['alpha']);
  });

  it('register() throws when the same name is registered twice', () => {
    registry.register(makeManifest('dup'));
    expect(() => registry.register(makeManifest('dup'))).toThrow(/already registered/);
  });

  it('upsert() replaces an existing manifest and clears the cached descriptor', async () => {
    const initial = vi.fn(async () => makeDescriptor('x', { v: 1 }));
    const replacement = vi.fn(async () => makeDescriptor('x', { v: 2 }));

    registry.upsert(makeManifest('x', initial));
    await registry.loadImpl('x');
    expect(initial).toHaveBeenCalledTimes(1);

    registry.upsert(makeManifest('x', replacement));
    const loaded = await registry.loadImpl('x');
    expect(replacement).toHaveBeenCalledTimes(1);
    expect((loaded as ToolDescriptor & { tag?: unknown }).tag).toEqual({ v: 2 });
  });

  it('unregister() removes the manifest, descriptor, and loadedNames entry', async () => {
    registry.register(makeManifest('y'));
    await registry.loadImpl('y');
    expect(registry.loadedNames()).toContain('y');

    registry.unregister('y');
    expect(registry.get('y')).toBeUndefined();
    expect(registry.loadedNames()).not.toContain('y');
  });

  it('loadImpl() caches the descriptor across repeated calls', async () => {
    const load = vi.fn(async () => makeDescriptor('z'));
    registry.register(makeManifest('z', load));

    const a = await registry.loadImpl('z');
    const b = await registry.loadImpl('z');
    expect(a).toBe(b);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('loadImpl() for an unknown name rejects', async () => {
    await expect(registry.loadImpl('missing')).rejects.toThrow(/Unknown tool/);
  });

  it('loadImpl() retries after a failure (failed promises are not cached)', async () => {
    const load = vi
      .fn<() => Promise<ToolDescriptor>>()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce(makeDescriptor('retry'));

    registry.register(makeManifest('retry', load));
    await expect(registry.loadImpl('retry')).rejects.toThrow('boom');
    const descriptor = await registry.loadImpl('retry');
    expect(descriptor.name).toBe('retry');
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('execute() validates args against the descriptor schema', async () => {
    const descriptor: ToolDescriptor = {
      name: 'add',
      description: 'add',
      declaration: {
        name: 'add',
        description: 'add',
        parameters: { type: 'OBJECT', properties: {} },
      },
      argsSchema: z.object({ a: z.number(), b: z.number() }),
      component: null as unknown as ToolDescriptor['component'],
      execute: async ({ a, b }) => ({ sum: a + b }),
    };
    registry.register({ ...descriptor, load: async () => descriptor });

    const ctx = { callId: 'c1', signal: new AbortController().signal };
    expect(await registry.execute('add', { a: 1, b: 2 }, ctx)).toEqual({ sum: 3 });
    await expect(registry.execute('add', { a: 'oops' }, ctx)).rejects.toThrow(
      /Invalid args/,
    );
  });

  it('componentFor() returns null until the descriptor is loaded', async () => {
    const sentinel = {} as unknown as ToolDescriptor['component'];
    const descriptor: ToolDescriptor = {
      ...makeDescriptor('c'),
      component: sentinel,
    };
    registry.register({ ...descriptor, load: async () => descriptor });

    expect(registry.componentFor('c')).toBeNull();
    await registry.loadImpl('c');
    expect(registry.componentFor('c')).toBe(sentinel);
  });

  it('records a failed load in failedNames() and exposes hasFailed()', async () => {
    const load = vi
      .fn<() => Promise<ToolDescriptor>>()
      .mockRejectedValueOnce(new Error('chunk load failed'));
    registry.register(makeManifest('boom', load));

    expect(registry.hasFailed('boom')).toBe(false);
    await expect(registry.loadImpl('boom')).rejects.toThrow('chunk load failed');
    expect(registry.hasFailed('boom')).toBe(true);
    expect(registry.failedNames()).toContain('boom');
  });

  it('clears the failed marker when a subsequent load succeeds', async () => {
    const load = vi
      .fn<() => Promise<ToolDescriptor>>()
      .mockRejectedValueOnce(new Error('transient'))
      .mockResolvedValueOnce(makeDescriptor('flaky'));
    registry.register(makeManifest('flaky', load));

    await expect(registry.loadImpl('flaky')).rejects.toThrow('transient');
    expect(registry.hasFailed('flaky')).toBe(true);

    await registry.loadImpl('flaky');
    expect(registry.hasFailed('flaky')).toBe(false);
    expect(registry.failedNames()).not.toContain('flaky');
  });

  it('upsert() / unregister() clears the failed marker as well', async () => {
    const load = vi
      .fn<() => Promise<ToolDescriptor>>()
      .mockRejectedValueOnce(new Error('fail'));
    registry.register(makeManifest('upsertable', load));
    await expect(registry.loadImpl('upsertable')).rejects.toThrow();
    expect(registry.hasFailed('upsertable')).toBe(true);

    registry.upsert(makeManifest('upsertable'));
    expect(registry.hasFailed('upsertable')).toBe(false);

    registry.register(makeManifest('removable', vi.fn().mockRejectedValue(new Error('x'))));
    await expect(registry.loadImpl('removable')).rejects.toThrow();
    expect(registry.hasFailed('removable')).toBe(true);

    registry.unregister('removable');
    expect(registry.hasFailed('removable')).toBe(false);
  });
});

function makeDescriptor(name: string, tag?: unknown): ToolDescriptor & { tag?: unknown } {
  return {
    ...makeToolDescriptor(name, { argsSchema: z.any() }),
    ...(tag !== undefined ? { tag } : {}),
  };
}
