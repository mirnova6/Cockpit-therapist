/**
 * EncryptedStore — typed, collection-oriented persistence where every value
 * is AES-GCM encrypted with the session DEK before it reaches the adapter.
 * Repositories never see ciphertext; the adapter never sees plaintext.
 */
import {
  decryptBytes,
  decryptJson,
  encryptBytes,
  encryptJson,
  type Bytes,
} from '../crypto/cryptoService';
import type { StorageAdapter } from './indexedDbAdapter';

export class EncryptedStore {
  constructor(
    private adapter: StorageAdapter,
    private dek: CryptoKey,
  ) {}

  private key(collection: string, id: string): string {
    return `${collection}:${id}`;
  }

  async put<T>(collection: string, id: string, value: T): Promise<void> {
    const payload = await encryptJson(this.dek, value);
    await this.adapter.putRecord({
      key: this.key(collection, id),
      collection,
      payload,
      updatedAt: new Date().toISOString(),
    });
  }

  async get<T>(collection: string, id: string): Promise<T | undefined> {
    const envelope = await this.adapter.getRecord(this.key(collection, id));
    if (!envelope) return undefined;
    return decryptJson<T>(this.dek, envelope.payload);
  }

  async getAll<T>(collection: string): Promise<T[]> {
    const envelopes = await this.adapter.getByCollection(collection);
    return Promise.all(envelopes.map((e) => decryptJson<T>(this.dek, e.payload)));
  }

  async remove(collection: string, id: string): Promise<void> {
    await this.adapter.deleteRecord(this.key(collection, id));
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
