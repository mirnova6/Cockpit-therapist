# Browser → Native Migration (Phase 6)

Status: **implemented via the hardened encrypted backup pipeline**, plus this
recommended procedure. Verified by `src/core/storage/performance.test.ts`
("browser → native migration").

## Principle

There is **no plaintext migration file** and no separate migration format. The
same encrypted backup that protects the workspace is the migration vehicle:
records move as AES-GCM ciphertext envelopes and are only ever readable with the
original passphrase.

## Procedure

1. **Export from the browser build.** Settings → Backup & restore → *Create
   backup*. This produces `cockpit-backup-YYYY-MM-DD.json` (format v2:
   checksum + counts + schema stamp).
2. **Move the file** to the native device by any means the clinician trusts.
   The file is encrypted; its safety in transit does not depend on the channel,
   though good practice still applies.
3. **Import into the native app.** On first run (or Settings → Backup &
   restore → *Choose file…*), the app shows a **restore preview** built by
   `inspectBackup`:
   - format version, creation date, schema compatibility,
   - record / attachment / collection counts,
   - keyring presence,
   - **integrity check** (checksum valid / mismatch / legacy).
4. **Dry-run then restore.** The restore path runs `restoreBackup(..., { dryRun:
   true })` first; only if that passes does it write. A corrupt or incompatible
   file is **refused before any write** — the native workspace is never left
   half-populated.
5. **Unlock** with the same passphrase that protected the backup. On native
   storage, optionally enable OS device unlock afterward.

## Integrity verification

- **Checksum** (v2): SHA-256 over a canonical serialization of meta+records+
  blobs. Any post-export modification is detected and blocks restore.
- **Structural checks**: every record/blob must carry a ciphertext envelope; a
  keyring must be present (or the restored workspace could never be unlocked).
- **Compatibility**: this build understands backup v1 (legacy, no checksum) and
  v2. A differing v2 `schemaVersion` is surfaced as a caution, not a silent
  proceed.

## Version compatibility

| Backup | This build | Behavior |
| --- | --- | --- |
| v1 (legacy) | v2-aware | Restores; warns that no checksum is present |
| v2 same schema | v2 | Restores with full integrity verification |
| v2 newer schema | v2 | Restores envelopes; warns to check app version |
| Non-Cockpit / corrupt | any | Refused with a clear message; nothing written |

## Failure messages

All refusals are human-readable and specific: "Checksum mismatch — the backup
file appears corrupted or was modified. Restore is refused.", "The backup has no
keyring — it cannot be unlocked after restore.", etc. No partial state is ever
produced.

## Deliberately out of scope

- Live in-place migration of the IndexedDB store into native storage without a
  backup (unnecessary and riskier than the verified export/import path).
- Automatic device-to-device sync (a multi-user / networked concern deferred to
  a later phase).
