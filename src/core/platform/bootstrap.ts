/**
 * Platform bootstrap (Phase 6) — runs once at app start, BEFORE any storage
 * is opened. In a native shell it binds durable file storage + the OS
 * keystore to the AuthService singleton; in the browser it is a no-op and
 * IndexedDB + passphrase-only unlock are used exactly as before.
 */
import { authService } from '../auth/authService';
import { FileBackedAdapter } from '../storage/fileBackedAdapter';
import { nativeBindings } from './nativeBridges';
import { detectPlatform } from './platform';

export function bootstrapPlatform(): void {
  const kind = detectPlatform();
  if (kind === 'browser' || kind === 'test') return;
  const { fileStore, keyStore } = nativeBindings();
  authService.configure({
    adapterFactory: fileStore ? async () => new FileBackedAdapter(fileStore) : undefined,
    keyStore,
  });
}
