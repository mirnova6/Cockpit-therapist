# Real-device testing checklist (Phase 8)

Use FICTIONAL or fully DE-IDENTIFIED data only. Real PHI remains blocked by the
Real PHI Readiness Gate. Run every row per platform and record pass/fail with
notes in the in-app beta guided checklist (`/beta`).

Platforms: **macOS · Windows · iPhone · iPad · Android phone · Android tablet**

For each platform, verify:

| # | Step | Expected |
| --- | --- | --- |
| 1 | Installation | App installs from the built package without errors. |
| 2 | First launch | App opens; runtime indicator shows the correct native mode (not "browser development"). |
| 3 | Workspace setup | Create workspace with passphrase (+ optional PIN). |
| 4 | Unlock | Lock, then unlock with passphrase; unlock with PIN if set. |
| 5 | Failed unlock | Wrong passphrase is rejected. |
| 6 | Lockout | Repeated failures trigger escalating lockout. |
| 7 | Auto-lock | Idle past the interval locks the workspace and clears the key. |
| 8 | Device unlock | Where OS key storage exists, enable device unlock and verify; wiping/removing the OS key forces passphrase unlock (no backdoor). |
| 9 | Create/edit/archive/delete client | Full client lifecycle works; delete cascades. |
| 10 | Add clinical information | Add a session transcript and other input types. |
| 11 | Add attachment | Attach a file; it is stored encrypted. |
| 12 | Add assessment | Record PHQ-9/GAD-7; interpretation band shows. |
| 13 | Extract facts | Deterministic extraction proposes facts with evidence. |
| 14 | Review facts | Approve/reject per item; risk items require individual review. |
| 15 | Generate DAP note | Deterministic DAP note assembles from approved info. |
| 16 | Generate treatment plan | Plan generates; risk gating enforced on approval. |
| 17 | Use local AI (if configured) | Readiness check is honest; no fake "connected". |
| 18 | Online AI refusal | Without provider approval, online AI is refused. |
| 19 | Backup | Encrypted backup created; integrity badge shown. |
| 20 | Restore | Restore into a fresh workspace returns all data. |
| 21 | Export approved document | Approved doc exports; drafts are watermarked. |
| 22 | Secure deletion | Client deletion removes all associated records. |
| 23 | App restart persistence | Close and reopen; data persists, re-auth required. |
| 24 | Offline behavior | With network off, the app works local-only. |
| 25 | Crash/reopen | Force-quit mid-task, reopen; no corruption or data loss. |

Storage & log checks (all platforms):

- Inspect on-disk app storage: **no plaintext clinical data, prompts, outputs, or API keys** — ciphertext only.
- Inspect logs/console: **no plaintext clinical data**.

Record results and file any issues via the in-app bug report (`/beta` → Report a
bug), which captures structured fields only and requires a "no PHI" confirmation.
