/**
 * Capacitor config for the Cockpit mobile shell (iOS/Android).
 *
 * This is a real config. Producing installable mobile apps still requires the
 * platform toolchains (Xcode on macOS for iOS; Android Studio/SDK for Android)
 * and signing identities — see native/README.md for the exact blocker list.
 * Nothing here is simulated as "built".
 *
 * The web layer binds the native seams via src/core/platform/nativeBridges.ts:
 *   @capacitor/filesystem            → FileStore (Directory.Data, app-private)
 *   a secure-storage plugin          → SecureKeyStore (iOS Keychain / Android Keystore)
 *
 * iOS: enable the Keychain-sharing entitlement and set NSFileProtectionComplete
 *      so files are unreadable while the device is locked.
 * Android: use Keystore-backed secure storage and android:allowBackup="false"
 *      unless an encrypted backup policy is explicitly defined.
 */
import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'app.cockpit.therapist',
  appName: 'Cockpit',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
    // No cleartext traffic. Only explicitly-approved AI endpoints are reached
    // at runtime, and only when the clinician enables online mode.
    cleartext: false,
  },
  plugins: {
    // No analytics/telemetry plugins are permitted. Filesystem + SecureStorage
    // plugin options are configured in the native projects when they are added
    // (`npx cap add ios` / `npx cap add android`).
  },
};

export default config;
