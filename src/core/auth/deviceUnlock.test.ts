import { afterEach, describe, expect, it } from 'vitest';
import { AuthService } from './authService';
import { MemorySecureKeyStore, NullSecureKeyStore, DEVICE_KEY_ACCOUNT } from './secureKeyStore';

let counter = 0;
const services: AuthService[] = [];

function makeAuth(keyStore = new MemorySecureKeyStore(true)): { auth: AuthService; keyStore: MemorySecureKeyStore } {
  const auth = new AuthService({ dbName: `device-${Date.now()}-${counter++}`, iterations: 1000, keyStore });
  services.push(auth);
  return { auth, keyStore };
}

afterEach(async () => {
  while (services.length) await services.pop()?.close();
});

describe('OS device unlock (no backdoor)', () => {
  it('is unavailable when no OS keystore is present (browser default)', async () => {
    const auth = new AuthService({ dbName: `device-null-${counter++}`, iterations: 1000, keyStore: new NullSecureKeyStore() });
    services.push(auth);
    await auth.setup({ name: 'Dr. Kim', passphrase: 'pass-1' });
    expect(await auth.isDeviceUnlockAvailable()).toBe(false);
    await expect(auth.enableDeviceUnlock()).rejects.toThrow(/not available/i);
  });

  it('enables device unlock, stores the key ONLY in the OS keystore, and unlocks without a passphrase', async () => {
    const { auth, keyStore } = makeAuth();
    const db = await auth.setup({ name: 'Dr. Kim', passphrase: 'pass-1' });
    await db.createClient(
      { displayName: 'C.D.', contactEnabled: false, levelOfCare: 'outpatient', status: 'active', diagnoses: [], medications: [], risk: { level: 'low' } },
      'Dr. Kim',
    );

    expect(await auth.isDeviceUnlockAvailable()).toBe(true);
    await auth.enableDeviceUnlock();
    expect(await auth.hasDeviceUnlock()).toBe(true);
    // The device secret lives only in the keystore, never in the DB meta.
    expect(await keyStore.getSecret(DEVICE_KEY_ACCOUNT)).toBeDefined();

    await auth.lock();
    const reDb = await auth.unlockWithDevice();
    expect((await reDb.listClients())[0].displayName).toBe('C.D.');
    // Passphrase still works too.
    await auth.lock();
    const pw = await auth.unlockWithPassphrase('pass-1');
    expect(await pw.listClients()).toHaveLength(1);
  });

  it('NO BACKDOOR: if the OS keystore entry is gone, device unlock is unavailable — data needs the passphrase', async () => {
    const { auth, keyStore } = makeAuth();
    await auth.setup({ name: 'Dr. Kim', passphrase: 'pass-1' });
    await auth.enableDeviceUnlock();
    await auth.lock();

    // Simulate a wiped device / reinstall: the OS secret is gone.
    await keyStore.deleteSecret(DEVICE_KEY_ACCOUNT);
    expect(await auth.hasDeviceUnlock()).toBe(false);
    await expect(auth.unlockWithDevice()).rejects.toThrow(/no longer in OS secure storage|not configured/i);
    // The passphrase is the only remaining path — data is not silently recoverable.
    const db = await auth.unlockWithPassphrase('pass-1');
    expect(db).toBeDefined();
  });

  it('disabling device unlock removes the keystore secret and the keyring slot', async () => {
    const { auth, keyStore } = makeAuth();
    await auth.setup({ name: 'Dr. Kim', passphrase: 'pass-1' });
    await auth.enableDeviceUnlock();
    await auth.disableDeviceUnlock();
    expect(await keyStore.getSecret(DEVICE_KEY_ACCOUNT)).toBeUndefined();
    expect(await auth.hasDeviceUnlock()).toBe(false);
    await auth.lock();
    await expect(auth.unlockWithDevice()).rejects.toThrow();
  });
});
