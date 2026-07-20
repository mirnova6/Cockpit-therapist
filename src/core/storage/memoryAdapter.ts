/**
 * In-memory StorageAdapter — used by the Phase 5 evaluation sandbox.
 *
 * Nothing is ever persisted: the maps live only for the current session and
 * are discarded on close/lock/reload. Combined with an ephemeral data key,
 * this guarantees fictional evaluation clients can never mix with the real
 * client database and never touch IndexedDB at all.
 */
import type { BlobEnvelope, RecordEnvelope, StorageAdapter } from './indexedDbAdapter';

export class MemoryAdapter implements StorageAdapter {
  private meta = new Map<string, unknown>();
  private records = new Map<string, RecordEnvelope>();
  private blobs = new Map<string, BlobEnvelope>();

  async getMeta<T>(key: string): Promise<T | undefined> {
    return this.meta.get(key) as T | undefined;
  }

  async putMeta(key: string, value: unknown): Promise<void> {
    this.meta.set(key, value);
  }

  async deleteMeta(key: string): Promise<void> {
    this.meta.delete(key);
  }

  async getAllMeta(): Promise<Array<{ key: string; value: unknown }>> {
    return [...this.meta.entries()].map(([key, value]) => ({ key, value }));
  }

  async getRecord(key: string): Promise<RecordEnvelope | undefined> {
    return this.records.get(key);
  }

  async putRecord(envelope: RecordEnvelope): Promise<void> {
    this.records.set(envelope.key, envelope);
  }

  async deleteRecord(key: string): Promise<void> {
    this.records.delete(key);
  }

  async getByCollection(collection: string): Promise<RecordEnvelope[]> {
    return [...this.records.values()].filter((r) => r.collection === collection);
  }

  async getAllRecords(): Promise<RecordEnvelope[]> {
    return [...this.records.values()];
  }

  async getBlob(id: string): Promise<BlobEnvelope | undefined> {
    return this.blobs.get(id);
  }

  async putBlob(envelope: BlobEnvelope): Promise<void> {
    this.blobs.set(envelope.id, envelope);
  }

  async deleteBlob(id: string): Promise<void> {
    this.blobs.delete(id);
  }

  async getAllBlobs(): Promise<BlobEnvelope[]> {
    return [...this.blobs.values()];
  }

  async clearAll(): Promise<void> {
    this.meta.clear();
    this.records.clear();
    this.blobs.clear();
  }

  close(): void {
    void this.clearAll();
  }
}
