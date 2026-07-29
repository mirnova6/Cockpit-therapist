/**
 * EncryptedStore — typed, collection-oriented persistence where every value
 * is AES-GCM encrypted with the session DEK before it reaches the adapter.
 * Repositories never see ciphertext; the adapter never sees plaintext.
 */
import {
  decryptBytes,
  decryptText,
  encryptBytes,
  encryptJson,
  type Bytes,
  type EncryptedPayload,
} from '../crypto/cryptoService';
import type { StorageAdapter } from './indexedDbAdapter';

/**
 * Upper bound on cached plaintext, in characters (~2 bytes each). Beyond this
 * the cache stops admitting new entries rather than growing without limit; the
 * store still works, it just decrypts more often.
 */
const MAX_CACHED_CHARS = 8_000_000;

interface CacheEntry {
  /** The record's AES-GCM IV — freshly random on every write, so it doubles as
   * a version token. If the stored IV differs, the cached plaintext is stale
   * (including when another tab wrote the record within the same millisecond). */
  iv: string;
  json: string;
}

export class EncryptedStore {
  /**
   * Session-scoped plaintext cache (Phase 9 performance work).
   *
   * Reading one client's inputs requires decrypting every input in the
   * workspace, because records are stored by collection rather than by client.
   * AES-GCM dominates that cost (~80% of it, measured), so repeat reads within
   * an unlocked session reuse the decrypted JSON instead of re-running the
   * cipher.
   *
   * Security properties this preserves:
   *  - Nothing decrypted is ever persisted; this Map lives only in memory.
   *  - The cache belongs to the store instance, which belongs to the session.
   *    Locking drops the session, which drops the store, which drops the cache.
   *    There is no module-level or cross-session plaintext.
   *  - Only the *string* is cached, never a shared object, so callers keep
   *    getting independent values they may freely mutate — behaviour is
   *    identical to decrypting every time.
   */
  private cache = new Map<string, CacheEntry>();
  private cachedChars = 0;

  constructor(
    private adapter: StorageAdapter,
    private dek: CryptoKey,
  ) {}

  private key(collection: string, id: string): string {
    return `${collection}:${id}`;
  }

  private admit(key: string, iv: string, json: string): void {
    const existing = this.cache.get(key);
    if (existing) this.cachedChars -= existing.json.length;
    if (this.cachedChars + json.length > MAX_CACHED_CHARS) {
      if (existing) this.cache.delete(key);
      return;
    }
    this.cache.set(key, { iv, json });
    this.cachedChars += json.length;
  }

  private evict(key: string): void {
    const existing = this.cache.get(key);
    if (!existing) return;
    this.cachedChars -= existing.json.length;
    this.cache.delete(key);
  }

  /** Decrypts an envelope, reusing cached plaintext when the IV still matches. */
  private async materialize<T>(key: string, payload: EncryptedPayload): Promise<T> {
    const hit = this.cache.get(key);
    if (hit && hit.iv === payload.iv) return JSON.parse(hit.json) as T;
    const json = await decryptText(this.dek, payload);
    this.admit(key, payload.iv, json);
    return JSON.parse(json) as T;
  }

  /** Drops all cached plaintext. Called on lock; safe to call at any time. */
  clearCache(): void {
    this.cache.clear();
    this.cachedChars = 0;
  }

  /** Diagnostics only — counts, never content. */
  cacheStats(): { entries: number; chars: number; limit: number } {
    return { entries: this.cache.size, chars: this.cachedChars, limit: MAX_CACHED_CHARS };
  }

  async put<T>(collection: string, id: string, value: T): Promise<void> {
    const key = this.key(collection, id);
    const payload = await encryptJson(this.dek, value);
    await this.adapter.putRecord({
      key,
      collection,
      payload,
      updatedAt: new Date().toISOString(),
    });
    // Invalidate rather than update: the caller may still hold and mutate
    // `value`, and a wrong cache entry is worse than a slower read.
    this.evict(key);
  }

  async get<T>(collection: string, id: string): Promise<T | undefined> {
    const key = this.key(collection, id);
    const envelope = await this.adapter.getRecord(key);
    if (!envelope) {
      this.evict(key);
      return undefined;
    }
    return this.materialize<T>(key, envelope.payload);
  }

  async getAll<T>(collection: string): Promise<T[]> {
    const envelopes = await this.adapter.getByCollection(collection);
    return Promise.all(envelopes.map((e) => this.materialize<T>(e.key, e.payload)));
  }

  async remove(collection: string, id: string): Promise<void> {
    const key = this.key(collection, id);
    await this.adapter.deleteRecord(key);
    this.evict(key);
  }

  async putBlob(id: string, bytes: Bytes): Promise<void> {
    const payload = await encryptBytes(this.dek, bytes);
    await this.adapter.putBlob({ id, payload });
  }

  async getBlob(id: string): Promise<Bytes | undefined> {
    const envelope = await this.adapter.getBlob(id);
    if (!envelope) return undefined;
    return decryptBytes(this.dek, envelope.payload);
  }

  async removeBlob(id: string): Promise<void> {
    await this.adapter.deleteBlob(id);
  }
}
