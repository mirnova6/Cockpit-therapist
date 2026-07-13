/**
 * Backup service — exports the workspace as an encrypted snapshot.
 *
 * The backup contains the meta keyring plus every encrypted record/blob
 * envelope exactly as stored: it is unreadable without the passphrase that
 * protected the workspace when the backup was created. Restore replaces the
 * entire local workspace.
 *
 * A separate, clinician-initiated plaintext export of a single client record
 * lives in the data store (with an explicit warning in the UI), per the
 * spec's clinician-controlled export requirement.
 */
import type { StorageAdapter } from '../storage/indexedDbAdapter';

export interface WorkspaceBackup {
  format: 'cockpit-encrypted-backup';
  version: 1;
  createdAt: string;
  meta: Array<{ key: string; value: unknown }>;
  records: Array<{
    key: string;
    collection: string;
    payload: { iv: string; data: string };
    updatedAt: string;
  }>;
  blobs: Array<{ id: string; payload: { iv: string; data: string } }>;
}

export async function createBackup(adapter: StorageAdapter): Promise<WorkspaceBackup> {
  const [meta, records, blobs] = await Promise.all([
    adapter.getAllMeta(),
    adapter.getAllRecords(),
    adapter.getAllBlobs(),
  ]);
  return {
    format: 'cockpit-encrypted-backup',
    version: 1,
    createdAt: new Date().toISOString(),
    meta,
    records,
    blobs,
  };
}

export function isValidBackup(value: unknown): value is WorkspaceBackup {
  if (!value || typeof value !== 'object') return false;
  const backup = value as Partial<WorkspaceBackup>;
  return (
    backup.format === 'cockpit-encrypted-backup' &&
    backup.version === 1 &&
    Array.isArray(backup.meta) &&
    Array.isArray(backup.records) &&
    Array.isArray(backup.blobs)
  );
}

/** Replaces the entire workspace with the backup contents. */
export async function restoreBackup(
  adapter: StorageAdapter,
  backup: WorkspaceBackup,
): Promise<void> {
  if (!isValidBackup(backup)) throw new Error('Not a valid Cockpit backup file');
  await adapter.clearAll();
  for (const entry of backup.meta) await adapter.putMeta(entry.key, entry.value);
  for (const record of backup.records) await adapter.putRecord(record);
  for (const blob of backup.blobs) await adapter.putBlob(blob);
}
