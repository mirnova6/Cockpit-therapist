import { afterEach, describe, expect, it } from 'vitest';
import { AuthService } from '../auth/authService';
import { MemorySecureKeyStore } from '../auth/secureKeyStore';
import type { ClinicalDatabase } from '../db/database';
import { FileBackedAdapter, MemoryFileStore } from './fileBackedAdapter';
import type { StorageAdapter } from './indexedDbAdapter';

let counter = 0;
const services: AuthService[] = [];

function makeFileAuth(): { auth: AuthService; fs: MemoryFileStore } {
  const fs = new MemoryFileStore();
  const auth = new AuthService({
    dbName: `native-${Date.now()}-${counter++}`,
    iterations: 1000,
    adapterFactory: async () => new FileBackedAdapter(fs),
    keyStore: new MemorySecureKeyStore(true),
  });
  services.push(auth);
  return { auth, fs };
}

afterEach(async () => {
  while (services.length) await services.pop()?.close();
});

describe('FileBackedAdapter — StorageAdapter contract', () => {
  it('implements the full interface consistently with in-memory files', async () => {
    const adapter: StorageAdapter = new FileBackedAdapter(new MemoryFileStore());

    // meta returns the VALUE, not the {key,value} envelope
    await adapter.putMeta('greeting', { hello: 'world' });
    expect(await adapter.getMeta('greeting')).toEqual({ hello: 'world' });
    expect((await adapter.getAllMeta()).find((m) => m.key === 'greeting')?.value).toEqual({ hello: 'world' });

    // Uint8Array survives the round trip (needed for keyrings)
    const bytes = new Uint8Array([1, 2, 3, 250]);
    await adapter.putMeta('raw', { salt: bytes });
    const back = (await adapter.getMeta('raw')) as { salt: Uint8Array };
    expect(back.salt).toBeInstanceOf(Uint8Array);
    expect([...back.salt]).toEqual([1, 2, 3, 250]);

    // records + by-collection
    await adapter.putRecord({ key: 'clients:a', collection: 'clients', payload: { iv: 'x', data: 'y' }, updatedAt: 't' });
    await adapter.putRecord({ key: 'inputs:b', collection: 'inputs', payload: { iv: 'x', data: 'y' }, updatedAt: 't' });
    expect((await adapter.getAllRecords())).toHaveLength(2);
    expect((await adapter.getByCollection('clients'))).toHaveLength(1);
    expect((await adapter.getRecord('clients:a'))?.collection).toBe('clients');

    // blobs
    await adapter.putBlob({ id: 'blob1', payload: { iv: 'x', data: 'y' } });
    expect((await adapter.getBlob('blob1'))?.id).toBe('blob1');
    expect((await adapter.getAllBlobs())).toHaveLength(1);

    // secure deletion = the file is gone
    await adapter.deleteRecord('clients:a');
    expect(await adapter.getRecord('clients:a')).toBeUndefined();
    await adapter.deleteBlob('blob1');
    expect(await adapter.getBlob('blob1')).toBeUndefined();

    await adapter.clearAll();
    expect(await adapter.getAllRecords()).toHaveLength(0);
    expect(await adapter.getAllMeta()).toHaveLength(0);
  });

  it('runs the whole workspace (setup, unlock, isolation) on native file storage', async () => {
    const { auth, fs } = makeFileAuth();
    const db: ClinicalDatabase = await auth.setup({ name: 'Dr. Native', passphrase: 'native-pass-1' });
    const a = await db.createClient(
      { displayName: 'A.A.', contactEnabled: false, levelOfCare: 'outpatient', status: 'active', diagnoses: [], medications: [], risk: { level: 'low' } },
      'Dr. Native',
    );
    const b = await db.createClient(
      { displayName: 'B.B.', contactEnabled: false, levelOfCare: 'outpatient', status: 'active', diagnoses: [], medications: [], risk: { level: 'low' } },
      'Dr. Native',
    );
    await db.createInput(
      { clientId: a.id, inputType: 'rough-notes', dateOfInformation: '2026-07-01', rawText: 'Client A private note.', authorSource: 'Dr. Native', reportedBy: 'therapist-entered', containsRisk: false, allowAiAnalysis: true, localOnly: true },
      [],
      'Dr. Native',
    );

    // Encrypted at rest: raw files never contain plaintext PHI.
    const dump = [...fs.files.values()].join('\n');
    expect(dump).not.toContain('A.A.');
    expect(dump).not.toContain('private note');

    // Client isolation holds on this adapter.
    expect(await db.listInputsForClient(b.id)).toHaveLength(0);
    expect(await db.listInputsForClient(a.id)).toHaveLength(1);

    // Relock + unlock reads back from the file store.
    await auth.lock();
    const reDb = await auth.unlockWithPassphrase('native-pass-1');
    expect((await reDb.listClients()).map((c) => c.displayName).sort()).toEqual(['A.A.', 'B.B.']);
    // Wrong passphrase fails GCM unwrap (no plaintext password anywhere).
    await auth.lock();
    await expect(auth.unlockWithPassphrase('wrong')).rejects.toThrow();
  });

  it('large transcript storage works (each envelope is its own file)', async () => {
    const { auth } = makeFileAuth();
    const db = await auth.setup({ name: 'Dr. Native', passphrase: 'native-pass-2' });
    const client = await db.createClient(
      { displayName: 'L.T.', contactEnabled: false, levelOfCare: 'outpatient', status: 'active', diagnoses: [], medications: [], risk: { level: 'low' } },
      'Dr. Native',
    );
    const big = 'Session transcript paragraph. '.repeat(20_000); // ~600 KB
    const input = await db.createInput(
      { clientId: client.id, inputType: 'session-transcript', dateOfInformation: '2026-07-01', rawText: big, authorSource: 'Dr. Native', reportedBy: 'therapist-entered', containsRisk: false, allowAiAnalysis: true, localOnly: true },
      [],
      'Dr. Native',
    );
    const fetched = await db.getInput(input.id);
    expect(fetched?.rawText.length).toBe(big.length);
  });
});
