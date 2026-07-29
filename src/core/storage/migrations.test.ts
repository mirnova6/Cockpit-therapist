import { afterEach, describe, expect, it } from 'vitest';
import { AuthService } from '../auth/authService';
import { createBackup, restoreBackup } from '../backup/backupService';
import {
  CURRENT_SCHEMA_VERSION,
  MigrationError,
  migrationPath,
  readSchemaVersion,
  runMigrations,
  validateEnvelopes,
  writeSchemaVersion,
} from './migrations';

let counter = 0;
const services: AuthService[] = [];

afterEach(async () => {
  while (services.length) await services.pop()?.close();
});

async function workspace(name: string) {
  const auth = new AuthService({ dbName: `${name}-${Date.now()}-${counter++}`, iterations: 1000 });
  services.push(auth);
  const db = await auth.setup({ name: 'Dr. Mig', passphrase: 'migration-passphrase' }); // secret-scan-allow: fixture value, not a real secret
  await db.createClient(
    { displayName: 'MIG.A', contactEnabled: false, levelOfCare: 'outpatient', status: 'active', diagnoses: [], medications: [], risk: { level: 'low' } },
    'Dr. Mig',
  );
  return { auth, db };
}

describe('schema version handling', () => {
  it('treats an unversioned workspace as version 1', async () => {
    const { db } = await workspace('mig-v1');
    expect(await readSchemaVersion(db.adapter)).toBe(1);
  });

  it('refuses a workspace written by a NEWER build rather than guessing', async () => {
    const { db } = await workspace('mig-future');
    await writeSchemaVersion(db.adapter, CURRENT_SCHEMA_VERSION + 5);
    await expect(runMigrations(db.adapter, { dryRun: false })).rejects.toMatchObject({
      code: 'unsupported-future-version',
    });
  });

  it('computes an ordered migration path', () => {
    const path = migrationPath(1, CURRENT_SCHEMA_VERSION);
    expect(path.length).toBeGreaterThan(0);
    expect(path[0].fromVersion).toBe(1);
    expect(path[path.length - 1].toVersion).toBe(CURRENT_SCHEMA_VERSION);
  });
});

describe('dry-run preview does not modify the workspace', () => {
  it('reports the plan while leaving the version and records untouched', async () => {
    const { db } = await workspace('mig-dry');
    const before = await readSchemaVersion(db.adapter);
    const recordsBefore = (await db.adapter.getAllRecords()).length;

    const plan = await runMigrations(db.adapter, { dryRun: true });
    expect(plan.fromVersion).toBe(before);
    expect(plan.toVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(plan.migrations.length).toBeGreaterThan(0);

    // Nothing changed.
    expect(await readSchemaVersion(db.adapter)).toBe(before);
    expect((await db.adapter.getAllRecords()).length).toBe(recordsBefore);
  });
});

describe('applying migrations', () => {
  it('migrates to the current version and preserves every record', async () => {
    const { db } = await workspace('mig-apply');
    const clientsBefore = await db.listClients();
    const recordsBefore = (await db.adapter.getAllRecords()).length;

    await runMigrations(db.adapter, { dryRun: false });

    expect(await readSchemaVersion(db.adapter)).toBe(CURRENT_SCHEMA_VERSION);
    const clientsAfter = await db.listClients();
    expect(clientsAfter).toHaveLength(clientsBefore.length);
    expect(clientsAfter[0].id).toBe(clientsBefore[0].id); // ids preserved
    expect((await db.adapter.getAllRecords()).length).toBe(recordsBefore);
  });

  it('is a no-op once already at the current version', async () => {
    const { db } = await workspace('mig-idempotent');
    await runMigrations(db.adapter, { dryRun: false });
    const plan = await runMigrations(db.adapter, { dryRun: false });
    expect(plan.migrations).toHaveLength(0);
    expect(await readSchemaVersion(db.adapter)).toBe(CURRENT_SCHEMA_VERSION);
  });
});

describe('encryption envelope integrity', () => {
  it('validates that all records remain encrypted envelopes', async () => {
    const { db } = await workspace('mig-env');
    const result = await validateEnvelopes(db.adapter);
    expect(result.checked).toBeGreaterThan(0);
    expect(result.invalid).toEqual([]);
  });

  it('detects a record that is not a valid envelope and refuses to migrate', async () => {
    const { db } = await workspace('mig-bad');
    // Plant a record whose payload is plaintext rather than an envelope.
    await db.adapter.putRecord({
      key: 'tampered:1',
      collection: 'tampered',
      payload: { plaintext: 'Client reported low mood' } as never,
      updatedAt: new Date().toISOString(),
    });
    const check = await validateEnvelopes(db.adapter);
    expect(check.invalid).toContain('tampered:1');

    await writeSchemaVersion(db.adapter, 1);
    await expect(runMigrations(db.adapter, { dryRun: false })).rejects.toMatchObject({
      code: 'integrity-failed',
    });
    // Version unchanged — no partial migration.
    expect(await readSchemaVersion(db.adapter)).toBe(1);
  });
});

describe('backup interoperability', () => {
  it('restores a backup taken after migration and keeps data intact', async () => {
    const { db } = await workspace('mig-backup');
    await runMigrations(db.adapter, { dryRun: false });
    const backup = JSON.parse(JSON.stringify(await createBackup(db.adapter)));

    const target = new AuthService({ dbName: `mig-restore-${Date.now()}-${counter++}`, iterations: 1000 });
    services.push(target);
    // Restore into a fresh adapter, then unlock with the same passphrase.
    const fresh = await workspace('mig-restore-src');
    await restoreBackup(fresh.db.adapter, backup);
    const restored = await fresh.auth.unlockWithPassphrase('migration-passphrase');
    const clients = await restored.listClients();
    expect(clients.map((c) => c.displayName)).toContain('MIG.A');
  });
});

describe('MigrationError', () => {
  it('carries a machine-readable code', () => {
    const err = new MigrationError('x', 'backup-required');
    expect(err.code).toBe('backup-required');
    expect(err.name).toBe('MigrationError');
  });
});
