/**
 * Capacitor config scaffold (Phase 6 — illustrative, not wired here).
 *
 * webDir points at the built web bundle. The mobile shell adds:
 *   @capacitor/filesystem            → FileStore (app-private Documents dir)
 *   capacitor secure-storage plugin  → SecureKeyStore (iOS Keychain / Android Keystore)
 *
 * iOS: enable Keychain sharing entitlement and NSFileProtectionComplete so
 *      files are unreadable while the device is locked.
 * Android: Keystore-backed secure storage; set android:allowBackup="false"
 *      unless an encrypted backup policy is defined.
 *
 * The web layer binds these via src/core/platform/nativeBridges.ts.
 */
import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'app.cockpit.therapist',
  appName: 'Cockpit',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
    // No cleartext traffic; only explicitly-approved AI endpoints are reached
    // at runtime, and only when the clinician enables online mode.
    cleartext: false,
  },
  plugins: {
    // Filesystem and SecureStorage plugin options are added when the mobile
    // shell is built. No analytics/telemetry plugins are permitted.
  },
};

export default config;
