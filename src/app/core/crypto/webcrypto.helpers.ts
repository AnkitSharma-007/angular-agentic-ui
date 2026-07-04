// AES-GCM string encryption with a PBKDF2-derived key. Uses `crypto.subtle`;
// only the self-contained envelope below is persisted.

const PBKDF2_ITERATIONS = 250_000;
const SALT_BYTES = 16;
const IV_BYTES = 12;
const KEY_BITS = 256;

export interface EncryptedPayloadV1 {
  readonly version: 1;
  readonly algorithm: 'AES-GCM';
  readonly kdf: 'PBKDF2-SHA256';
  readonly iterations: number;
  readonly salt: string;
  readonly iv: string;
  readonly ciphertext: string;
}

export class CryptoNotAvailableError extends Error {
  constructor() {
    super('WebCrypto subtle API is not available in this environment.');
    this.name = 'CryptoNotAvailableError';
  }
}

export class DecryptionFailedError extends Error {
  constructor(cause?: unknown) {
    super('Decryption failed. The passphrase is likely incorrect.');
    this.name = 'DecryptionFailedError';
    if (cause instanceof Error) this.cause = cause;
  }
}

function assertSubtle(): SubtleCrypto {
  if (typeof globalThis.crypto === 'undefined' || !globalThis.crypto.subtle) {
    throw new CryptoNotAvailableError();
  }
  return globalThis.crypto.subtle;
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function fromBase64(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

function randomBytes(length: number): Uint8Array {
  const arr = new Uint8Array(length);
  globalThis.crypto.getRandomValues(arr);
  return arr;
}

async function deriveKey(
  passphrase: string,
  salt: Uint8Array,
  iterations: number,
): Promise<CryptoKey> {
  const subtle = assertSubtle();
  const passphraseKey = await subtle.importKey(
    'raw',
    new TextEncoder().encode(passphrase) as BufferSource,
    { name: 'PBKDF2' },
    false,
    ['deriveKey'],
  );
  return subtle.deriveKey(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations, hash: 'SHA-256' },
    passphraseKey,
    { name: 'AES-GCM', length: KEY_BITS },
    false,
    ['encrypt', 'decrypt'],
  );
}

export async function encryptString(
  plaintext: string,
  passphrase: string,
): Promise<EncryptedPayloadV1> {
  const subtle = assertSubtle();
  const salt = randomBytes(SALT_BYTES);
  const iv = randomBytes(IV_BYTES);
  const key = await deriveKey(passphrase, salt, PBKDF2_ITERATIONS);
  const ciphertextBuf = await subtle.encrypt(
    { name: 'AES-GCM', iv: iv as BufferSource },
    key,
    new TextEncoder().encode(plaintext) as BufferSource,
  );
  return {
    version: 1,
    algorithm: 'AES-GCM',
    kdf: 'PBKDF2-SHA256',
    iterations: PBKDF2_ITERATIONS,
    salt: toBase64(salt),
    iv: toBase64(iv),
    ciphertext: toBase64(new Uint8Array(ciphertextBuf)),
  };
}

export async function decryptString(
  payload: EncryptedPayloadV1,
  passphrase: string,
): Promise<string> {
  const subtle = assertSubtle();
  try {
    const salt = fromBase64(payload.salt);
    const iv = fromBase64(payload.iv);
    const ciphertext = fromBase64(payload.ciphertext);
    const key = await deriveKey(passphrase, salt, payload.iterations);
    const plainBuf = await subtle.decrypt(
      { name: 'AES-GCM', iv: iv as BufferSource },
      key,
      ciphertext as BufferSource,
    );
    return new TextDecoder().decode(plainBuf);
  } catch (err) {
    throw new DecryptionFailedError(err);
  }
}

// --- Session-tier encryption -------------------------------------------------
//
// The "session" storage tier (no passphrase) encrypts the key with a random,
// **non-extractable** AES-GCM key (the KEK). The KEK lives as a CryptoKey handle
// in IndexedDB (see session-key-store.ts) — its raw bytes can never be read back
// out — and only this envelope (iv + ciphertext) is written to sessionStorage.
// Net effect: the plaintext key is never at rest, and an XSS payload can't
// exfiltrate the KEK; it would have to actively call decrypt() to recover the
// key. It still survives a reload (both halves persist within the session).

export interface SessionKeyEnvelope {
  readonly version: 1;
  readonly iv: string;
  readonly ciphertext: string;
}

export function generateSessionKek(): Promise<CryptoKey> {
  const subtle = assertSubtle();
  // extractable = false: the raw key material can never leave WebCrypto.
  return subtle.generateKey({ name: 'AES-GCM', length: KEY_BITS }, false, [
    'encrypt',
    'decrypt',
  ]);
}

export async function encryptWithKey(
  key: CryptoKey,
  plaintext: string,
): Promise<SessionKeyEnvelope> {
  const subtle = assertSubtle();
  const iv = randomBytes(IV_BYTES);
  const ciphertextBuf = await subtle.encrypt(
    { name: 'AES-GCM', iv: iv as BufferSource },
    key,
    new TextEncoder().encode(plaintext) as BufferSource,
  );
  return {
    version: 1,
    iv: toBase64(iv),
    ciphertext: toBase64(new Uint8Array(ciphertextBuf)),
  };
}

export async function decryptWithKey(
  key: CryptoKey,
  envelope: SessionKeyEnvelope,
): Promise<string> {
  const subtle = assertSubtle();
  try {
    const iv = fromBase64(envelope.iv);
    const ciphertext = fromBase64(envelope.ciphertext);
    const plainBuf = await subtle.decrypt(
      { name: 'AES-GCM', iv: iv as BufferSource },
      key,
      ciphertext as BufferSource,
    );
    return new TextDecoder().decode(plainBuf);
  } catch (err) {
    throw new DecryptionFailedError(err);
  }
}
