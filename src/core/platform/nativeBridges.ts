/**
 * Native bridge stubs (Phase 6) — bind the Phase 6 storage/key-storage seams
 * to Tauri and Capacitor runtime APIs.
 *
 * HONESTY: these are guarded bridges, not fake behavior. Each one throws a
 * clear error if the expected native runtime API is not actually present, so
 * the app never silently pretends a native capability exists. In the browser
 * build none of this runs — `configureNativeStorage()` is a no-op that keeps
 * IndexedDB + passphrase-only unlock.
 *
 * The Tauri/Capacitor command names below are the contract the native shells
 * implement (see native/tauri and native/capacitor scaffolds). Because the
 * whole surface is `FileStore` + `SecureKeyStore`, wiring a shell is small and
 * requires no domain or UI changes.
 */
import type { SecureKeyStore } from '../auth/secureKeyStore';
import type { FileStore } from '../storage/fileBackedAdapter';
import { detectPlatform } from './platform';

// ------------------------------------------------------------- Tauri

interface TauriInvokeWindow {
  __TAURI_INTERNALS__?: { invoke?: (cmd: string, args?: unknown) => Promise<unknown> };
  __TAURI__?: { core?: { invoke?: (cmd: string, args?: unknown) => Promise<unknown> } };
}

function tauriInvoke(): (cmd: string, args?: unknown) => Promise<unknown> {
  const w = window as unknown as TauriInvokeWindow;
  const invoke = w.__TAURI__?.core?.invoke ?? w.__TAURI_INTERNALS__?.invoke;
  if (!invoke) throw new Error('Tauri runtime is not available.');
  return invoke;
}

/** FileStore backed by Tauri filesystem commands (see native/tauri). */
export function tauriFileStore(): FileStore {
  const invoke = tauriInvoke();
  return {
    read: (path) => invoke('cockpit_read_file', { path }) as Promise<string | undefined>,
    write: (path, content) => invoke('cockpit_write_file', { path, content }) as Promise<void>,
    remove: (path) => invoke('cockpit_remove_file', { path }) as Promise<void>,
    list: (dirPrefix) => invoke('cockpit_list_dir', { dirPrefix }) as Promise<string[]>,
  };
}

/** SecureKeyStore backed by the OS keychain via Tauri (keyring crate). */
export function tauriKeyStore(): SecureKeyStore {
  const invoke = tauriInvoke();
  return {
    label: 'OS Keychain (Tauri)',
    isAvailable: async () => true,
    getSecret: (account) => invoke('cockpit_keychain_get', { account }) as Promise<string | undefined>,
    setSecret: (account, value) => invoke('cockpit_keychain_set', { account, value }) as Promise<void>,
    deleteSecret: (account) => invoke('cockpit_keychain_delete', { account }) as Promise<void>,
  };
}

// --------------------------------------------------------- Capacitor

interface CapacitorFilesystem {
  readFile?: (o: { path: string; directory?: string; encoding?: string }) => Promise<{ data: string }>;
  writeFile?: (o: { path: string; data: string; directory?: string; encoding?: string; recursive?: boolean }) => Promise<unknown>;
  deleteFile?: (o: { path: string; directory?: string }) => Promise<void>;
  readdir?: (o: { path: string; directory?: string }) => Promise<{ files: Array<{ name: string } | string> }>;
  mkdir?: (o: { path: string; directory?: string; recursive?: boolean }) => Promise<unknown>;
}

interface CapacitorWindow {
  Capacitor?: {
    Plugins?: {
      Filesystem?: CapacitorFilesystem;
      SecureStorage?: {
        get?: (o: { key: string }) => Promise<{ value: string | null }>;
        set?: (o: { key: string; value: string }) => Promise<void>;
        remove?: (o: { key: string }) => Promise<void>;
      };
    };
  };
}

/** SecureKeyStore backed by a Capacitor secure-storage plugin. */
export function capacitorKeyStore(): SecureKeyStore {
  const plugin = (window as unknown as CapacitorWindow).Capacitor?.Plugins?.SecureStorage;
  if (!plugin?.get || !plugin.set || !plugin.remove) {
    throw new Error('Capacitor secure-storage plugin is not available.');
  }
  return {
    label: 'OS Keystore (Capacitor)',
    isAvailable: async () => true,
    getSecret: async (account) => (await plugin.get!({ key: account })).value ?? undefined,
    setSecret: (account, value) => plugin.set!({ key: account, value }),
    deleteSecret: (account) => plugin.remove!({ key: account }),
  };
}

/**
 * FileStore backed by the Capacitor Filesystem plugin (Directory.Data). Stores
 * one UTF-8 JSON file per record/blob/meta, exactly like the desktop bridge —
 * the bytes on disk are the same encrypted envelopes. Exercised on-device only;
 * the FileStore CONTRACT is verified headlessly via MemoryFileStore tests.
 */
export function capacitorFileStore(): FileStore {
  const fs = (window as unknown as CapacitorWindow).Capacitor?.Plugins?.Filesystem;
  if (!fs?.readFile || !fs.writeFile || !fs.deleteFile || !fs.readdir) {
    throw new Error('Capacitor Filesystem plugin is not available.');
  }
  const directory = 'DATA';
  return {
    read: async (path) => {
      try {
        return (await fs.readFile!({ path, directory, encoding: 'utf8' })).data;
      } catch {
        return undefined; // not found
      }
    },
    write: async (path, content) => {
      await fs.writeFile!({ path, data: content, directory, encoding: 'utf8', recursive: true });
    },
    remove: async (path) => {
      try {
        await fs.deleteFile!({ path, directory });
      } catch {
        /* already absent */
      }
    },
    list: async (dirPrefix) => {
      try {
        const res = await fs.readdir!({ path: dirPrefix, directory });
        return res.files.map((f) => `${dirPrefix}/${typeof f === 'string' ? f : f.name}`);
      } catch {
        return [];
      }
    },
  };
}

// --------------------------------------------------- bootstrap selection

export interface NativeBindings {
  fileStore?: FileStore;
  keyStore?: SecureKeyStore;
}

/**
 * Returns native bindings for the detected shell, or `{}` in the browser.
 * The app bootstrap passes these to `configureAuthService`; nothing here is
 * exercised in the browser build.
 */
export function nativeBindings(): NativeBindings {
  const kind = detectPlatform();
  try {
    if (kind === 'tauri') return { fileStore: tauriFileStore(), keyStore: tauriKeyStore() };
    if (kind === 'capacitor') {
      // Bind both the durable FileStore and the OS keystore. Each guard throws
      // if its plugin is absent, so a partially-configured shell degrades to
      // browser defaults rather than pretending a capability exists.
      let fileStore: FileStore | undefined;
      let keyStore: SecureKeyStore | undefined;
      try {
        fileStore = capacitorFileStore();
      } catch {
        fileStore = undefined;
      }
      try {
        keyStore = capacitorKeyStore();
      } catch {
        keyStore = undefined;
      }
      return { fileStore, keyStore };
    }
  } catch {
    // Native API not actually present — fall back to browser defaults rather
    // than claim a capability that is not there.
    return {};
  }
  return {};
}
