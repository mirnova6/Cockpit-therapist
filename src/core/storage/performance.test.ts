/**
 * Performance & migration smoke tests (Phase 6). These are correctness-at-
 * scale checks, not benchmarks: they assert the app stays functional and
 * isolated with 50 clients and large notes, and that a browser→native
 * migration preserves data and isolation.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { AuthService } from '../auth/authService';
import { MemorySecureKeyStore } from '../auth/secureKeyStore';
import { createBackup, restoreBackup } from '../backup/backupService';
import { FileBackedAdapter, MemoryFileStore } from './fileBackedAdapter';

let counter = 0;
const services: AuthService[] = [];

afterEach(async () => {
  while (services.length) await services.pop()?.close();
});

describe('scale', () => {
  it('handles 50 clients with retrieval and isolation intact', async () => {
    const auth = new AuthService({ dbName: `perf-50-${Date.now()}-${counter++}`, iterations: 1000 });
    services.push(auth);
    const db = await auth.setup({ name: 'Dr. Scale', passphrase: 'scale-pass' });

    const ids: string[] = [];
    for (let i = 0; i < 50; i++) {
      const client = await db.createClient(
        { displayName: `Client ${i}`, contactEnabled: false, levelOfCare: 'outpatient', status: 'active', diagnoses: [], medications: [], risk: { level: 'low' } },
        'Dr. Scale',
      );
      ids.push(client.id);
      await db.createInput(
        { clientId: client.id, inputType: 'rough-notes', dateOfInformation: '2026-07-01', rawText: `Note for client ${i}. Unique-marker-${i}.`, authorSource: 'Dr. Scale', reportedBy: 'therapist-entered', containsRisk: false, allowAiAnalysis: true, localOnly: true },
        [],
        'Dr. Scale',
      );
    }

    expect(await db.listClients()).toHaveLength(50);
    // Each client sees only its own input.
    for (let i = 0; i < 50; i += 10) {
      const inputs = await db.listInputsForClient(ids[i]);
      expect(inputs).toHaveLength(1);
      expect(inputs[0].rawText).toContain(`Unique-marker-${i}.`);
    }
  });

  it('stores and reads a large transcript without corruption', async () => {
    const auth = new AuthService({ dbName: `perf-large-${Date.now()}-${counter++}`, iterations: 1000 });
    services.push(auth);
    const db = await auth.setup({ name: 'Dr. Big', passphrase: 'big-pass' });
    const client = await db.createClient(
      { displayName: 'Big.T', contactEnabled: false, levelOfCare: 'outpatient', status: 'active', diagnoses: [], medications: [], risk: { level: 'low' } },
      'Dr. Big',
    );
    const big = `Paragraph ${'x'.repeat(40)}.\n`.repeat(30_000); // ~1.4 MB
    const input = await db.createInput(
      { clientId: client.id, inputType: 'session-transcript', dateOfInformation: '2026-07-01', rawText: big, authorSource: 'Dr. Big', reportedBy: 'therapist-entered', containsRisk: false, allowAiAnalysis: true, localOnly: true },
      [],
      'Dr. Big',
    );
    const fetched = await db.getInput(input.id);
    expect(fetched?.rawText).toBe(big);
  });
});

describe('browser → native migration', () => {
  it('exports from IndexedDB and imports into file-backed native storage with data + isolation preserved', async () => {
    // 1. Browser-side workspace (IndexedDB).
    const browserName = `mig-browser-${Date.now()}-${counter++}`;
    const browserAuth = new AuthService({ dbName: browserName, iterations: 1000 });
    services.push(browserAuth);
    const browserDb = await browserAuth.setup({ name: 'Dr. Move', passphrase: 'migrate-pass' });
    const a = await browserDb.createClient(
      { displayName: 'MIG.A', contactEnabled: false, levelOfCare: 'outpatient', status: 'active', diagnoses: [], medications: [], risk: { level: 'low' } },
      'Dr. Move',
    );
    await browserDb.createClient(
      { displayName: 'MIG.B', contactEnabled: false, levelOfCare: 'outpatient', status: 'active', diagnoses: [], medications: [], risk: { level: 'low' } },
      'Dr. Move',
    );
    await browserDb.createInput(
      { clientId: a.id, inputType: 'rough-notes', dateOfInformation: '2026-07-01', rawText: 'A-only content marker.', authorSource: 'Dr. Move', reportedBy: 'therapist-entered', containsRisk: false, allowAiAnalysis: true, localOnly: true },
      [],
      'Dr. Move',
    );

    // 2. Encrypted export (no plaintext migration file).
    const backup = JSON.parse(JSON.stringify(await createBackup(browserDb.adapter)));
    expect(JSON.stringify(backup.records)).not.toContain('A-only content marker');

    // 3. Native side (file-backed) — restore into a fresh file store.
    const fs = new MemoryFileStore();
    const nativeName = `mig-native-${Date.now()}-${counter++}`;
    const nativeAuth = new AuthService({
      dbName: nativeName,
      iterations: 1000,
      adapterFactory: async () => new FileBackedAdapter(fs),
      keyStore: new MemorySecureKeyStore(true),
    });
    services.push(nativeAuth);
    const nativeAdapter = new FileBackedAdapter(fs);
    const result = await restoreBackup(nativeAdapter, backup);
    expect(result.dryRun).toBe(false);

    // 4. Unlock on native storage with the SAME passphrase; data + isolation intact.
    const nativeDb = await nativeAuth.unlockWithPassphrase('migrate-pass');
    const clients = await nativeDb.listClients();
    expect(clients.map((c) => c.displayName).sort()).toEqual(['MIG.A', 'MIG.B']);
    const restoredA = clients.find((c) => c.displayName === 'MIG.A')!;
    const restoredB = clients.find((c) => c.displayName === 'MIG.B')!;
    expect(await nativeDb.listInputsForClient(restoredA.id)).toHaveLength(1);
    expect(await nativeDb.listInputsForClient(restoredB.id)).toHaveLength(0);
    // Files on the native side are ciphertext only.
    expect([...fs.files.values()].join('\n')).not.toContain('A-only content marker');
  });
});
