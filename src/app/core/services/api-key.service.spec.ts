import { TestBed } from '@angular/core/testing';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiKeyService } from './api-key.service';
import { DecryptionFailedError } from '../crypto/webcrypto.helpers';
import { deleteSessionKek, getSessionKek } from '../crypto/session-key-store';

const SESSION_ENVELOPE_KEY = 'agentic-ui.api-key.session.v2';
const LEGACY_SESSION_KEY = 'agentic-ui.api-key.session';
const LOCAL_STORAGE_KEY = 'agentic-ui.api-key.encrypted';

function freshService(): ApiKeyService {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({});
  return TestBed.inject(ApiKeyService);
}

describe('ApiKeyService', () => {
  beforeEach(() => {
    (globalThis as unknown as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
    sessionStorage.clear();
    localStorage.clear();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({});
  });

  afterEach(() => {
    sessionStorage.clear();
    localStorage.clear();
  });

  it('starts with no key and no locked blob', () => {
    const service = TestBed.inject(ApiKeyService);
    expect(service.key()).toBeNull();
    expect(service.hasKey()).toBe(false);
    expect(service.hasLockedBlob()).toBe(false);
    expect(service.storage()).toBe('session');
  });

  it('setForSession() holds the key in memory and persists only an encrypted envelope (no plaintext at rest)', async () => {
    const service = TestBed.inject(ApiKeyService);
    await service.setForSession('sk-test-123');

    expect(service.key()).toBe('sk-test-123');
    expect(service.hasKey()).toBe(true);
    expect(service.storage()).toBe('session');

    // No plaintext slot is written…
    expect(sessionStorage.getItem(LEGACY_SESSION_KEY)).toBeNull();
    // …only an AES-GCM envelope, and it never contains the raw key.
    const raw = sessionStorage.getItem(SESSION_ENVELOPE_KEY)!;
    expect(raw).toBeTruthy();
    expect(raw).not.toContain('sk-test-123');
    const envelope = JSON.parse(raw);
    expect(envelope.version).toBe(1);
    expect(envelope.iv).toBeTruthy();
    expect(envelope.ciphertext).toBeTruthy();
    // The KEK is stored as a non-extractable CryptoKey handle in IndexedDB.
    const kek = await getSessionKek();
    expect(kek).toBeInstanceOf(CryptoKey);
    expect(kek!.extractable).toBe(false);
  });

  it('flags session persistence failure when sessionStorage writes throw (L3)', async () => {
    const service = TestBed.inject(ApiKeyService);
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('QuotaExceededError');
    });

    await service.setForSession('sk-nopersist');

    // The key still works this tab, but the failure is now observable (not swallowed).
    expect(service.key()).toBe('sk-nopersist');
    expect(service.sessionPersistenceFailed()).toBe(true);

    spy.mockRestore();
  });

  it('does not flag persistence failure on a normal session save (L3)', async () => {
    const service = TestBed.inject(ApiKeyService);
    await service.setForSession('sk-ok');
    expect(service.sessionPersistenceFailed()).toBe(false);
  });

  it('restore() rehydrates the session key from the envelope + KEK across a reload', async () => {
    const service = TestBed.inject(ApiKeyService);
    await service.setForSession('sk-reload');

    // A brand-new instance starts empty until restore() runs (the app does this
    // in an APP_INITIALIZER).
    const fresh = freshService();
    expect(fresh.key()).toBeNull();

    await fresh.restore();
    expect(fresh.key()).toBe('sk-reload');
    expect(fresh.storage()).toBe('session');
  });

  it('restore() drops an orphaned envelope when the KEK is gone', async () => {
    const service = TestBed.inject(ApiKeyService);
    await service.setForSession('sk-orphan');
    // Simulate losing the IndexedDB half while the sessionStorage half remains.
    await deleteSessionKek();

    const fresh = freshService();
    await fresh.restore();

    expect(fresh.key()).toBeNull();
    expect(sessionStorage.getItem(SESSION_ENVELOPE_KEY)).toBeNull();
  });

  it('restore() migrates a pre-v2 plaintext session key to an encrypted envelope', async () => {
    sessionStorage.setItem(LEGACY_SESSION_KEY, 'sk-legacy');

    const service = freshService();
    await service.restore();

    expect(service.key()).toBe('sk-legacy');
    expect(service.storage()).toBe('session');
    // Legacy plaintext is upgraded away, replaced by an envelope.
    expect(sessionStorage.getItem(LEGACY_SESSION_KEY)).toBeNull();
    expect(sessionStorage.getItem(SESSION_ENVELOPE_KEY)).toBeTruthy();
  });

  it('lock() clears the in-memory key + session persistence but leaves the locked blob alone', async () => {
    const service = TestBed.inject(ApiKeyService);
    await service.setEncryptedLocal('sk-locked', 'passphrase-1');
    expect(service.hasLockedBlob()).toBe(true);

    await service.lock();

    expect(service.key()).toBeNull();
    expect(service.hasKey()).toBe(false);
    expect(sessionStorage.getItem(SESSION_ENVELOPE_KEY)).toBeNull();
    expect(localStorage.getItem(LOCAL_STORAGE_KEY)).not.toBeNull();
    expect(service.hasLockedBlob()).toBe(true);
  });

  it('clear() wipes the session envelope, KEK, localStorage, and resets all signals', async () => {
    const service = TestBed.inject(ApiKeyService);
    await service.setForSession('sk-1');
    await service.setEncryptedLocal('sk-2', 'pw');

    await service.clear();

    expect(service.key()).toBeNull();
    expect(service.hasLockedBlob()).toBe(false);
    expect(service.storage()).toBe('session');
    expect(sessionStorage.getItem(SESSION_ENVELOPE_KEY)).toBeNull();
    expect(sessionStorage.getItem(LEGACY_SESSION_KEY)).toBeNull();
    expect(localStorage.getItem(LOCAL_STORAGE_KEY)).toBeNull();
    expect(await getSessionKek()).toBeNull();
  });
});

