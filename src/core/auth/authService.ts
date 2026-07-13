/**
 * AuthService — local-first authentication gating access to the encrypted
 * database. The passphrase never touches storage; it only derives the KEK
 * that unwraps the data key. Failed-attempt lockout state is kept in
 * plaintext meta (it must be readable before unlock and contains no PHI).
 */
import {
  DEFAULT_PBKDF2_ITERATIONS,
  deriveWrappingKey,
  generateDataKey,
  randomSalt,
  unwrapDataKey,
  wrapDataKey,
  type DerivationParams,
  type WrappedKey,
} from '../crypto/cryptoService';
import { ClinicalDatabase } from '../db/database';
import { IndexedDbAdapter, type StorageAdapter } from '../storage/indexedDbAdapter';

interface KeySlot {
  params: DerivationParams;
  wrapped: WrappedKey;
}

interface Keyring {
  version: 1;
  passphrase: KeySlot;
  pin?: KeySlot;
}

export interface Profile {
  name: string;
  createdAt: string;
  lastLoginAt?: string;
}

export interface SecuritySettings {
  autoLockMinutes: number;
  failedCount: number;
  lockoutUntil?: number; // epoch ms
}

export const DEFAULT_SECURITY: SecuritySettings = { autoLockMinutes: 5, failedCount: 0 };

export type AuthStatus = 'uninitialized' | 'locked' | 'unlocked';

export class AuthError extends Error {
  constructor(
    public code: 'invalid-credentials' | 'locked-out' | 'not-initialized' | 'no-pin',
    message: string,
    public lockoutUntil?: number,
  ) {
    super(message);
  }
}

const META = { keyring: 'keyring', profile: 'profile', security: 'security' } as const;

export interface AuthServiceOptions {
  dbName?: string;
  iterations?: number;
}

export class AuthService {
  private adapter: StorageAdapter | null = null;
  private session: { db: ClinicalDatabase; dek: CryptoKey } | null = null;
  private dbName: string;
  private iterations: number;

  constructor(opts: AuthServiceOptions = {}) {
    this.dbName = opts.dbName ?? 'cockpit-clinical';
    this.iterations = opts.iterations ?? DEFAULT_PBKDF2_ITERATIONS;
  }

  private async getAdapter(): Promise<StorageAdapter> {
    if (!this.adapter) {
      this.adapter = await IndexedDbAdapter.open(this.dbName);
    }
    return this.adapter;
  }

  async getStatus(): Promise<AuthStatus> {
    if (this.session) return 'unlocked';
    const adapter = await this.getAdapter();
    const keyring = await adapter.getMeta<Keyring>(META.keyring);
    return keyring ? 'locked' : 'uninitialized';
  }

  async getProfile(): Promise<Profile | undefined> {
    const adapter = await this.getAdapter();
    return adapter.getMeta<Profile>(META.profile);
  }

  async getSecurity(): Promise<SecuritySettings> {
    const adapter = await this.getAdapter();
    return (await adapter.getMeta<SecuritySettings>(META.security)) ?? DEFAULT_SECURITY;
  }

  async setSecurity(patch: Partial<SecuritySettings>): Promise<SecuritySettings> {
    const adapter = await this.getAdapter();
    const next = { ...(await this.getSecurity()), ...patch };
    await adapter.putMeta(META.security, next);
    return next;
  }

  async hasPin(): Promise<boolean> {
    const adapter = await this.getAdapter();
    const keyring = await adapter.getMeta<Keyring>(META.keyring);
    return Boolean(keyring?.pin);
  }

  current(): ClinicalDatabase | null {
    return this.session?.db ?? null;
  }

  require(): ClinicalDatabase {
    if (!this.session) throw new AuthError('not-initialized', 'Session is locked');
    return this.session.db;
  }

  // ------------------------------------------------------------ setup

  async setup(args: {
    name: string;
    passphrase: string;
    pin?: string;
    autoLockMinutes?: number;
  }): Promise<ClinicalDatabase> {
    const adapter = await this.getAdapter();
    const existing = await adapter.getMeta<Keyring>(META.keyring);
    if (existing) throw new Error('Workspace already initialized');

    const dek = await generateDataKey();
    const passParams: DerivationParams = { salt: randomSalt(), iterations: this.iterations };
    const kek = await deriveWrappingKey(args.passphrase, passParams);
    const keyring: Keyring = {
      version: 1,
      passphrase: { params: passParams, wrapped: await wrapDataKey(dek, kek) },
    };
    if (args.pin) {
      const pinParams: DerivationParams = { salt: randomSalt(), iterations: this.iterations };
      const pinKek = await deriveWrappingKey(args.pin, pinParams);
      keyring.pin = { params: pinParams, wrapped: await wrapDataKey(dek, pinKek) };
    }

    await adapter.putMeta(META.keyring, keyring);
    await adapter.putMeta(META.profile, {
      name: args.name,
      createdAt: new Date().toISOString(),
      lastLoginAt: new Date().toISOString(),
    } satisfies Profile);
    await adapter.putMeta(META.security, {
      ...DEFAULT_SECURITY,
      autoLockMinutes: args.autoLockMinutes ?? DEFAULT_SECURITY.autoLockMinutes,
    } satisfies SecuritySettings);

    const db = new ClinicalDatabase(adapter, dek);
    this.session = { db, dek };
    await db.audit('auth', 'workspace.created');
    return db;
  }

  // ----------------------------------------------------------- unlock

