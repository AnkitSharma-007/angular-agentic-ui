import { beforeEach, describe, expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { deleteSessionKek, getSessionKek, putSessionKek } from './session-key-store';
import { decryptWithKey, encryptWithKey, generateSessionKek } from './webcrypto.helpers';

describe('session-key-store', () => {
  beforeEach(() => {
    (globalThis as unknown as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
  });

  it('returns null when no KEK has been stored', async () => {
    expect(await getSessionKek()).toBeNull();
  });

  it('persists a non-extractable KEK that can still decrypt after a round-trip', async () => {
    const kek = await generateSessionKek();
    const envelope = await encryptWithKey(kek, 'sk-persisted');
    await putSessionKek(kek);

    const restored = await getSessionKek();
    expect(restored).toBeInstanceOf(CryptoKey);
    expect(restored!.extractable).toBe(false);
    // The restored handle still decrypts the ciphertext produced by the original.
    expect(await decryptWithKey(restored!, envelope)).toBe('sk-persisted');
  });

  it('overwrites the previous KEK on a second put', async () => {
    const first = await generateSessionKek();
    await putSessionKek(first);
    const second = await generateSessionKek();
    await putSessionKek(second);

    // The stored key must be the newer one: ciphertext from `first` no longer
    // decrypts under it.
    const envelopeFromFirst = await encryptWithKey(first, 'x');
    await expect(decryptWithKey((await getSessionKek())!, envelopeFromFirst)).rejects.toThrow();
  });

  it('deleteSessionKek() removes the stored key', async () => {
    await putSessionKek(await generateSessionKek());
    await deleteSessionKek();
    expect(await getSessionKek()).toBeNull();
  });
});
