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

/**
 * A precise, honest runtime descriptor for the environment indicator (Phase 8
 * §2). It never claims a native mode unless the corresponding runtime is
 * actually present. Desktop OS (macOS/Windows) is not reliably knowable from
 * JS alone in Tauri without a plugin call, so the desktop label stays generic
 * until the shell reports it.
 */
export interface RuntimeEnvironment {
  kind: PlatformKind;
  mode: 'browser-development' | 'native-desktop' | 'native-mobile' | 'test';
  os?: 'ios' | 'android' | string;
  label: string;
}

export function runtimeEnvironment(): RuntimeEnvironment {
  const kind = detectPlatform();
  if (kind === 'tauri') {
    return { kind, mode: 'native-desktop', label: 'Native desktop mode (Tauri)' };
  }
  if (kind === 'capacitor') {
    const os = (window as unknown as CapacitorWindow).Capacitor?.getPlatform?.();
    return {
      kind,
      mode: 'native-mobile',
      os,
      label: os ? `Native mobile mode (${os})` : 'Native mobile mode (Capacitor)',
    };
  }
  if (kind === 'test') return { kind, mode: 'test', label: 'Test environment' };
  return { kind, mode: 'browser-development', label: 'Browser development mode' };
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
