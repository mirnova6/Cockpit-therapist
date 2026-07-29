import { afterEach, describe, expect, it, vi } from 'vitest';
import { detectPlatform, platformCapabilities, runtimeEnvironment } from './platform';
import { nativeBindings } from './nativeBridges';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('runtime environment indicator (Phase 8)', () => {
  it('reports browser-development in a plain browser window', () => {
    vi.stubGlobal('window', {});
    const env = runtimeEnvironment();
    expect(env.mode).toBe('browser-development');
    expect(env.label).toContain('Browser');
  });

  it('reports native-desktop for Tauri and never in the browser', () => {
    vi.stubGlobal('window', { __TAURI_INTERNALS__: {} });
    expect(runtimeEnvironment().mode).toBe('native-desktop');
  });

  it('reports native-mobile with the OS for Capacitor', () => {
    vi.stubGlobal('window', { Capacitor: { isNativePlatform: () => true, getPlatform: () => 'ios' } });
    const env = runtimeEnvironment();
    expect(env.mode).toBe('native-mobile');
    expect(env.os).toBe('ios');
  });
});

describe('platform detection', () => {
  it('reports "test" when there is no window (node/vitest)', () => {
    // In the vitest node environment there is no window.
    expect(detectPlatform()).toBe('test');
    const caps = platformCapabilities();
    expect(caps.fileSystemStorage).toBe(false);
    expect(caps.osKeyStorage).toBe(false);
  });

  it('detects a browser window (no native globals)', () => {
    vi.stubGlobal('window', {});
    expect(detectPlatform()).toBe('browser');
    const caps = platformCapabilities();
    expect(caps.kind).toBe('browser');
    expect(caps.label).toContain('Browser');
  });

  it('detects Tauri when its internals are present', () => {
    vi.stubGlobal('window', { __TAURI_INTERNALS__: { invoke: async () => undefined } });
    expect(detectPlatform()).toBe('tauri');
    expect(platformCapabilities().osKeyStorage).toBe(true);
  });

  it('detects Capacitor native platform', () => {
    vi.stubGlobal('window', { Capacitor: { isNativePlatform: () => true } });
    expect(detectPlatform()).toBe('capacitor');
    expect(platformCapabilities().fileSystemStorage).toBe(true);
  });
});

describe('native bindings honesty', () => {
  it('returns no bindings in the browser (keeps IndexedDB + passphrase unlock)', () => {
    vi.stubGlobal('window', {});
    expect(nativeBindings()).toEqual({});
  });

  it('binds Tauri file + key stores when the invoke bridge exists', () => {
    const invoke = vi.fn(async () => undefined);
    vi.stubGlobal('window', { __TAURI__: { core: { invoke } }, __TAURI_INTERNALS__: { invoke } });
    const bindings = nativeBindings();
    expect(bindings.fileStore).toBeDefined();
    expect(bindings.keyStore?.label).toContain('Tauri');
  });

  it('falls back to {} rather than faking a capability when the native API is missing', () => {
    // Looks like Capacitor but the SecureStorage plugin is absent.
    vi.stubGlobal('window', { Capacitor: { isNativePlatform: () => true, Plugins: {} } });
    expect(nativeBindings()).toEqual({});
  });
});
