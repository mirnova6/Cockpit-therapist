/**
 * Crypto service — all client data at rest is encrypted with AES-256-GCM.
 *
 * Key model:
 *  - A random 256-bit Data Encryption Key (DEK) encrypts every record and blob.
 *  - The DEK is wrapped (AES-GCM) by a Key Encryption Key (KEK) derived from the
 *    clinician's passphrase (and optionally a PIN) via PBKDF2-SHA256.
 *  - Unlocking derives the KEK and unwraps the DEK into memory only. Locking
 *    drops the in-memory reference; nothing decrypted is persisted.
 *
 * The module is platform-agnostic: it relies only on WebCrypto (browser and
 * Node >= 20), so the same code runs on web, Capacitor, and desktop shells.
 */

/** ArrayBuffer-backed bytes — the shape WebCrypto accepts as BufferSource. */
export type Bytes = Uint8Array<ArrayBuffer>;

export interface EncryptedPayload {
  /** base64 12-byte IV */
  iv: string;
  /** base64 ciphertext (includes GCM auth tag) */
  data: string;
}

export interface WrappedKey {
  iv: string;
  data: string;
}

export interface DerivationParams {
  salt: string; // base64
  iterations: number;
}

export const DEFAULT_PBKDF2_ITERATIONS = 310_000;

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

export function toBase64(bytes: Uint8Array | ArrayBuffer): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < arr.length; i += chunk) {
    bin += String.fromCharCode(...arr.subarray(i, i + chunk));
  }
  return btoa(bin);
}

export function fromBase64(s: string): Bytes {
  const bin = atob(s);
  const arr = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr;
}

export function randomSalt(): string {
  return toBase64(crypto.getRandomValues(new Uint8Array(16)));
}

export async function deriveWrappingKey(
  secret: string,
  params: DerivationParams,
): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    'raw',
    textEncoder.encode(secret),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: fromBase64(params.salt),
      iterations: params.iterations,
      hash: 'SHA-256',
    },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['wrapKey', 'unwrapKey'],
  );
}

/** DEK is extractable so it can be re-wrapped on passphrase/PIN changes. */
export async function generateDataKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, [
    'encrypt',
    'decrypt',
  ]);
}

export async function wrapDataKey(dek: CryptoKey, kek: CryptoKey): Promise<WrappedKey> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const wrapped = await crypto.subtle.wrapKey('raw', dek, kek, { name: 'AES-GCM', iv });
  return { iv: toBase64(iv), data: toBase64(wrapped) };
}

/**
 * Unwraps the DEK. Throws (GCM auth failure) when the KEK is wrong, which is
 * how invalid passphrases are detected — there is no separate verifier to
 * leak information about the key.
 */
export async function unwrapDataKey(wrapped: WrappedKey, kek: CryptoKey): Promise<CryptoKey> {
  return crypto.subtle.unwrapKey(
    'raw',
    fromBase64(wrapped.data),
    kek,
    { name: 'AES-GCM', iv: fromBase64(wrapped.iv) },
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt'],
  );
}

export async function encryptBytes(dek: CryptoKey, bytes: Bytes): Promise<EncryptedPayload> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, dek, bytes);
  return { iv: toBase64(iv), data: toBase64(data) };
}

export async function decryptBytes(dek: CryptoKey, payload: EncryptedPayload): Promise<Bytes> {
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromBase64(payload.iv) },
    dek,
    fromBase64(payload.data),
  );
  return new Uint8Array(plain);
}

export async function encryptJson(dek: CryptoKey, value: unknown): Promise<EncryptedPayload> {
  return encryptBytes(dek, textEncoder.encode(JSON.stringify(value)));
}

export async function decryptJson<T>(dek: CryptoKey, payload: EncryptedPayload): Promise<T> {
  return JSON.parse(textDecoder.decode(await decryptBytes(dek, payload))) as T;
}
