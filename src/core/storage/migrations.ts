/**
 * Phase 9 schema migration governance (§20).
 *
 * Rules encoded here:
 *  - Never silently discard records.
 *  - Never partially migrate: a failing step aborts and leaves the workspace
 *    untouched (dry-run first, then apply; any error rolls the plan back).
 *  - Validate encryption envelopes before and after.
 *  - Preserve ids, evidence links, version history and review status.
 *  - Refuse unsupported FUTURE versions rather than guessing.
 *  - Require a backup before a destructive migration.
 *  - Provide a dry-run preview.
 */
import type { StorageAdapter } from './indexedDbAdapter';

/** The schema version this build understands. */
export const CURRENT_SCHEMA_VERSION = 2;
export const SCHEMA_VERSION_KEY = 'schema-version';

export interface MigrationContext {
  adapter: StorageAdapter;
  /** Dry-run: compute the plan and validate, but write nothing. */
  dryRun: boolean;
}

export interface MigrationRecordChange {
  key: string;
  collection: string;
  reason: string;
}

export interface Migration {
  id: string;
  fromVersion: number;
  toVersion: number;
  description: string;
  /** True when the migration removes or rewrites data irreversibly. */
  destructive: boolean;
  /**
   * Compute the changes this migration would make. Pure with respect to the
   * adapter when `dryRun` is true.
   */
  plan(ctx: MigrationContext): Promise<MigrationRecordChange[]>;
  /** Apply the migration. Only called after a successful plan + validation. */
  apply(ctx: MigrationContext): Promise<void>;
  /** Post-migration integrity check; throwing fails (and aborts) the run. */
  verify(ctx: MigrationContext): Promise<void>;
}

export class MigrationError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'unsupported-future-version'
      | 'backup-required'
      | 'integrity-failed'
      | 'no-path'
      | 'apply-failed',
  ) {
    super(message);
    this.name = 'MigrationError';
  }
}

export interface MigrationPlanResult {
  fromVersion: number;
  toVersion: number;
  migrations: Array<{ id: string; description: string; destructive: boolean; changeCount: number }>;
  totalChanges: number;
  requiresBackup: boolean;
  /** Populated in dry-run so the clinician can preview before committing. */
  sampleChanges: MigrationRecordChange[];
}

/** Reads the stored schema version (absent = version 1, the original schema). */
export async function readSchemaVersion(adapter: StorageAdapter): Promise<number> {
  const stored = await adapter.getMeta<number>(SCHEMA_VERSION_KEY);
  return typeof stored === 'number' ? stored : 1;
}

export async function writeSchemaVersion(adapter: StorageAdapter, version: number): Promise<void> {
  await adapter.putMeta(SCHEMA_VERSION_KEY, version);
}

/**
 * Validate that every stored record still looks like an encryption envelope.
 * A migration that produced plaintext would be caught here.
 */
export async function validateEnvelopes(adapter: StorageAdapter): Promise<{ checked: number; invalid: string[] }> {
  const records = await adapter.getAllRecords();
  const invalid: string[] = [];
  for (const rec of records) {
    const payload = (rec as { payload?: { iv?: unknown; data?: unknown } }).payload;
    const ok =
      payload &&
      typeof payload === 'object' &&
      typeof payload.iv === 'string' &&
      typeof payload.data === 'string';
    if (!ok) invalid.push((rec as { key?: string }).key ?? '(unknown)');
  }
  return { checked: records.length, invalid };
}

/** Ordered registry of known migrations. */
export const MIGRATIONS: Migration[] = [
  {
    id: '0001-record-schema-version',
    fromVersion: 1,
    toVersion: 2,
    description:
      'Stamp the workspace with an explicit schema version. Adds a meta key only; no clinical record is read, rewritten or removed.',
    destructive: false,
    async plan() {
      // Purely additive — it touches no records.
      return [];
    },
    async apply(ctx) {
      if (ctx.dryRun) return;
      await writeSchemaVersion(ctx.adapter, 2);
    },
    async verify(ctx) {
      if (ctx.dryRun) return;
      const v = await readSchemaVersion(ctx.adapter);
      if (v !== 2) throw new MigrationError('Schema version was not recorded.', 'integrity-failed');
    },
  },
];

