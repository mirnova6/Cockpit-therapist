# Cockpit native shells (Phase 8)

The web app is platform-agnostic. Native desktop (Tauri) and mobile (Capacitor)
shells implement only two small seams — `FileStore` and `SecureKeyStore` —
plus platform detection. Everything written to disk or the OS keychain is
AES-256-GCM ciphertext produced by the web layer; native code never sees
plaintext PHI, prompts, outputs, or unwrapped keys.

**Honesty:** the Rust source **compile-verifies** — `cargo check` and
`cargo clippy --all-targets` both pass clean, and CI runs `cargo check` on every
change so it cannot silently rot. But **no signed binary is produced**: that
needs macOS and Windows hosts plus signing certificates, none of which exist
here. The exact blockers to a distributable build are listed below. Nothing is
simulated as "built".

> **Corrected 2026-07-29.** This file previously stated that Rust was not
> available and described the project as "buildable" on that basis. Rust *is*
> available in the development environment, and when the code was actually
> compiled for the first time it **failed** — `tauri::generate_context!` panicked
> because `icons/icon.png` did not exist. The icon set has been added and the
> code now compiles. The lesson is recorded rather than quietly fixed: "should
> build" was never verified until someone ran the compiler.

> **The committed icons are placeholders** — a flat brand-coloured mark generated
> programmatically so the build has something valid to embed. They must be
> replaced with a real icon set before any distributable build.

## Web-side contract (already wired)

| Contract | Method | Tauri command | Capacitor |
| --- | --- | --- | --- |
| FileStore | read | `cockpit_read_file` | Filesystem.readFile |
| FileStore | write | `cockpit_write_file` | Filesystem.writeFile |
| FileStore | remove | `cockpit_remove_file` | Filesystem.deleteFile |
| FileStore | list | `cockpit_list_dir` | Filesystem.readdir |
| SecureKeyStore | get | `cockpit_keychain_get` | SecureStorage.get |
| SecureKeyStore | set | `cockpit_keychain_set` | SecureStorage.set |
| SecureKeyStore | delete | `cockpit_keychain_delete` | SecureStorage.remove |

Bound in `src/core/platform/nativeBridges.ts`; selected at start by
`bootstrapPlatform()`. Detection: `detectPlatform()` / `runtimeEnvironment()`.
The same encrypted envelopes are written on every platform — the crypto and
schema do not change across shells.

## Desktop (Tauri 2) — `native/tauri/`

Real project: `src-tauri/Cargo.toml`, `tauri.conf.json`, `build.rs`,
`src/main.rs` (file + keychain + os commands), `capabilities/default.json`.

```bash
# prerequisites: Rust (rustup), Node; platform build tools
cd native/tauri
npm install                # installs @tauri-apps/cli
npm run dev                # runs the app against the dev server
npm run build              # produces dmg/app (macOS) or msi/nsis (Windows)
```

### Exact blockers to a distributable desktop build

1. ~~Rust toolchain~~ — **resolved.** Rust is available and the code
   compile-verifies; CI runs `cargo check` (see the `native` job in
   `.github/workflows/ci.yml`). On Linux this needs
   `libgtk-3-dev libwebkit2gtk-4.1-dev librsvg2-dev pkg-config`.
2. **macOS build must run on macOS** (Xcode Command Line Tools) to produce
   `.app`/`.dmg`; **Windows build must run on Windows** (MSVC Build Tools) for
   `.msi`/`.nsis`. Cross-compilation of signed installers is out of scope.
3. **Code-signing + notarization identities** are required for a distributable:
   an Apple Developer ID certificate + notarization for macOS; an Authenticode
   certificate for Windows. These secrets are intentionally not in the repo.
4. **Icon set** — placeholders are committed so the build compiles. Replace them
   with a real set (`npm run tauri icon` from a source PNG) before shipping.

Until 2–4 are done on the appropriate machines, the desktop app is
**code-complete and compile-verified, but not built or signed** — treated as a
blocker in the Real PHI Readiness Gate and the deployment decision report.

## Mobile (Capacitor) — `native/capacitor/`

Real config: `capacitor.config.ts` (appId, webDir, no cleartext, no telemetry).

```bash
# from the repo root, after `npm run build`
npm install @capacitor/core @capacitor/cli @capacitor/filesystem
npx cap init --web-dir dist      # uses native/capacitor/capacitor.config.ts values
npx cap add ios                  # requires macOS + Xcode
npx cap add android              # requires Android Studio/SDK
npx cap copy
npx cap open ios | android       # build/run from the IDE
```

Add a secure-storage plugin (iOS Keychain / Android Keystore) for
`SecureKeyStore`; `@capacitor/filesystem` backs `FileStore` (Directory.Data).

### Exact blockers to installable mobile apps

1. **iOS requires macOS + Xcode** and an Apple Developer account + provisioning
   profile / signing identity.
2. **Android requires the Android SDK/Android Studio** and a signing keystore.
3. A **secure-storage plugin** must be selected and configured; set
   `NSFileProtectionComplete` (iOS) and `allowBackup="false"` (Android).
4. On-device validation can only be performed on real hardware — see
   `docs/phase8/DEVICE_TESTING.md`.

Until 1–4 are done, mobile is **planned with a real config + exact blockers**,
not built — reflected honestly in the app's runtime indicator (it never shows
native-mobile capabilities in the browser build) and in the release checklist.