  private lockoutDelayMs(failedCount: number): number {
    if (failedCount < 5) return 0;
    return Math.min(30_000 * 2 ** (failedCount - 5), 15 * 60_000);
  }

  private async checkLockout(): Promise<void> {
    const security = await this.getSecurity();
    if (security.lockoutUntil && Date.now() < security.lockoutUntil) {
      throw new AuthError(
        'locked-out',
        'Too many failed attempts. Try again later.',
        security.lockoutUntil,
      );
    }
  }

  private async recordFailure(): Promise<never> {
    const security = await this.getSecurity();
    const failedCount = security.failedCount + 1;
    const delay = this.lockoutDelayMs(failedCount);
    const lockoutUntil = delay > 0 ? Date.now() + delay : undefined;
    await this.setSecurity({ failedCount, lockoutUntil });
    if (lockoutUntil) {
      throw new AuthError('locked-out', 'Too many failed attempts.', lockoutUntil);
    }
    throw new AuthError('invalid-credentials', 'The credentials entered are not correct.');
  }

  private async unlockWithSlot(secret: string, slot: KeySlot): Promise<ClinicalDatabase> {
    const adapter = await this.getAdapter();
    await this.checkLockout();
    let dek: CryptoKey;
    try {
      const kek = await deriveWrappingKey(secret, slot.params);
      dek = await unwrapDataKey(slot.wrapped, kek);
    } catch {
      return this.recordFailure();
    }
    await this.setSecurity({ failedCount: 0, lockoutUntil: undefined });
    const profile = await this.getProfile();
    if (profile) {
      await adapter.putMeta(META.profile, { ...profile, lastLoginAt: new Date().toISOString() });
    }
    const db = new ClinicalDatabase(adapter, dek);
    this.session = { db, dek };
    await db.audit('auth', 'session.unlocked');
    return db;
  }

  async unlockWithPassphrase(passphrase: string): Promise<ClinicalDatabase> {
    const adapter = await this.getAdapter();
    const keyring = await adapter.getMeta<Keyring>(META.keyring);
    if (!keyring) throw new AuthError('not-initialized', 'Workspace has not been set up');
    return this.unlockWithSlot(passphrase, keyring.passphrase);
  }

  async unlockWithPin(pin: string): Promise<ClinicalDatabase> {
    const adapter = await this.getAdapter();
    const keyring = await adapter.getMeta<Keyring>(META.keyring);
    if (!keyring) throw new AuthError('not-initialized', 'Workspace has not been set up');
    if (!keyring.pin) throw new AuthError('no-pin', 'No PIN is configured');
    return this.unlockWithSlot(pin, keyring.pin);
  }

  async lock(): Promise<void> {
    if (this.session) {
      try {
        await this.session.db.audit('auth', 'session.locked');
      } catch {
        // best-effort; locking must always succeed
      }
    }
    this.session = null;
  }

  // ----------------------------------------------- credential changes

  async changePassphrase(currentPassphrase: string, nextPassphrase: string): Promise<void> {
    const adapter = await this.getAdapter();
    const keyring = await adapter.getMeta<Keyring>(META.keyring);
    if (!keyring) throw new AuthError('not-initialized', 'Workspace has not been set up');
    let dek: CryptoKey;
    try {
      const kek = await deriveWrappingKey(currentPassphrase, keyring.passphrase.params);
      dek = await unwrapDataKey(keyring.passphrase.wrapped, kek);
    } catch {
      throw new AuthError('invalid-credentials', 'Current passphrase is not correct.');
    }
    const params: DerivationParams = { salt: randomSalt(), iterations: this.iterations };
    const nextKek = await deriveWrappingKey(nextPassphrase, params);
    const nextKeyring: Keyring = {
      ...keyring,
      passphrase: { params, wrapped: await wrapDataKey(dek, nextKek) },
    };
    await adapter.putMeta(META.keyring, nextKeyring);
    await this.session?.db.audit('security', 'passphrase.changed');
  }

  /** Requires an unlocked session (the DEK must be in memory to re-wrap). */
  async setPin(pin: string): Promise<void> {
    if (!this.session) throw new AuthError('not-initialized', 'Unlock before changing the PIN');
    const adapter = await this.getAdapter();
    const keyring = await adapter.getMeta<Keyring>(META.keyring);
    if (!keyring) throw new AuthError('not-initialized', 'Workspace has not been set up');
    const params: DerivationParams = { salt: randomSalt(), iterations: this.iterations };
    const pinKek = await deriveWrappingKey(pin, params);
    const nextKeyring: Keyring = {
      ...keyring,
      pin: { params, wrapped: await wrapDataKey(this.session.dek, pinKek) },
    };
    await adapter.putMeta(META.keyring, nextKeyring);
    await this.session.db.audit('security', 'pin.set');
  }

  async removePin(): Promise<void> {
    const adapter = await this.getAdapter();
    const keyring = await adapter.getMeta<Keyring>(META.keyring);
    if (!keyring) return;
    const { pin: _removed, ...rest } = keyring;
    await adapter.putMeta(META.keyring, { ...rest } as Keyring);
    await this.session?.db.audit('security', 'pin.removed');
  }

  // --------------------------------------------------------- teardown

  /** Test/support helper: closes the underlying adapter. */
  async close(): Promise<void> {
    this.session = null;
    this.adapter?.close();
    this.adapter = null;
  }
}

/** App-wide singleton used by the UI layer. */
export const authService = new AuthService();
