import { afterEach, describe, expect, it } from 'vitest';
import { AuthService } from '../auth/authService';
import { createBackup, isValidBackup, restoreBackup } from './backupService';

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

describe('backupService', () => {
  it('creates a backup that restores into a fresh workspace with the same passphrase', async () => {
    const sourceName = `test-backup-src-${Date.now()}-${counter++}`;
    const targetName = `test-backup-dst-${Date.now()}-${counter++}`;

    const sourceAuth = makeService(sourceName);
    const sourceDb = await sourceAuth.setup({ name: 'Dr. Osei', passphrase: 'backup-pass-1' });
    const client = await sourceDb.createClient(
      {
        displayName: 'M.N.',
        contactEnabled: false,
        levelOfCare: 'php',
        status: 'active',
        diagnoses: [{ id: 'd1', label: 'GAD', kind: 'diagnosis' }],
        medications: [],
        risk: { level: 'moderate' },
      },
      'Dr. Osei',
    );
    await sourceDb.createInput(
      {
        clientId: client.id,
        inputType: 'bps',
        dateOfInformation: '2026-07-01',
        rawText: 'Full biopsychosocial text.',
        authorSource: 'Dr. Osei',
        reportedBy: 'therapist-entered',
        containsRisk: false,
        allowAiAnalysis: true,
        localOnly: true,
      },
      [{ name: 'bps.txt', mimeType: 'text/plain', bytes: new TextEncoder().encode('doc') }],
      'Dr. Osei',
    );

    const backup = await createBackup(sourceDb.adapter);
    expect(isValidBackup(backup)).toBe(true);
    // Backup must not contain plaintext PHI
    const dump = JSON.stringify(backup.records) + JSON.stringify(backup.blobs);
    expect(dump).not.toContain('M.N.');
    expect(dump).not.toContain('biopsychosocial');

    // Round-trip through JSON like a real file download/upload
    const parsed = JSON.parse(JSON.stringify(backup));

    const targetAuth = makeService(targetName);
    // restore into an empty adapter (uninitialized workspace)
    expect(await targetAuth.getStatus()).toBe('uninitialized');
    const targetAdapter = await (async () => {
      // Reach the adapter by asking the service for status first (opens it)
      const { IndexedDbAdapter } = await import('../storage/indexedDbAdapter');
      return IndexedDbAdapter.open(targetName);
    })();
    await restoreBackup(targetAdapter, parsed);
    targetAdapter.close();

    const restoredDb = await targetAuth.unlockWithPassphrase('backup-pass-1');
    const clients = await restoredDb.listClients();
    expect(clients).toHaveLength(1);
    expect(clients[0].displayName).toBe('M.N.');
    const inputs = await restoredDb.listInputsForClient(clients[0].id);
    expect(inputs).toHaveLength(1);
    const bytes = await restoredDb.getAttachmentBytes(inputs[0].attachments[0].id);
    expect(new TextDecoder().decode(bytes)).toBe('doc');
  });

  it('rejects invalid backup files', async () => {
    expect(isValidBackup(null)).toBe(false);
    expect(isValidBackup({})).toBe(false);
    expect(isValidBackup({ format: 'something-else', version: 1 })).toBe(false);
  });
});