describe('ApiKeyService — encrypt + decrypt round-trip', () => {
  beforeEach(() => {
    (globalThis as unknown as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
    sessionStorage.clear();
    localStorage.clear();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({});
  });

  it('setEncryptedLocal → unlockLocal recovers the original key', async () => {
    const service = TestBed.inject(ApiKeyService);
    await service.setEncryptedLocal('sk-roundtrip', 'correct horse battery staple');

    const fresh = freshService();
    expect(fresh.key()).toBeNull();
    expect(fresh.hasLockedBlob()).toBe(true);

    await fresh.unlockLocal('correct horse battery staple');
    expect(fresh.key()).toBe('sk-roundtrip');
    expect(fresh.storage()).toBe('encrypted-local');
  });

  it('unlockLocal() throws DecryptionFailedError on a wrong passphrase', async () => {
    const service = TestBed.inject(ApiKeyService);
    await service.setEncryptedLocal('sk-secret', 'right-passphrase');

    const fresh = freshService();
    await expect(fresh.unlockLocal('wrong-passphrase')).rejects.toBeInstanceOf(
      DecryptionFailedError,
    );
  });

  it('unlockLocal() throws when no locked blob exists', async () => {
    const service = TestBed.inject(ApiKeyService);
    await expect(service.unlockLocal('anything')).rejects.toThrow(/No encrypted key stored/);
  });

  it('setEncryptedLocal() persists JSON envelope v1/AES-GCM', async () => {
    const service = TestBed.inject(ApiKeyService);
    await service.setEncryptedLocal('sk', 'pw');

    const payload = JSON.parse(localStorage.getItem(LOCAL_STORAGE_KEY)!);
    expect(payload.version).toBe(1);
    expect(payload.algorithm).toBe('AES-GCM');
    expect(payload.kdf).toBe('PBKDF2-SHA256');
    expect(payload.salt).toBeTruthy();
    expect(payload.iv).toBeTruthy();
    expect(payload.ciphertext).toBeTruthy();
  });

  it('treats a blob with an absurdly high iteration count as absent (M7)', async () => {
    const service = TestBed.inject(ApiKeyService);
    await service.setEncryptedLocal('sk-secret', 'correct horse battery staple');

    const payload = JSON.parse(localStorage.getItem(LOCAL_STORAGE_KEY)!);
    payload.iterations = 5_000_000_000; // would freeze the UI thread on derive
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(payload));

    const fresh = freshService();
    expect(fresh.hasLockedBlob()).toBe(false);
    await expect(fresh.unlockLocal('correct horse battery staple')).rejects.toThrow(
      /No encrypted key stored/,
    );
  });

  it('treats a blob with a too-low iteration count as absent (M7)', async () => {
    const service = TestBed.inject(ApiKeyService);
    await service.setEncryptedLocal('sk-secret', 'correct horse battery staple');

    const payload = JSON.parse(localStorage.getItem(LOCAL_STORAGE_KEY)!);
    payload.iterations = 10; // far below the floor → weakened KDF
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(payload));

    expect(freshService().hasLockedBlob()).toBe(false);
  });

  it('treats a blob with an unsupported kdf as absent (M7)', async () => {
    const service = TestBed.inject(ApiKeyService);
    await service.setEncryptedLocal('sk-secret', 'correct horse battery staple');

    const payload = JSON.parse(localStorage.getItem(LOCAL_STORAGE_KEY)!);
    payload.kdf = 'PBKDF2-MD5';
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(payload));

    expect(freshService().hasLockedBlob()).toBe(false);
  });

  it('setEncryptedLocal() switches storage mode to encrypted-local and clears the session envelope', async () => {
    const service = TestBed.inject(ApiKeyService);
    await service.setForSession('sk-session');
    expect(sessionStorage.getItem(SESSION_ENVELOPE_KEY)).toBeTruthy();

    await service.setEncryptedLocal('sk-locked', 'pw');

    expect(service.key()).toBe('sk-locked');
    expect(service.storage()).toBe('encrypted-local');
    expect(sessionStorage.getItem(SESSION_ENVELOPE_KEY)).toBeNull();
    expect(await getSessionKek()).toBeNull();
  });
});
