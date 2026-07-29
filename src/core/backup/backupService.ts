/**
 * Backup service — exports the workspace as an encrypted snapshot.
 *
 * The backup contains the meta keyring plus every encrypted record/blob
 * envelope exactly as stored: it is unreadable without the passphrase that
 * protected the workspace when the backup was created. Restore replaces the
 * entire local workspace.
 *
 * Phase 6 hardening (format v2):
 *  - a SHA-256 content checksum for corruption detection,
 *  - an app/schema version stamp and record/blob/collection counts for a
 *    restore preview and compatibility check,
 *  - inspect/dry-run so the clinician sees exactly what a file contains and
 *    whether it will restore BEFORE anything is overwritten,
 *  - partial restore is refused: a corrupt or incompatible file never
 *    half-replaces the workspace.
 * v1 backups remain fully restorable (no checksum was present then).
 *
 * A separate, clinician-initiated plaintext export of a single client record
 * lives in the data store (with an explicit warning in the UI).
 */
import type { StorageAdapter } from '../storage/indexedDbAdapter';

/** Bump when the on-disk schema changes in a way that affects restore. */
export const BACKUP_SCHEMA_VERSION = '2026-07-p6';

interface RecordEntry {
  key: string;
  collection: string;
  payload: { iv: string; data: string };
  updatedAt: string;
}
interface BlobEntry {
  id: string;
  payload: { iv: string; data: string };
}

interface BackupBody {
  meta: Array<{ key: string; value: unknown }>;
  records: RecordEntry[];
  blobs: BlobEntry[];
}

export interface WorkspaceBackup extends BackupBody {
  format: 'cockpit-encrypted-backup';
  /** 1 = legacy (no checksum). 2 = hardened. */
  version: 1 | 2;
  createdAt: string;
  // ---- v2 fields (absent on v1) ----
  schemaVersion?: string;
  /** SHA-256 (hex) over the canonical body. */
  checksum?: string;
  counts?: {
    meta: number;
    records: number;
    blobs: number;
    byCollection: Record<string, number>;
    hasKeyring: boolean;
  };
}

// ---------------------------------------------------------- checksum

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Deterministic serialization of the body so the checksum is stable. */
function canonicalBody(body: BackupBody): string {
  const meta = [...body.meta].sort((a, b) => a.key.localeCompare(b.key));
  const records = [...body.records].sort((a, b) => a.key.localeCompare(b.key));
  const blobs = [...body.blobs].sort((a, b) => a.id.localeCompare(b.id));
  return JSON.stringify({ meta, records, blobs });
}

function countCollections(records: RecordEntry[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const record of records) out[record.collection] = (out[record.collection] ?? 0) + 1;
  return out;
}

// ------------------------------------------------------------ create

export async function createBackup(adapter: StorageAdapter): Promise<WorkspaceBackup> {
  const [meta, records, blobs] = await Promise.all([
    adapter.getAllMeta(),
    adapter.getAllRecords(),
    adapter.getAllBlobs(),
  ]);
  const body: BackupBody = { meta, records, blobs };
  const checksum = await sha256Hex(canonicalBody(body));
  return {
    format: 'cockpit-encrypted-backup',
    version: 2,
    createdAt: new Date().toISOString(),
    schemaVersion: BACKUP_SCHEMA_VERSION,
    checksum,
    counts: {
      meta: meta.length,
      records: records.length,
      blobs: blobs.length,
      byCollection: countCollections(records),
      hasKeyring: meta.some((m) => m.key === 'keyring'),
    },
    meta,
    records,
    blobs,
  };
}

// ------------------------------------------------------------ validate

export function isValidBackup(value: unknown): value is WorkspaceBackup {
  if (!value || typeof value !== 'object') return false;
  const backup = value as Partial<WorkspaceBackup>;
  return (
    backup.format === 'cockpit-encrypted-backup' &&
    (backup.version === 1 || backup.version === 2) &&
    Array.isArray(backup.meta) &&
    Array.isArray(backup.records) &&
    Array.isArray(backup.blobs)
  );
}

// ------------------------------------------------------------ inspect

export interface BackupInspection {
  valid: boolean;
  /** Reasons the file cannot be restored (empty when restorable). */
  blockers: string[];
  /** Non-blocking cautions. */
  warnings: string[];
  version: 1 | 2 | 'unknown';
  createdAt?: string;
  schemaVersion?: string;
  counts: {
    meta: number;
    records: number;
    blobs: number;
    byCollection: Record<string, number>;
    hasKeyring: boolean;
  };
  checksumStatus: 'valid' | 'mismatch' | 'absent-legacy';
  compatible: boolean;
}

/**
 * Examines a parsed backup WITHOUT touching the workspace: structure,
 * checksum, counts, keyring presence, and forward/backward compatibility.
 * The UI shows this as a restore preview.
 */
