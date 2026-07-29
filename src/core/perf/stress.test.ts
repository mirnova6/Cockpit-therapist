/**
 * Phase 8 performance & stress tests. Correctness-at-scale, not benchmarks:
 * they confirm the app stays functional and measurable with 50 clients / large
 * notes, and that backup + restore work in native (file-backed) mode with a
 * large workspace. Timings are logged for the record.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { AuthService } from '../auth/authService';
import { MemorySecureKeyStore } from '../auth/secureKeyStore';
import { createBackup, restoreBackup } from '../backup/backupService';
import { FileBackedAdapter, MemoryFileStore } from '../storage/fileBackedAdapter';
import { measureWorkspace, stressSeed } from './perfHarness';

let counter = 0;
const services: AuthService[] = [];

afterEach(async () => {
  while (services.length) await services.pop()?.close();
});

describe('stress: 50-client workspace', () => {
  it('stays functional and produces live read measurements', async () => {
    const auth = new AuthService({ dbName: `stress-50-${Date.now()}-${counter++}`, iterations: 1000 });
    services.push(auth);
    const db = await auth.setup({ name: 'Dr. Scale', passphrase: 'scale-pass' });

    const { clientIds, createMs } = await stressSeed(db, { clients: 50, transcriptChars: 4000 });
    expect(clientIds).toHaveLength(50);
    expect(await db.listClients()).toHaveLength(50);

    const samples = await measureWorkspace(db);
    // Real, finite measurements exist for the key read paths.
    expect(samples.length).toBeGreaterThanOrEqual(4);
    for (const s of samples) expect(Number.isFinite(s.ms)).toBe(true);
    const byLabel = Object.fromEntries(samples.map((s) => [s.label, s.ms]));
    // eslint-disable-next-line no-console
    console.log(`[stress] 50-client create ${createMs}ms; reads:`, byLabel);
    expect(byLabel['List all clients']).toBeGreaterThanOrEqual(0);
    expect(byLabel['RAG retrieval (1 client)']).toBeGreaterThanOrEqual(0);
  });
});

describe('stress: native-mode backup/restore with a large workspace', () => {
  it('backs up and restores a large file-backed workspace with data + isolation intact', async () => {
    const fs = new MemoryFileStore();
    const auth = new AuthService({
      dbName: `stress-native-${Date.now()}-${counter++}`,
      iterations: 1000,
      adapterFactory: async () => new FileBackedAdapter(fs),
      keyStore: new MemorySecureKeyStore(true),
    });
    services.push(auth);
    const db = await auth.setup({ name: 'Dr. Native', passphrase: 'native-pass' });

    const { clientIds } = await stressSeed(db, { clients: 20, transcriptChars: 3000 });
    expect(clientIds).toHaveLength(20);

    const t0 = Date.now();
    const backup = JSON.parse(JSON.stringify(await createBackup(db.adapter)));
    const backupBytes = JSON.stringify(backup).length;
    const backupMs = Date.now() - t0;
    // Encrypted envelopes only — the transcript text is not in the backup.
    expect(JSON.stringify(backup.records)).not.toContain('long transcript');

    // Restore into a fresh file-backed workspace.
    const fs2 = new MemoryFileStore();
    const auth2 = new AuthService({
      dbName: `stress-native2-${Date.now()}-${counter++}`,
      iterations: 1000,
      adapterFactory: async () => new FileBackedAdapter(fs2),
      keyStore: new MemorySecureKeyStore(true),
    });
    services.push(auth2);
    const target = new FileBackedAdapter(fs2);
    const t1 = Date.now();
    await restoreBackup(target, backup);
    const restoreMs = Date.now() - t1;

    const db2 = await auth2.unlockWithPassphrase('native-pass');
    expect(await db2.listClients()).toHaveLength(20);
    // Files on disk are ciphertext only.
    expect([...fs2.files.values()].join('\n')).not.toContain('long transcript');
    // eslint-disable-next-line no-console
    console.log(`[stress] native backup ${backupMs}ms/${backupBytes}B; restore ${restoreMs}ms`);
  });
});
