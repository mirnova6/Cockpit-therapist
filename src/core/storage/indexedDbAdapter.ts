/**
 * IndexedDB adapter — the only module that touches the persistence engine.
 * Swappable later for SQLite (Capacitor/Tauri) behind the same interface.
 *
 * Stores:
 *  - meta:    plaintext bootstrap data (key derivation params, wrapped keys,
 *             lockout counters, profile display name). Never contains PHI.
 *  - records: AES-GCM encrypted envelopes for every entity, keyed by
 *             `${collection}:${id}` with an index on collection.
 *  - blobs:   AES-GCM encrypted file attachments.
 */
import { openDB, type IDBPDatabase } from 'idb';
import type { EncryptedPayload } from '../crypto/cryptoService';

export interface RecordEnvelope {
  key: string; // `${collection}:${id}`
  collection: string;
  payload: EncryptedPayload;
  updatedAt: string;
}

export interface BlobEnvelope {
  id: string;
  payload: EncryptedPayload;
}

export interface StorageAdapter {
  getMeta<T>(key: string): Promise<T | undefined>;
  putMeta(key: string, value: unknown): Promise<void>;
  deleteMeta(key: string): Promise<void>;
  getAllMeta(): Promise<Array<{ key: string; value: unknown }>>;

  getRecord(key: string): Promise<RecordEnvelope | undefined>;
  putRecord(envelope: RecordEnvelope): Promise<void>;
  deleteRecord(key: string): Promise<void>;
  getByCollection(collection: string): Promise<RecordEnvelope[]>;
  getAllRecords(): Promise<RecordEnvelope[]>;

  getBlob(id: string): Promise<BlobEnvelope | undefined>;
  putBlob(envelope: BlobEnvelope): Promise<void>;
  deleteBlob(id: string): Promise<void>;
  getAllBlobs(): Promise<BlobEnvelope[]>;

  clearAll(): Promise<void>;
  close(): void;
}

const DB_VERSION = 1;

export class IndexedDbAdapter implements StorageAdapter {
  private constructor(private db: IDBPDatabase) {}

  static async open(name = 'cockpit-clinical'): Promise<IndexedDbAdapter> {
    const db = await openDB(name, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('meta')) {
          db.createObjectStore('meta', { keyPath: 'key' });
        }
        if (!db.objectStoreNames.contains('records')) {
          const records = db.createObjectStore('records', { keyPath: 'key' });
          records.createIndex('by-collection', 'collection');
        }
        if (!db.objectStoreNames.contains('blobs')) {
          db.createObjectStore('blobs', { keyPath: 'id' });
        }
      },
    });
    return new IndexedDbAdapter(db);
  }

  async getMeta<T>(key: string): Promise<T | undefined> {
    const row = await this.db.get('meta', key);
    return row ? (row.value as T) : undefined;
  }

  async putMeta(key: string, value: unknown): Promise<void> {
    await this.db.put('meta', { key, value });
  }

  async deleteMeta(key: string): Promise<void> {
    await this.db.delete('meta', key);
  }

  async getAllMeta(): Promise<Array<{ key: string; value: unknown }>> {
    return (await this.db.getAll('meta')) as Array<{ key: string; value: unknown }>;
  }

  async getRecord(key: string): Promise<RecordEnvelope | undefined> {
    return this.db.get('records', key) as Promise<RecordEnvelope | undefined>;
  }

  async putRecord(envelope: RecordEnvelope): Promise<void> {
    await this.db.put('records', envelope);
  }

  async deleteRecord(key: string): Promise<void> {
    await this.db.delete('records', key);
  }

  async getByCollection(collection: string): Promise<RecordEnvelope[]> {
    return this.db.getAllFromIndex('records', 'by-collection', collection) as Promise<
      RecordEnvelope[]
    >;
  }

  async getAllRecords(): Promise<RecordEnvelope[]> {
    return this.db.getAll('records') as Promise<RecordEnvelope[]>;
  }

  async getBlob(id: string): Promise<BlobEnvelope | undefined> {
    return this.db.get('blobs', id) as Promise<BlobEnvelope | undefined>;
  }

  async putBlob(envelope: BlobEnvelope): Promise<void> {
    await this.db.put('blobs', envelope);
  }

  async deleteBlob(id: string): Promise<void> {
    await this.db.delete('blobs', id);
  }

  async getAllBlobs(): Promise<BlobEnvelope[]> {
    return this.db.getAll('blobs') as Promise<BlobEnvelope[]>;
  }

  async clearAll(): Promise<void> {
    await Promise.all([
      this.db.clear('meta'),
      this.db.clear('records'),
      this.db.clear('blobs'),
    ]);
  }

  close(): void {
    this.db.close();
  }
}
