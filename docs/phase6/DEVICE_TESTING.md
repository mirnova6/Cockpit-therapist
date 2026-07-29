# Real-Device Testing Checklist (Phase 6)

Use **fictional or fully de-identified data only.** Do not put real client
information on any device until the Production Blocker List and an independent
security review are cleared.

Run every row on each target. Record pass/fail, device, OS version, and notes.

Targets: **macOS desktop · Windows desktop · iPhone · iPad · Android phone ·
Android tablet.**

| # | Test | macOS | Windows | iPhone | iPad | Android phone | Android tablet | Notes |
|---|------|:--:|:--:|:--:|:--:|:--:|:--:|---|
| 1 | App launches cleanly (cold start) | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | |
| 2 | First-run setup creates encrypted workspace | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | |
| 3 | Unlock with passphrase | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | |
| 4 | Unlock with PIN (if enabled) | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | |
| 5 | OS device unlock (Keychain/Keystore) enable + use | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | native only |
| 6 | Auto-lock after inactivity clears session | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | |
| 7 | Failed unlock → lockout backoff | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | |
| 8 | Create client; data appears immediately | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | |
| 9 | Data persists after full app restart | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | |
| 10 | Data persists after device reboot | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | |
| 11 | Backup export writes a file | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | |
| 12 | Backup restore preview shows counts + integrity | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | |
| 13 | Backup restore completes and re-unlocks | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | |
| 14 | Corrupt backup is refused (no partial restore) | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | |
| 15 | File attachment stores + reopens | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | |
| 16 | Large transcript (≥1 MB) saves + reopens | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | |
| 17 | Local AI connects (Ollama/LM Studio) + readiness passes | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | desktop primarily |
| 18 | Offline mode: full app works with no network | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | |
| 19 | Online mode refuses without approval/attestation | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | |
| 20 | Emergency online kill switch blocks all online sends | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | |
| 21 | Performance acceptable with 50 clients | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | |
| 22 | Performance acceptable with large notes/transcripts | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | |
| 23 | Navigation usable on small screens (grouped nav) | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | |
| 24 | Backgrounding the app locks per auto-lock policy | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | mobile |
| 25 | No plaintext PHI in app data directory / logs | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | inspect files |

Automated coverage that de-risks the manual pass (`npm test`, `node
e2e/smoke.mjs`): storage adapter contract, 50-client + large-transcript scale,
migration, backup integrity/preview/dry-run, device-unlock (incl. no-backdoor),
kill-switch persistence, online refusal, encrypted-at-rest, cross-client
isolation.

## Device inspection notes

- **macOS**: `~/Library/Application Support/Cockpit/` should contain only
  ciphertext JSON envelopes; keychain entry under the app's service name.
- **Windows**: `%APPDATA%\Cockpit\`; Credential Manager entry.
- **iOS/iPadOS**: app sandbox Documents; verify `NSFileProtectionComplete`.
- **Android**: app-private storage; verify no world-readable files and
  `allowBackup` policy is intentional.