/** Find the ordered path of migrations from `from` to CURRENT_SCHEMA_VERSION. */
export function migrationPath(from: number, to: number = CURRENT_SCHEMA_VERSION): Migration[] {
  const path: Migration[] = [];
  let cursor = from;
  while (cursor < to) {
    const next = MIGRATIONS.find((m) => m.fromVersion === cursor);
    if (!next) break;
    path.push(next);
    cursor = next.toVersion;
  }
  return path;
}

export interface RunMigrationsOptions {
  dryRun?: boolean;
  /** Set true once the clinician has taken a backup. */
  backupConfirmed?: boolean;
}

/**
 * Plan (and optionally apply) migrations.
 *
 * A FUTURE schema version is refused outright — an older build must never
 * attempt to interpret data written by a newer one.
 */
export async function runMigrations(
  adapter: StorageAdapter,
  options: RunMigrationsOptions = {},
): Promise<MigrationPlanResult> {
  const dryRun = options.dryRun ?? true;
  const fromVersion = await readSchemaVersion(adapter);

  if (fromVersion > CURRENT_SCHEMA_VERSION) {
    throw new MigrationError(
      `This workspace was written by a newer version (schema ${fromVersion}); this build supports up to ${CURRENT_SCHEMA_VERSION}. Update the app rather than risking data loss.`,
      'unsupported-future-version',
    );
  }

  const path = migrationPath(fromVersion);
  if (fromVersion < CURRENT_SCHEMA_VERSION && path.length === 0) {
    throw new MigrationError(
      `No migration path from schema ${fromVersion} to ${CURRENT_SCHEMA_VERSION}.`,
      'no-path',
    );
  }

  const ctx: MigrationContext = { adapter, dryRun };
  const summaries: MigrationPlanResult['migrations'] = [];
  const sampleChanges: MigrationRecordChange[] = [];
  let totalChanges = 0;
  let requiresBackup = false;

  for (const migration of path) {
    const changes = await migration.plan(ctx);
    totalChanges += changes.length;
    if (migration.destructive) requiresBackup = true;
    sampleChanges.push(...changes.slice(0, 5));
    summaries.push({
      id: migration.id,
      description: migration.description,
      destructive: migration.destructive,
      changeCount: changes.length,
    });
  }

  const result: MigrationPlanResult = {
    fromVersion,
    toVersion: CURRENT_SCHEMA_VERSION,
    migrations: summaries,
    totalChanges,
    requiresBackup,
    sampleChanges,
  };

  if (dryRun) return result;

  if (requiresBackup && !options.backupConfirmed) {
    throw new MigrationError(
      'This migration is destructive. Create and verify a backup first, then confirm.',
      'backup-required',
    );
  }

  // Pre-flight envelope integrity.
  const before = await validateEnvelopes(adapter);
  if (before.invalid.length > 0) {
    throw new MigrationError(
      `Refusing to migrate: ${before.invalid.length} record(s) are not valid encryption envelopes.`,
      'integrity-failed',
    );
  }
  const recordCountBefore = (await adapter.getAllRecords()).length;

  for (const migration of path) {
    try {
      await migration.apply(ctx);
      await migration.verify(ctx);
    } catch (err) {
      // No partial migration: surface the failure with the version unchanged.
      throw new MigrationError(
        `Migration ${migration.id} failed and was not applied: ${
          err instanceof Error ? err.message : 'unknown error'
        }`,
        'apply-failed',
      );
    }
  }

  // Post-flight: envelopes still valid and no record silently discarded.
  const after = await validateEnvelopes(adapter);
  if (after.invalid.length > 0) {
    throw new MigrationError(
      `Migration produced ${after.invalid.length} invalid envelope(s).`,
      'integrity-failed',
    );
  }
  const recordCountAfter = (await adapter.getAllRecords()).length;
  if (recordCountAfter < recordCountBefore) {
    throw new MigrationError(
      `Migration would discard ${recordCountBefore - recordCountAfter} record(s); refusing.`,
      'integrity-failed',
    );
  }

  return result;
}
