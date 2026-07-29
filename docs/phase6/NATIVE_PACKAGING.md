# Native Packaging Plan (Phase 6)

Status: **plan + scaffolding prepared.** The browser build is unchanged and
remains the reference target. This document describes how the existing
React/Vite UI and platform-agnostic core are wrapped for native distribution
**without rewriting the app**.

## Why the app is already packaging-ready

The core was built platform-agnostic from Phase 1:

- **UI** is a static Vite bundle (`npm run build` → `dist/`). Any native shell
  that can host a web view can load it.
- **Domain logic** (`src/core/**`) has no React and no direct storage/OS calls
  outside two seams:
  - `StorageAdapter` — persistence engine (IndexedDB today; `FileBackedAdapter`
    added in Phase 6 for native filesystems).
  - `SecureKeyStore` — OS key storage (Null in browser; native keystore bridges
    prepared in Phase 6).
- `AuthService` accepts an `adapterFactory` and a `keyStore` at construction, so
  a native bootstrap injects the durable adapter and OS keystore with **zero
  changes to feature code**.

## Desktop — Tauri (macOS, Windows)

Chosen for small binaries, Rust security posture, and OS keychain access.

Scaffold: `native/tauri/` (config skeleton + storage/keystore command stubs).

Integration steps:

1. `npm create tauri-app` alongside this repo, or add `@tauri-apps/cli` and a
   `src-tauri/` directory. Point `build.distDir` at this project's `dist/` and
   `build.devPath` at the Vite dev server.
2. Implement two Tauri command groups (Rust) that the web layer calls via
   `@tauri-apps/api` `invoke`:
   - **Filesystem**: `read_file`, `write_file`, `remove_file`, `list_dir`
     under the app-data directory (`$APPDATA/Cockpit` on Windows,
     `~/Library/Application Support/Cockpit` on macOS). These back the
     `FileStore` interface consumed by `FileBackedAdapter`.
   - **Keychain**: `keychain_get`, `keychain_set`, `keychain_delete` using the
     `keyring` crate (macOS Keychain / Windows Credential Manager). These back
     the `SecureKeyStore` interface.
3. In a native bootstrap (`src/core/platform/nativeBridges.ts`, prepared),
   detect Tauri and build `AuthService` with `adapterFactory` →
   `FileBackedAdapter(tauriFileStore)` and `keyStore` → `tauriSecureKeyStore`.
4. Ship signed builds: macOS notarization + Windows Authenticode.

Data directory is chosen to be **backup-safe** (included in OS user-data
backups such as Time Machine) and outside the web cache that browsers evict.

## Mobile — Capacitor (iOS, Android)

Chosen because it reuses the same web bundle and has first-class Keychain/
Keystore and Filesystem plugins.

Scaffold: `native/capacitor/` (config skeleton).

Integration steps:

1. `npm i @capacitor/core @capacitor/cli` and `npx cap init`; set `webDir` to
   `dist/`.
2. Add `@capacitor/filesystem` (Documents directory, excluded from iCloud if
   desired) and a secure-storage plugin (`@capacitor-community/secure-storage`
   or `capacitor-secure-storage-plugin`) backing `FileStore` and
   `SecureKeyStore`.
3. iOS: enable Keychain sharing entitlement; set `NSFileProtectionComplete` so
   files are inaccessible while the device is locked. Android: use
   `EncryptedFile`/Keystore-backed storage; set `android:allowBackup="false"`
   unless an encrypted backup policy is defined.
4. Same bootstrap injection as desktop.

## Future shell replacement

Because everything native lives behind `FileStore` + `SecureKeyStore` +
`adapterFactory`, swapping Tauri/Capacitor for Electron, a PWA with the File
System Access API, or a future shell means implementing those two small
interfaces — no domain or UI rewrite.

## What does NOT change

- Encryption model (AES-256-GCM, PBKDF2 KEK wrapping) is identical on every
  platform; native shells store the **same ciphertext envelopes**.
- Client isolation, review gates, risk safeguards, AI provider controls,
  evaluation harness, and audit logging are platform-independent.
- The passphrase system is preserved everywhere; OS device unlock is an
  additive convenience, never a replacement or backdoor.
