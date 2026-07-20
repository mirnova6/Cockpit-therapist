# Native packaging scaffolds

These are **preparation scaffolds**, not built binaries. They document the
exact contract each native shell must implement so the existing web bundle
(`dist/`) and platform-agnostic core run natively with no domain/UI changes.

- `tauri/` — desktop (macOS, Windows). Implements the `FileStore` and
  `SecureKeyStore` contracts as Tauri commands.
- `capacitor/` — mobile (iOS, Android). Uses Filesystem + secure-storage
  plugins for the same two contracts.

The web side binds to these via `src/core/platform/nativeBridges.ts` and
`src/core/platform/bootstrap.ts`. See `docs/phase6/NATIVE_PACKAGING.md`.

The bridge command/plugin names are the whole integration surface:

| Contract | Method | Tauri command | Capacitor |
| --- | --- | --- | --- |
| FileStore | read | `cockpit_read_file` | Filesystem.readFile |
| FileStore | write | `cockpit_write_file` | Filesystem.writeFile |
| FileStore | remove | `cockpit_remove_file` | Filesystem.deleteFile |
| FileStore | list | `cockpit_list_dir` | Filesystem.readdir |
| SecureKeyStore | get | `cockpit_keychain_get` | SecureStorage.get |
| SecureKeyStore | set | `cockpit_keychain_set` | SecureStorage.set |
| SecureKeyStore | delete | `cockpit_keychain_delete` | SecureStorage.remove |

Everything stored through these is **AES-GCM ciphertext**; the native layer
never sees plaintext PHI.