export async function inspectBackup(value: unknown): Promise<BackupInspection> {
  const blockers: string[] = [];
  const warnings: string[] = [];
  const emptyCounts = { meta: 0, records: 0, blobs: 0, byCollection: {}, hasKeyring: false };

  if (!isValidBackup(value)) {
    return {
      valid: false,
      blockers: ['This is not a valid Cockpit backup file (wrong format or structure).'],
      warnings: [],
      version: 'unknown',
      counts: emptyCounts,
      checksumStatus: 'absent-legacy',
      compatible: false,
    };
  }

  const backup = value;
  const body: BackupBody = { meta: backup.meta, records: backup.records, blobs: backup.blobs };
  const counts = {
    meta: backup.meta.length,
    records: backup.records.length,
    blobs: backup.blobs.length,
    byCollection: countCollections(backup.records),
    hasKeyring: backup.meta.some((m) => m.key === 'keyring'),
  };

  // Corruption detection via checksum (v2 only).
  let checksumStatus: BackupInspection['checksumStatus'] = 'absent-legacy';
  if (backup.version === 2 && backup.checksum) {
    const computed = await sha256Hex(canonicalBody(body));
    if (computed === backup.checksum) {
      checksumStatus = 'valid';
    } else {
      checksumStatus = 'mismatch';
      blockers.push('Checksum mismatch — the backup file appears corrupted or was modified. Restore is refused.');
    }
  } else if (backup.version === 1) {
    warnings.push('Legacy backup (v1) has no integrity checksum; corruption cannot be detected automatically.');
  }

  // Structural sanity: entries must carry ciphertext envelopes.
  const badRecord = backup.records.find((r) => !r.payload?.iv || !r.payload?.data);
  if (badRecord) blockers.push('One or more records are missing ciphertext — the file is incomplete or corrupt.');
  const badBlob = backup.blobs.find((b) => !b.payload?.iv || !b.payload?.data);
  if (badBlob) blockers.push('One or more attachments are missing ciphertext — the file is incomplete or corrupt.');

  // A restorable workspace needs its keyring (to unlock afterwards).
  if (!counts.hasKeyring) {
    blockers.push('The backup has no keyring — it cannot be unlocked after restore. Restore is refused.');
  }

  // Compatibility: this build understands v1 and v2. Unknown future schema
  // versions are a caution, not a hard block (envelopes still restore).
  let compatible = true;
  if (backup.version === 2 && backup.schemaVersion && backup.schemaVersion !== BACKUP_SCHEMA_VERSION) {
    warnings.push(
      `Backup schema "${backup.schemaVersion}" differs from this app ("${BACKUP_SCHEMA_VERSION}"). Encrypted records will restore, but review the app version.`,
    );
  }
  if (backup.version === 2 && backup.schemaVersion === undefined) {
    warnings.push('v2 backup is missing its schema stamp; treating as compatible.');
  }
  void compatible;
  compatible = blockers.length === 0;

  return {
    valid: blockers.length === 0,
    blockers,
    warnings,
    version: backup.version,
    createdAt: backup.createdAt,
    schemaVersion: backup.schemaVersion,
    counts,
    checksumStatus,
    compatible,
  };
}

// ------------------------------------------------------------ restore

export class RestoreError extends Error {
  constructor(
    message: string,
    readonly inspection: BackupInspection,
  ) {
    super(message);
    this.name = 'RestoreError';
  }
}

export interface RestoreOptions {
  /** Validate and report only; never writes. */
  dryRun?: boolean;
}

export interface RestoreResult {
  dryRun: boolean;
  inspection: BackupInspection;
  restored: { meta: number; records: number; blobs: number };
}

/**
 * Replaces the entire workspace with the backup contents. Refuses partial
 * restore: the file is fully inspected first, and any blocker aborts BEFORE
 * `clearAll`, so a corrupt file never leaves the workspace half-wiped.
 * `dryRun` performs every check without writing.
 */
export async function restoreBackup(
  adapter: StorageAdapter,
  backup: WorkspaceBackup,
  options: RestoreOptions = {},
): Promise<RestoreResult> {
  const inspection = await inspectBackup(backup);
  if (!inspection.valid) {
    throw new RestoreError(
      `Restore refused: ${inspection.blockers.join(' ')}`,
      inspection,
    );
  }
  const restored = {
    meta: backup.meta.length,
    records: backup.records.length,
    blobs: backup.blobs.length,
  };
  if (options.dryRun) {
    return { dryRun: true, inspection, restored };
  }
  await adapter.clearAll();
  for (const entry of backup.meta) await adapter.putMeta(entry.key, entry.value);
  for (const record of backup.records) await adapter.putRecord(record);
  for (const blob of backup.blobs) await adapter.putBlob(blob);
  return { dryRun: false, inspection, restored };
}
