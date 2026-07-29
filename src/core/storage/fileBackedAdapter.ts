/**
 * File-backed StorageAdapter (Phase 6) — the durable-storage implementation
 * for native shells.
 *
 * It stores the SAME AES-GCM encrypted envelopes as the IndexedDB adapter,
 * one JSON file per record/blob plus plaintext-free meta files, beneath a
 * data directory chosen by the native shell (a backup-safe app-data
 * directory on desktop; the app sandbox on mobile). Nothing about the
 * encryption model changes: files on disk are ciphertext envelopes only.
 *
 * The adapter is written against the small FileStore interface so it is
 * fully testable today (MemoryFileStore) and bindable to native bridges
 * (Tauri fs plugin, Capacitor Filesystem) without touching this logic.
 * Large transcripts/attachments are naturally supported because each
 * envelope is its own file — no single-database size ceiling.
 */
import type { BlobEnvelope, RecordEnvelope, StorageAdapter } from './indexedDbAdapter';

/** Minimal file operations a native shell must provide. */
export interface FileStore {
  read(path: string): Promise<string | undefined>;
  write(path: string, content: string): Promise<void>;
  /** Secure deletion at this layer = remove the ciphertext file. */
  remove(path: string): Promise<void>;
  /** Lists file paths under a directory prefix (non-recursive). */
  list(dirPrefix: string): Promise<string[]>;
}

/** In-memory FileStore for tests and for exercising the adapter contract. */
export class MemoryFileStore implements FileStore {
  files = new Map<string, string>();

  async read(path: string): Promise<string | undefined> {
    return this.files.get(path);
  }

  async write(path: string, content: string): Promise<void> {
    this.files.set(path, content);
  }

  async remove(path: string): Promise<void> {
    this.files.delete(path);
  }

  async list(dirPrefix: string): Promise<string[]> {
    return [...this.files.keys()].filter((p) => p.startsWith(dirPrefix));
  }
}

/** Base64url-encodes a key so any collection/id is filesystem-safe. */
function fileNameFor(key: string): string {
  const bytes = new TextEncoder().encode(key);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

const DIR = { meta: 'meta/', records: 'records/', blobs: 'blobs/' } as const;

export class FileBackedAdapter implements StorageAdapter {
  constructor(private fs: FileStore) {}

  // -------------------------------------------------------------- meta

  // The meta store carries key-derivation material (salts, wrapped keys) as
  // Uint8Array in the browser adapter; files serialize those explicitly via
  // the replacer/reviver so unlock still works. getMeta returns the VALUE
  // (not the {key,value} envelope), matching IndexedDbAdapter exactly.
  async getMeta<T>(key: string): Promise<T | undefined> {
    const raw = await this.fs.read(`${DIR.meta}${fileNameFor(key)}.json`);
    if (raw === undefined) return undefined;
    return (JSON.parse(raw, reviver) as { key: string; value: T }).value;
  }

  async putMeta(key: string, value: unknown): Promise<void> {
    await this.fs.write(`${DIR.meta}${fileNameFor(key)}.json`, JSON.stringify({ key, value }, replacer));
  }

  async deleteMeta(key: string): Promise<void> {
    await this.fs.remove(`${DIR.meta}${fileNameFor(key)}.json`);
  }

  async getAllMeta(): Promise<Array<{ key: string; value: unknown }>> {
    const out: Array<{ key: string; value: unknown }> = [];
    for (const path of await this.fs.list(DIR.meta)) {
      const raw = await this.fs.read(path);
      if (raw !== undefined) out.push(JSON.parse(raw, reviver) as { key: string; value: unknown });
    }
    return out;
  }

  // ------------------------------------------------------------ records

  async getRecord(key: string): Promise<RecordEnvelope | undefined> {
    const raw = await this.fs.read(`${DIR.records}${fileNameFor(key)}.json`);
    return raw === undefined ? undefined : (JSON.parse(raw, reviver) as RecordEnvelope);
  }

  async putRecord(envelope: RecordEnvelope): Promise<void> {
    await this.fs.write(`${DIR.records}${fileNameFor(envelope.key)}.json`, JSON.stringify(envelope, replacer));
  }

  async deleteRecord(key: string): Promise<void> {
    await this.fs.remove(`${DIR.records}${fileNameFor(key)}.json`);
  }

  async getByCollection(collection: string): Promise<RecordEnvelope[]> {
    return (await this.getAllRecords()).filter((r) => r.collection === collection);
  }

  async getAllRecords(): Promise<RecordEnvelope[]> {
    const out: RecordEnvelope[] = [];
    for (const path of await this.fs.list(DIR.records)) {
      const raw = await this.fs.read(path);
      if (raw !== undefined) out.push(JSON.parse(raw, reviver) as RecordEnvelope);
    }
    return out;
  }

  // -------------------------------------------------------------- blobs

  async getBlob(id: string): Promise<BlobEnvelope | undefined> {
    const raw = await this.fs.read(`${DIR.blobs}${fileNameFor(id)}.json`);
    return raw === undefined ? undefined : (JSON.parse(raw, reviver) as BlobEnvelope);
  }

  async putBlob(envelope: BlobEnvelope): Promise<void> {
    await this.fs.write(`${DIR.blobs}${fileNameFor(envelope.id)}.json`, JSON.stringify(envelope, replacer));
  }

  async deleteBlob(id: string): Promise<void> {
    await this.fs.remove(`${DIR.blobs}${fileNameFor(id)}.json`);
  }

  async getAllBlobs(): Promise<BlobEnvelope[]> {
    const out: BlobEnvelope[] = [];
    for (const path of await this.fs.list(DIR.blobs)) {
      const raw = await this.fs.read(path);
      if (raw !== undefined) out.push(JSON.parse(raw, reviver) as BlobEnvelope);
    }
    return out;
  }

  async clearAll(): Promise<void> {
    for (const dir of Object.values(DIR)) {
      for (const path of await this.fs.list(dir)) await this.fs.remove(path);
    }
  }

  close(): void {
    // Files need no handle; nothing to close.
  }
}

/**
 * JSON serialization for envelopes: EncryptedPayload fields and meta values
 * may contain Uint8Array (salts, wrapped keys, ciphertext). Files store
 * them as tagged base64 strings and restore them symmetrically.
 */
function replacer(this: unknown, _key: string, value: unknown): unknown {
  if (value instanceof Uint8Array) {
    let binary = '';
    for (const b of value) binary += String.fromCharCode(b);
    return { __u8: btoa(binary) };
  }
  return value;
}

function reviver(this: unknown, _key: string, value: unknown): unknown {
  if (value && typeof value === 'object' && '__u8' in (value as Record<string, unknown>)) {
    const binary = atob((value as { __u8: string }).__u8);
    const bytes = new Uint8Array(new ArrayBuffer(binary.length));
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }
  return value;
}
