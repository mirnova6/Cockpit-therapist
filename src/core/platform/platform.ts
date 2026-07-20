/**
 * Platform detection (Phase 6) — the single place that answers "what shell
 * are we running in?" so storage and key-storage adapters can be selected
 * without sprinkling environment checks through the app.
 *
 * Honesty rule: a capability is reported ONLY when its runtime bridge is
 * actually present. The browser build reports browser, full stop.
 */

export type PlatformKind = 'browser' | 'tauri' | 'capacitor' | 'test';

interface TauriWindow {
  __TAURI_INTERNALS__?: unknown;
  __TAURI__?: unknown;
}

interface CapacitorWindow {
  Capacitor?: { isNativePlatform?: () => boolean; getPlatform?: () => string };
}

export function detectPlatform(): PlatformKind {
  if (typeof window === 'undefined') return 'test';
  const w = window as unknown as TauriWindow & CapacitorWindow;
  if (w.__TAURI_INTERNALS__ !== undefined || w.__TAURI__ !== undefined) return 'tauri';
  if (w.Capacitor?.isNativePlatform?.()) return 'capacitor';
  return 'browser';
}

export interface PlatformCapabilities {
  kind: PlatformKind;
  /** Durable file-system storage bridge available (native shells only). */
  fileSystemStorage: boolean;
  /** OS-level secure key storage bridge available (native shells only). */
  osKeyStorage: boolean;
  label: string;
}

export function platformCapabilities(): PlatformCapabilities {
  const kind = detectPlatform();
  switch (kind) {
    case 'tauri':
      return {
        kind,
        fileSystemStorage: true,
        osKeyStorage: true,
        label: 'Native desktop (Tauri)',
      };
    case 'capacitor':
      return {
        kind,
        fileSystemStorage: true,
        osKeyStorage: true,
        label: 'Native mobile (Capacitor)',
      };
    case 'test':
      return { kind, fileSystemStorage: false, osKeyStorage: false, label: 'Test environment' };
    default:
      return {
        kind: 'browser',
        fileSystemStorage: false,
        osKeyStorage: false,
        label: 'Browser (development) — IndexedDB storage, passphrase-only unlock',
      };
  }
}
