import { Service, computed, signal } from '@angular/core';
import {
  idbClear,
  idbDelete,
  idbGet,
  idbGetAll,
  idbPut,
  openDb,
} from '../storage/indexeddb.helpers';
import type { ReplayPayload, ReplaySummary } from './replay.types';
import { isValidReplayPayload, toSummary } from './replay.types';

const DB_NAME = 'agentic-ui-angular';
const DB_VERSION = 1;
const STORE_REPLAYS = 'replays';

@Service()
export class ReplayService {
  private dbPromise: Promise<IDBDatabase> | null = null;

  private readonly _summaries = signal<readonly ReplaySummary[]>([]);
  private readonly _unavailable = signal<boolean>(false);
  private readonly _lastError = signal<string | null>(null);
  private readonly _loaded = signal<boolean>(false);

  readonly summaries = this._summaries.asReadonly();
  readonly unavailable = this._unavailable.asReadonly();
  readonly lastError = this._lastError.asReadonly();
  readonly loaded = this._loaded.asReadonly();
  readonly count = computed(() => this._summaries().length);

  async save(payload: ReplayPayload): Promise<void> {
    try {
      const db = await this.db();
      await idbPut(db, STORE_REPLAYS, payload);
      this._summaries.update((list) => {
        const withoutDup = list.filter((s) => s.id !== payload.id);
        return [toSummary(payload), ...withoutDup].sort(byDateDesc);
      });
      this._lastError.set(null);
    } catch (err) {
      this.captureError(err);
      throw err;
    }
  }

  async refresh(): Promise<readonly ReplaySummary[]> {
    try {
      const db = await this.db();
      const all = await idbGetAll<unknown>(db, STORE_REPLAYS);
      // Skip corrupt/tampered rows so a single bad payload can't crash the
      // Library list (e.g. an undefined `savedAt` throwing in `byDateDesc`).
      const summaries = all.filter(isValidReplayPayload).map(toSummary).sort(byDateDesc);
      this._summaries.set(summaries);
      this._loaded.set(true);
      this._lastError.set(null);
      return summaries;
    } catch (err) {
      this.captureError(err);
      // Flip out of the indeterminate spinner and drop stale rows so the
      // Library's `refreshFailed` predicate (loaded && empty && error) fires.
      this._loaded.set(true);
      this._summaries.set([]);
      return [];
    }
  }

  async load(id: string): Promise<ReplayPayload | null> {
    try {
      const db = await this.db();
      const payload = await idbGet<ReplayPayload>(db, STORE_REPLAYS, id);
      this._lastError.set(null);
      return payload ?? null;
    } catch (err) {
      this.captureError(err);
      throw err;
    }
  }

  async delete(id: string): Promise<void> {
    try {
      const db = await this.db();
      await idbDelete(db, STORE_REPLAYS, id);
      this._summaries.update((list) => list.filter((s) => s.id !== id));
      this._lastError.set(null);
    } catch (err) {
      this.captureError(err);
      throw err;
    }
  }

  async clear(): Promise<void> {
    try {
      const db = await this.db();
      await idbClear(db, STORE_REPLAYS);
      this._summaries.set([]);
      this._lastError.set(null);
    } catch (err) {
      this.captureError(err);
      throw err;
    }
  }

  clearError(): void {
    this._lastError.set(null);
  }

  private db(): Promise<IDBDatabase> {
    if (this._unavailable()) {
      return Promise.reject(
        new Error('Replay storage is unavailable in this browser.'),
      );
    }
    if (!this.dbPromise) {
      this.dbPromise = openDb(DB_NAME, DB_VERSION, (db) => {
        if (!db.objectStoreNames.contains(STORE_REPLAYS)) {
          db.createObjectStore(STORE_REPLAYS, { keyPath: 'id' });
        }
      }).catch((err) => {
        this._unavailable.set(true);
        this.captureError(err);
        throw err;
      });
    }
    return this.dbPromise;
  }

  private captureError(err: unknown): void {
    const message = err instanceof Error ? err.message : String(err);
    this._lastError.set(message);
  }
}

function byDateDesc(a: ReplaySummary, b: ReplaySummary): number {
  return b.savedAt.localeCompare(a.savedAt);
}
