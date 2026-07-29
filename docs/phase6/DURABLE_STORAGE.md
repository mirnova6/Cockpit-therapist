# Durable Local Storage (Phase 6)

Status: **native adapter implemented and tested; native bridge stubs prepared.**
The browser IndexedDB adapter is unchanged and remains the default.

## What was evaluated

| Option | Verdict |
| --- | --- |
| **File-system backed encrypted storage** | **Chosen for native.** One ciphertext envelope per record/blob under an app-private, backup-safe directory. Simple, durable, no size ceiling, trivially secure-deletable (remove the file). Implemented as `FileBackedAdapter`. |
| SQLite (e.g. SQLCipher) | Strong alternative; better for very large datasets and rich queries. Deferred: the current per-envelope model already satisfies isolation and scale needs, and adding a native SQLite dependency is a larger surface to review. `StorageAdapter` lets us swap to it later with zero domain changes. |
| Native secure storage APIs for bulk data | Rejected for clinical records — keystores are for small secrets (keys), not MBs of transcripts. Used only for the device-unlock wrapping key. |

## `FileBackedAdapter`

- Implements the existing `StorageAdapter` interface exactly, so the browser
  build and all domain/feature code are untouched.
- Stores the **same AES-GCM ciphertext envelopes** as IndexedDB — encryption is
  unchanged; files on disk are ciphertext only (verified in tests).
- Written against a tiny `FileStore` interface (`read/write/remove/list`) so it
  is fully testable today (`MemoryFileStore`) and bindable to native bridges
  (Tauri fs, Capacitor Filesystem) with no logic changes.
- **Large transcript/document storage**: each envelope is its own file, so there
  is no single-database size limit; a ~1.4 MB transcript round-trips in tests.
- **Secure deletion**: `deleteRecord`/`deleteBlob` remove the ciphertext file;
  client deletion cascades as before.
- **Backup-safe data directory**: native shells point the `FileStore` at the OS
  app-data directory (Time Machine / OS backup inclusive), not the evictable web
  cache.

## Device-level persistence

- **Browser (dev)**: IndexedDB. Durable but subject to browser eviction under
  storage pressure — documented; backups are the safety net.
- **Native**: OS filesystem persists across app restarts and reboots; verified
  behavior belongs on the real-device checklist.

## Wiring (prepared)

`AuthService` accepts an `adapterFactory`; the native bootstrap injects
`() => new FileBackedAdapter(nativeFileStore)`. Nothing else changes. See
`src/core/platform/nativeBridges.ts` for the guarded bridge stubs and
`NATIVE_PACKAGING.md` for the shell integration.

## Tests

`src/core/storage/fileBackedAdapter.test.ts` (interface contract, full-workspace
run, isolation, encrypted-at-rest, large transcript) and
`src/core/storage/performance.test.ts` (50 clients, 1.4 MB transcript,
browser→native migration).
