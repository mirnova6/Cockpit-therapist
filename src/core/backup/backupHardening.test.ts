import { afterEach, describe, expect, it } from 'vitest';
import { AuthService } from '../auth/authService';
import { IndexedDbAdapter } from '../storage/indexedDbAdapter';
import {
  BACKUP_SCHEMA_VERSION,
  createBackup,
  inspectBackup,
  restoreBackup,
  RestoreError,
  type WorkspaceBackup,
} from './backupService';

let counter = 0;
const services: AuthService[] = [];

function makeService(dbName: string): AuthService {
  const service = new AuthService({ dbName, iterations: 1000 });
  services.push(service);
  return service;
}

afterEach(async () => {
  while (services.length) await services.pop()?.close();
});

async function seededBackup(pass = 'hardening-pass'): Promise<{ backup: WorkspaceBackup; name: string }> {
  const name = `harden-src-${Date.now()}-${counter++}`;
  const auth = makeService(name);
  const db = await auth.setup({ name: 'Dr. Osei', passphrase: pass });
  const client = await db.createClient(
    { displayName: 'H.D.', contactEnabled: false, levelOfCare: 'outpatient', status: 'active', diagnoses: [], medications: [], risk: { level: 'low' } },
    'Dr. Osei',
  );
  await db.createInput(
    { clientId: client.id, inputType: 'rough-notes', dateOfInformation: '2026-07-01', rawText: 'note', authorSource: 'Dr. Osei', reportedBy: 'therapist-entered', containsRisk: false, allowAiAnalysis: true, localOnly: true },
    [],
    'Dr. Osei',
  );
  const backup = JSON.parse(JSON.stringify(await createBackup(db.adapter))) as WorkspaceBackup;
  return { backup, name };
}

describe('backup format v2', () => {
  it('stamps schema version, checksum, and counts', async () => {
    const { backup } = await seededBackup();
    expect(backup.version).toBe(2);
    expect(backup.schemaVersion).toBe(BACKUP_SCHEMA_VERSION);
    expect(backup.checksum).toMatch(/^[0-9a-f]{64}$/);
    expect(backup.counts?.hasKeyring).toBe(true);
    expect(backup.counts?.records).toBe(backup.records.length);
    expect(backup.counts?.byCollection.clients).toBe(1);
  });
});

describe('inspectBackup (restore preview)', () => {
  it('verifies a good backup with counts and valid checksum', async () => {
    const { backup } = await seededBackup();
    const inspection = await inspectBackup(backup);
    expect(inspection.valid).toBe(true);
    expect(inspection.blockers).toHaveLength(0);
    expect(inspection.checksumStatus).toBe('valid');
    expect(inspection.counts.hasKeyring).toBe(true);
    expect(inspection.compatible).toBe(true);
  });

  it('detects corruption via checksum mismatch and refuses restore', async () => {
    const { backup } = await seededBackup();
    // Tamper with an encrypted payload after the checksum was computed.
    backup.records[0].payload.data = `${backup.records[0].payload.data}TAMPER`;
    const inspection = await inspectBackup(backup);
    expect(inspection.checksumStatus).toBe('mismatch');
    expect(inspection.valid).toBe(false);
    expect(inspection.blockers.join(' ')).toMatch(/corrupt/i);

    const target = await IndexedDbAdapter.open(`harden-dst-${Date.now()}-${counter++}`);
    await expect(restoreBackup(target, backup)).rejects.toBeInstanceOf(RestoreError);
    target.close();
  });

  it('refuses a backup with no keyring (cannot be unlocked afterward)', async () => {
    const { backup } = await seededBackup();
    backup.meta = backup.meta.filter((m) => m.key !== 'keyring');
    // Recompute nothing — inspection checks structure independently.
    const inspection = await inspectBackup(backup);
    expect(inspection.counts.hasKeyring).toBe(false);
    expect(inspection.valid).toBe(false);
    expect(inspection.blockers.join(' ')).toMatch(/keyring/i);
  });

  it('flags incomplete records (missing ciphertext)', async () => {
    const { backup } = await seededBackup();
    backup.records[0].payload = { iv: '', data: '' };
    const inspection = await inspectBackup(backup);
    expect(inspection.valid).toBe(false);
    expect(inspection.blockers.join(' ')).toMatch(/missing ciphertext/i);
  });

  it('rejects non-backup files', async () => {
    expect((await inspectBackup(null)).valid).toBe(false);
    expect((await inspectBackup({ format: 'nope' })).valid).toBe(false);
  });
});

describe('restore hardening', () => {
  it('dry-run validates without writing anything', async () => {
    const { backup } = await seededBackup();
    const target = await IndexedDbAdapter.open(`harden-dry-${Date.now()}-${counter++}`);
    const result = await restoreBackup(target, backup, { dryRun: true });
    expect(result.dryRun).toBe(true);
    expect(result.restored.records).toBe(backup.records.length);
    // Nothing was written by the dry run.
    expect(await target.getAllRecords()).toHaveLength(0);
    target.close();
  });

  it('refuses PARTIAL restore: a corrupt file never half-wipes an existing workspace', async () => {
    // Existing workspace with data.
    const existingName = `harden-existing-${Date.now()}-${counter++}`;
    const existingAuth = makeService(existingName);
    const existingDb = await existingAuth.setup({ name: 'Dr. Keep', passphrase: 'keep-pass' });
    await existingDb.createClient(
      { displayName: 'KEEP.ME', contactEnabled: false, levelOfCare: 'outpatient', status: 'active', diagnoses: [], medications: [], risk: { level: 'low' } },
      'Dr. Keep',
    );
    const beforeCount = (await existingDb.adapter.getAllRecords()).length;

    const { backup } = await seededBackup();
    backup.checksum = 'deadbeef'.repeat(8); // guaranteed mismatch
    await expect(restoreBackup(existingDb.adapter, backup)).rejects.toBeInstanceOf(RestoreError);
    // The existing workspace is untouched — clearAll never ran.
    expect((await existingDb.adapter.getAllRecords()).length).toBe(beforeCount);
    expect((await existingDb.listClients())[0].displayName).toBe('KEEP.ME');
  });

  it('a valid v2 backup restores and re-unlocks with cross-client isolation intact', async () => {
    const { backup } = await seededBackup('roundtrip-pass');
    const targetName = `harden-rt-${Date.now()}-${counter++}`;
    const targetAuth = makeService(targetName);
    const target = await IndexedDbAdapter.open(targetName);
    const result = await restoreBackup(target, backup);
    target.close();
    expect(result.dryRun).toBe(false);

    const restored = await targetAuth.unlockWithPassphrase('roundtrip-pass');
    const clients = await restored.listClients();
    expect(clients).toHaveLength(1);
    expect(clients[0].displayName).toBe('H.D.');
    // Isolation: an unrelated id yields nothing.
    expect(await restored.listInputsForClient('no-such-client')).toHaveLength(0);
  });
});
