/**
 * SecureKeyStore (Phase 6) — the seam for OS-level secure key storage.
 *
 * Native shells bind this to the platform keystore:
 *   - macOS Keychain / iOS Keychain (Tauri keyring plugin / Capacitor)
 *   - Windows Credential Manager
 *   - Android Keystore
 *
 * The app KEEPS the passphrase system. Device unlock is an ADDITIONAL,
 * optional convenience slot: a random device-wrapping key is generated,
 * stored ONLY in the OS secure store, and used to wrap the data key into a
 * `device` keyring slot. There is deliberately NO recovery backdoor — the
 * device secret exists only inside the OS keystore. If the passphrase is
 * lost AND the OS keystore entry is gone (device wiped, app reinstalled),
 * the encrypted data is unrecoverable, and the app says so plainly.
 *
 * The browser build has no secure keystore, so device unlock is simply
 * unavailable there (NullSecureKeyStore reports isAvailable() === false).
 */

export interface SecureKeyStore {
  readonly label: string;
  /** True only when a real OS-backed secure store is present. */
  isAvailable(): Promise<boolean>;
  getSecret(account: string): Promise<string | undefined>;
  setSecret(account: string, value: string): Promise<void>;
  deleteSecret(account: string): Promise<void>;
}

/** Browser default: no OS keystore, so device unlock is not offered. */
export class NullSecureKeyStore implements SecureKeyStore {
  readonly label = 'None (browser has no OS secure key storage)';
  async isAvailable(): Promise<boolean> {
    return false;
  }
  async getSecret(): Promise<string | undefined> {
    return undefined;
  }
  async setSecret(): Promise<void> {
    throw new Error('No secure key storage is available in this environment.');
  }
  async deleteSecret(): Promise<void> {
    // no-op
  }
}

/**
 * In-memory secure store for tests and for exercising the device-unlock
 * flow. Behaves like an available OS keystore but keeps secrets in a Map
 * for the process lifetime only.
 */
export class MemorySecureKeyStore implements SecureKeyStore {
  readonly label = 'In-memory (test)';
  private secrets = new Map<string, string>();
  constructor(private available = true) {}
  async isAvailable(): Promise<boolean> {
    return this.available;
  }
  async getSecret(account: string): Promise<string | undefined> {
    return this.secrets.get(account);
  }
  async setSecret(account: string, value: string): Promise<void> {
    if (!this.available) throw new Error('Secure key storage is not available.');
    this.secrets.set(account, value);
  }
  async deleteSecret(account: string): Promise<void> {
    this.secrets.delete(account);
  }
}

/** Keystore account name for the device-wrapping key. */
export const DEVICE_KEY_ACCOUNT = 'cockpit.device-wrapping-key';
