import { afterEach, describe, expect, it } from 'vitest';
import { AuthError, AuthService } from './authService';

let counter = 0;
const services: AuthService[] = [];

function makeService(): AuthService {
  const service = new AuthService({ dbName: `test-auth-${Date.now()}-${counter++}`, iterations: 1000 });
  services.push(service);
  return service;
}

afterEach(async () => {
  while (services.length) await services.pop()?.close();
});

describe('AuthService', () => {
  it('starts uninitialized, then locked after setup + lock', async () => {
    const auth = makeService();
    expect(await auth.getStatus()).toBe('uninitialized');
    await auth.setup({ name: 'Dr. Rivera', passphrase: 'a-strong-passphrase' });
    expect(await auth.getStatus()).toBe('unlocked');
    await auth.lock();
    expect(await auth.getStatus()).toBe('locked');
    expect(auth.current()).toBeNull();
  });

  it('unlocks with the correct passphrase and restores data access', async () => {
    const auth = makeService();
    const db = await auth.setup({ name: 'Dr. Rivera', passphrase: 'a-strong-passphrase' });
    const client = await db.createClient(
      {
        displayName: 'A.B.',
        contactEnabled: false,
        levelOfCare: 'outpatient',
        status: 'active',
        diagnoses: [],
        medications: [],
        risk: { level: 'not-assessed' },
      },
      'Dr. Rivera',
    );
    await auth.lock();

    const db2 = await auth.unlockWithPassphrase('a-strong-passphrase');
    const loaded = await db2.getClient(client.id);
    expect(loaded?.displayName).toBe('A.B.');
  });

  it('rejects a wrong passphrase without exposing data', async () => {
    const auth = makeService();
    await auth.setup({ name: 'Dr. Rivera', passphrase: 'a-strong-passphrase' });
    await auth.lock();
    await expect(auth.unlockWithPassphrase('wrong')).rejects.toThrow(AuthError);
    expect(auth.current()).toBeNull();
  });

  it('supports PIN unlock when configured', async () => {
    const auth = makeService();
    await auth.setup({ name: 'Dr. Rivera', passphrase: 'a-strong-passphrase', pin: '482913' });
    await auth.lock();
    const db = await auth.unlockWithPin('482913');
    expect(db).toBeTruthy();
    await auth.lock();
    await expect(auth.unlockWithPin('000000')).rejects.toThrow(AuthError);
  });

  it('locks out after repeated failures with increasing delay', async () => {
    const auth = makeService();
    await auth.setup({ name: 'Dr. Rivera', passphrase: 'a-strong-passphrase' });
    await auth.lock();
    for (let i = 0; i < 4; i++) {
      await expect(auth.unlockWithPassphrase('nope')).rejects.toMatchObject({
        code: 'invalid-credentials',
      });
    }
    // 5th failure triggers lockout
    await expect(auth.unlockWithPassphrase('nope')).rejects.toMatchObject({ code: 'locked-out' });
    // and even the CORRECT passphrase is rejected while locked out
    await expect(auth.unlockWithPassphrase('a-strong-passphrase')).rejects.toMatchObject({
      code: 'locked-out',
    });
  });

  it('resets the failure counter after a successful unlock', async () => {
    const auth = makeService();
    await auth.setup({ name: 'Dr. Rivera', passphrase: 'a-strong-passphrase' });
    await auth.lock();
    await expect(auth.unlockWithPassphrase('nope')).rejects.toThrow();
    await auth.unlockWithPassphrase('a-strong-passphrase');
    expect((await auth.getSecurity()).failedCount).toBe(0);
  });

  it('changes the passphrase without losing data', async () => {
    const auth = makeService();
    const db = await auth.setup({ name: 'Dr. Rivera', passphrase: 'old-passphrase-123' });
    const client = await db.createClient(
      {
        displayName: 'C.D.',
        contactEnabled: false,
        levelOfCare: 'iop',
        status: 'active',
        diagnoses: [],
        medications: [],
        risk: { level: 'low' },
      },
      'Dr. Rivera',
    );
    await auth.changePassphrase('old-passphrase-123', 'new-passphrase-456');
    await auth.lock();
    await expect(auth.unlockWithPassphrase('old-passphrase-123')).rejects.toThrow();
    // failed attempt recorded; still under lockout threshold
    const db2 = await auth.unlockWithPassphrase('new-passphrase-456');
    expect((await db2.getClient(client.id))?.displayName).toBe('C.D.');
  });

  it('can add and remove a PIN while unlocked', async () => {
    const auth = makeService();
    await auth.setup({ name: 'Dr. Rivera', passphrase: 'a-strong-passphrase' });
    expect(await auth.hasPin()).toBe(false);
    await auth.setPin('9137');
    expect(await auth.hasPin()).toBe(true);
    await auth.lock();
    await auth.unlockWithPin('9137');
    await auth.removePin();
    expect(await auth.hasPin()).toBe(false);
    await auth.lock();
    await expect(auth.unlockWithPin('9137')).rejects.toMatchObject({ code: 'no-pin' });
  });

  it('stores only ciphertext in the records store', async () => {
    const auth = makeService();
    const db = await auth.setup({ name: 'Dr. Rivera', passphrase: 'a-strong-passphrase' });
    await db.createClient(
      {
        displayName: 'Sensitive Name',
        contactEnabled: false,
        levelOfCare: 'outpatient',
        status: 'active',
        diagnoses: [{ id: 'd1', label: 'Major depressive disorder', kind: 'diagnosis' }],
        medications: [],
        risk: { level: 'moderate' },
      },
      'Dr. Rivera',
    );
    const envelopes = await db.adapter.getAllRecords();
    const rawDump = JSON.stringify(envelopes);
    expect(rawDump).not.toContain('Sensitive Name');
    expect(rawDump).not.toContain('depressive');
  });
});
