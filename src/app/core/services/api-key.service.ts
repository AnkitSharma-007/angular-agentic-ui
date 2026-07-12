import { Service, computed, signal } from '@angular/core';
import {
  DecryptionFailedError,
  EncryptedPayloadV1,
  SessionKeyEnvelope,
  decryptString,
  decryptWithKey,
  encryptString,
  encryptWithKey,
  generateSessionKek,
  isSupportedEncryptedPayload,
} from '../crypto/webcrypto.helpers';
import { deleteSessionKek, getSessionKek, putSessionKek } from '../crypto/session-key-store';

export type KeyStorage = 'session' | 'encrypted-local';

// v2 session tier: only the AES-GCM envelope (iv + ciphertext) lives here; the
// non-extractable KEK lives in IndexedDB. `LEGACY_SESSION_KEY` is the pre-v2
// plaintext slot, read once on restore so existing users migrate seamlessly and
// used as a best-effort fallback when WebCrypto/IndexedDB is unavailable.
const SESSION_ENVELOPE_KEY = 'agentic-ui.api-key.session.v2';
const LEGACY_SESSION_KEY = 'agentic-ui.api-key.session';
const LOCAL_STORAGE_KEY = 'agentic-ui.api-key.encrypted';

// BYOK key with two storage tiers: session (encrypted with a non-extractable
// per-session KEK, no passphrase) or AES-GCM encrypted in localStorage (requires
// a passphrase to unlock on subsequent loads).
@Service()
export class ApiKeyService {
  private readonly _key = signal<string | null>(null);
  private readonly _storage = signal<KeyStorage>('session');

  readonly key = this._key.asReadonly();
  readonly storage = this._storage.asReadonly();
  readonly hasKey = computed(() => this._key() !== null);

  readonly hasLockedBlob = signal<boolean>(this.readLockedBlob() !== null);

  // True when the session key is held in memory but could NOT be persisted to
  // sessionStorage (quota, private browsing, storage disabled). The key still
  // works for this tab, but will NOT survive a reload — surfaced so the UI can
  // warn instead of silently losing it (L3).
  private readonly _sessionPersistenceFailed = signal(false);
  readonly sessionPersistenceFailed = this._sessionPersistenceFailed.asReadonly();

  // Rehydrate the session key from storage. Async because the KEK lives in
  // IndexedDB and decryption is async — an APP_INITIALIZER awaits this so the
  // first render already knows whether a key is present (no onboarding flash).
  // Always resolves; a corrupt/undecryptable envelope is cleared, not thrown.
  async restore(): Promise<void> {
    try {
      const envelope = this.readSessionEnvelope();
      if (envelope) {
        const kek = await getSessionKek();
        if (kek) {
          const key = await decryptWithKey(kek, envelope);
          this._key.set(key);
          this._storage.set('session');
          return;
        }
        // Envelope without a usable KEK (or the reverse) can never decrypt —
        // drop the orphaned half rather than leave a dead key around.
        await this.clearSessionPersistence();
        return;
      }
      // Pre-v2 plaintext: adopt it and upgrade to an encrypted envelope.
      const legacy = this.readLegacyPlaintext();
      if (legacy) await this.setForSession(legacy);
    } catch {
      // Storage unavailable / unexpected shape — start with no session key.
    }
  }

  async setForSession(key: string): Promise<void> {
    this._key.set(key);
    this._storage.set('session');
    await this.persistSession(key);
  }

  async setEncryptedLocal(key: string, passphrase: string): Promise<void> {
    const payload = await encryptString(key, passphrase);
    try {
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(payload));
      this.hasLockedBlob.set(true);
    } catch (err) {
      throw new Error('Failed to write encrypted key to localStorage.', { cause: err });
    }
    await this.clearSessionPersistence();
    this._key.set(key);
    this._storage.set('encrypted-local');
  }

  async unlockLocal(passphrase: string): Promise<void> {
    const blob = this.readLockedBlob();
    if (!blob) throw new Error('No encrypted key stored locally.');
    const key = await decryptString(blob, passphrase);
    this._key.set(key);
    this._storage.set('encrypted-local');
  }

  async clear(): Promise<void> {
    this._key.set(null);
    this._storage.set('session');
    await this.clearSessionPersistence();
    safeWrite(() => localStorage.removeItem(LOCAL_STORAGE_KEY));
    this.hasLockedBlob.set(false);
  }

  async lock(): Promise<void> {
    this._key.set(null);
    await this.clearSessionPersistence();
  }

  static readonly DecryptionFailedError = DecryptionFailedError;

  // Encrypt the key under a fresh non-extractable KEK and persist both halves.
  // Falls back to best-effort plaintext only when WebCrypto/IndexedDB is missing
  // so the key still survives a reload in that environment.
  private async persistSession(key: string): Promise<void> {
    try {
      const kek = await generateSessionKek();
      await putSessionKek(kek);
      const envelope = await encryptWithKey(kek, key);
      const wrote = safeWrite(() =>
        sessionStorage.setItem(SESSION_ENVELOPE_KEY, JSON.stringify(envelope)),
      );
      safeWrite(() => sessionStorage.removeItem(LEGACY_SESSION_KEY));
      this.setSessionPersistenceFailed(!wrote);
    } catch {
      const wrote = safeWrite(() => sessionStorage.setItem(LEGACY_SESSION_KEY, key));
      safeWrite(() => sessionStorage.removeItem(SESSION_ENVELOPE_KEY));
      await deleteSessionKek().catch(() => undefined);
      this.setSessionPersistenceFailed(!wrote);
    }
  }

  private setSessionPersistenceFailed(failed: boolean): void {
    this._sessionPersistenceFailed.set(failed);
    if (failed) {
      console.warn(
        '[api-key] Could not persist the session key to sessionStorage; it will not survive a reload.',
      );
    }
  }

  private async clearSessionPersistence(): Promise<void> {
    safeWrite(() => sessionStorage.removeItem(SESSION_ENVELOPE_KEY));
    safeWrite(() => sessionStorage.removeItem(LEGACY_SESSION_KEY));
    this._sessionPersistenceFailed.set(false);
    await deleteSessionKek().catch(() => undefined);
  }

  private readSessionEnvelope(): SessionKeyEnvelope | null {
    try {
      const raw = sessionStorage.getItem(SESSION_ENVELOPE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as SessionKeyEnvelope;
      return parsed.version === 1 && !!parsed.iv && !!parsed.ciphertext ? parsed : null;
    } catch {
      return null;
    }
  }

  private readLegacyPlaintext(): string | null {
    try {
      return sessionStorage.getItem(LEGACY_SESSION_KEY);
    } catch {
      return null;
    }
  }

  private readLockedBlob(): EncryptedPayloadV1 | null {
    try {
      const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
      if (!raw) return null;
      const parsed: unknown = JSON.parse(raw);
      // Reject tampered kdf/iterations here too so a poisoned blob is treated as
      // "no key" (setup screen) rather than reaching the unlock/derive path (M7).
      return isSupportedEncryptedPayload(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
}

// Best-effort storage write. Returns whether it succeeded so callers can react
// to a failure (e.g. warn that a session key won't survive a reload) rather
// than swallowing it silently (L3).
function safeWrite(action: () => void): boolean {
  try {
    action();
    return true;
  } catch {
    // storage unavailable (quota, private browsing) — best-effort only
    return false;
  }
}
