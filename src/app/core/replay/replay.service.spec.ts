import { beforeEach, describe, expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { TestBed } from '@angular/core/testing';
import { ReplayService } from './replay.service';
import { idbPut, openDb } from '../storage/indexeddb.helpers';
import { makeReplayPayload as makePayload } from '../../testing/replay-fixtures';

describe('ReplayService', () => {
  let service: ReplayService;

  beforeEach(() => {
    // Fresh in-memory IDB per test — avoids cross-test pollution without deleteDatabase deadlocks.
    (globalThis as unknown as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({});
    service = TestBed.inject(ReplayService);
  });

  it('starts with an empty cache and count = 0', () => {
    expect(service.summaries()).toEqual([]);
    expect(service.count()).toBe(0);
    expect(service.loaded()).toBe(false);
    expect(service.unavailable()).toBe(false);
    expect(service.lastError()).toBeNull();
  });

  it('save() persists a payload and surfaces a summary in the signal', async () => {
    const payload = makePayload({ id: 'run-1', title: 'Goa weekend' });

    await service.save(payload);

    expect(service.count()).toBe(1);
    const summaries = service.summaries();
    expect(summaries).toHaveLength(1);
    expect(summaries[0]).toMatchObject({
      id: 'run-1',
      title: 'Goa weekend',
      durationMs: 100,
      eventCount: 2,
    });
    expect(service.lastError()).toBeNull();
  });

  it('load() round-trips the full payload including events and stats', async () => {
    const payload = makePayload({ id: 'run-rt' });
    await service.save(payload);

    const loaded = await service.load('run-rt');

    expect(loaded).not.toBeNull();
    expect(loaded).toEqual(payload);
  });

  it('load() returns null for an unknown id', async () => {
    const loaded = await service.load('does-not-exist');
    expect(loaded).toBeNull();
  });

  it('save() with an existing id overwrites the prior record', async () => {
    await service.save(makePayload({ id: 'dup', title: 'First version', durationMs: 100 }));
    await service.save(makePayload({ id: 'dup', title: 'Second version', durationMs: 200 }));

    expect(service.count()).toBe(1);
    expect(service.summaries()[0]).toMatchObject({
      id: 'dup',
      title: 'Second version',
      durationMs: 200,
    });

    const loaded = await service.load('dup');
    expect(loaded?.title).toBe('Second version');
    expect(loaded?.durationMs).toBe(200);
  });

  it('refresh() rehydrates the cache from IDB after a fresh service instance', async () => {
    await service.save(makePayload({ id: 'persist-1', title: 'Persisted run' }));

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({});
    const fresh = TestBed.inject(ReplayService);

    expect(fresh.summaries()).toEqual([]);
    const summaries = await fresh.refresh();
    expect(summaries).toHaveLength(1);
    expect(fresh.summaries()).toHaveLength(1);
    expect(fresh.summaries()[0].id).toBe('persist-1');
    expect(fresh.loaded()).toBe(true);
  });

  it('refresh() sorts summaries newest-savedAt first', async () => {
    await service.save(makePayload({ id: 'old', savedAt: '2026-05-01T08:00:00.000Z' }));
    await service.save(makePayload({ id: 'new', savedAt: '2026-05-15T08:00:00.000Z' }));
    await service.save(makePayload({ id: 'mid', savedAt: '2026-05-10T08:00:00.000Z' }));

    const summaries = await service.refresh();
    expect(summaries.map((s) => s.id)).toEqual(['new', 'mid', 'old']);
  });

  it('delete() removes a record and updates the cache', async () => {
    await service.save(makePayload({ id: 'keep' }));
    await service.save(makePayload({ id: 'remove' }));
    expect(service.count()).toBe(2);

    await service.delete('remove');

    expect(service.count()).toBe(1);
    expect(service.summaries().map((s) => s.id)).toEqual(['keep']);
    expect(await service.load('remove')).toBeNull();
  });

  it('clear() wipes the store and the cache', async () => {
    await service.save(makePayload({ id: 'a' }));
    await service.save(makePayload({ id: 'b' }));

    await service.clear();

    expect(service.count()).toBe(0);
    expect(service.summaries()).toEqual([]);
    expect(await service.load('a')).toBeNull();
    expect(await service.load('b')).toBeNull();
  });

  it('summaries are pure projections — they drop events and rawHistory', async () => {
    await service.save(makePayload({ id: 'thin' }));
    const summary = service.summaries()[0];
    expect(summary).not.toHaveProperty('events');
    expect(summary).not.toHaveProperty('rawHistory');
    expect(summary).not.toHaveProperty('schemaVersion');
  });

  it('refresh() flips loaded() to true even when the read fails', async () => {
    // Save first to initialise the DB, then poison `transaction` so idbGetAll throws.
    await service.save(makePayload({ id: 'one' }));

    const fresh = TestBed.inject(ReplayService);
    type Private = { dbPromise: Promise<IDBDatabase> | null };
    const priv = fresh as unknown as Private;
    priv.dbPromise = Promise.resolve({
      transaction: () => {
        throw new Error('store missing');
      },
    } as unknown as IDBDatabase);

    expect(fresh.loaded()).toBe(false);
    const result = await fresh.refresh();
    expect(result).toEqual([]);
    expect(fresh.loaded()).toBe(true);
    expect(fresh.lastError()).not.toBeNull();
  });

  it('refresh() drops stale cached summaries when a subsequent read fails', async () => {
    await service.save(makePayload({ id: 'cached', title: 'Cached run' }));
    await service.refresh();
    expect(service.summaries()).toHaveLength(1);

    type Private = { dbPromise: Promise<IDBDatabase> | null };
    (service as unknown as Private).dbPromise = Promise.resolve({
      transaction: () => {
        throw new Error('store missing');
      },
    } as unknown as IDBDatabase);

    const result = await service.refresh();

    // Returned array and cached signal must both be empty so `refreshFailed` can fire.
    expect(result).toEqual([]);
    expect(service.summaries()).toEqual([]);
    expect(service.lastError()).not.toBeNull();
  });

  it('refresh() drops corrupt/tampered rows so one bad summary cannot crash the list', async () => {
    await service.save(makePayload({ id: 'valid', savedAt: '2026-05-15T08:00:00.000Z' }));

    // Seed a poisoned summary directly (bypassing save); open at v2 so we do not downgrade the DB.
    const db = await openDb('agentic-ui-angular', 2, (d) => {
      if (!d.objectStoreNames.contains('replays')) {
        d.createObjectStore('replays', { keyPath: 'id' });
      }
      if (!d.objectStoreNames.contains('summaries')) {
        d.createObjectStore('summaries', { keyPath: 'id' });
      }
    });
    await idbPut(db, 'summaries', { id: 'corrupt', title: 'oops' });

    const summaries = await service.refresh();

    expect(summaries.map((s) => s.id)).toEqual(['valid']);
    expect(service.summaries().map((s) => s.id)).toEqual(['valid']);
  });

  it('classifies a quota failure as a storage error with actionable copy', async () => {
    type Private = { dbPromise: Promise<IDBDatabase> | null };
    (service as unknown as Private).dbPromise = Promise.resolve({
      transaction: () => {
        throw new DOMException('exceeded', 'QuotaExceededError');
      },
    } as unknown as IDBDatabase);

    await expect(service.save(makePayload({ id: 'q' }))).rejects.toBeInstanceOf(DOMException);
    expect(service.lastError()).toBe(
      'Your browser storage is full. Delete some saved runs and try again.',
    );
  });

  it('re-tags an otherwise-unknown IDB failure as a storage error message', async () => {
    type Private = { dbPromise: Promise<IDBDatabase> | null };
    (service as unknown as Private).dbPromise = Promise.resolve({
      transaction: () => {
        throw new Error('The database connection is closing.');
      },
    } as unknown as IDBDatabase);

    await expect(service.load('anything')).rejects.toBeInstanceOf(Error);
    expect(service.lastError()).toMatch(/local storage/i);
  });

  it('clearError() resets lastError so callers can dismiss a transient failure banner', async () => {
    type Private = { _lastError: { set: (v: string | null) => void } };
    (service as unknown as Private)._lastError.set('IDB write failed');

    expect(service.lastError()).toBe('IDB write failed');
    service.clearError();
    expect(service.lastError()).toBeNull();
  });
});
