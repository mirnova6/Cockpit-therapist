# Security Review Checklist (Phase 6)

**The app is NOT ready for real PHI until an independent security review is
completed.** This checklist is a preparation tool for that review, not a
compliance attestation.

Each item: status (☐/✅/⚠️/N/A), reviewer, date, evidence.

## Encryption
- [ ] AES-256-GCM for every record and blob at rest. *Evidence: `cryptoService.test.ts`; E2E encrypted-at-rest check; file/IndexedDB dumps contain no plaintext PHI.*
- [ ] Random 256-bit DEK per workspace; never persisted unwrapped.
- [ ] Ciphertext envelopes identical across IndexedDB and native file storage.

## Key management
- [ ] KEK derived via PBKDF2-SHA256, 310k iterations, per-slot random salt.
- [ ] DEK in memory only; discarded on lock.
- [ ] OS device-unlock secret stored ONLY in the platform keystore; no backdoor. *Evidence: `deviceUnlock.test.ts`.*
- [ ] Provider API keys stored only inside encrypted records; never plaintext, never in logs.

## Locking
- [ ] Auto-lock clears the in-memory key after inactivity and on backgrounding.
- [ ] Failed-unlock lockout with escalating backoff.
- [ ] Locking cancels in-flight AI operations and clears all AI/governance state.

## Local storage
- [ ] Native data directory is app-private and backup-safe.
- [ ] iOS `NSFileProtectionComplete`; Android Keystore-backed / non-world-readable.
- [ ] Browser IndexedDB acceptable for development only (eviction risk documented).

## Backup & restore
- [ ] Backups are encrypted envelopes only; no plaintext. *Evidence: `backupService.test.ts`, `backupHardening.test.ts`.*
- [ ] v2 checksum detects corruption; restore refuses corrupt/incompatible files.
- [ ] No partial restore; dry-run available; restore preview shows counts.

## Secure deletion
- [ ] Client deletion cascades across every collection incl. embeddings, AI ops, feedback. *Evidence: `governance.test.ts`, `database.test.ts`.*
- [ ] Native file deletion removes the ciphertext file.
- [ ] (Reviewer note) OS/SSD wear-leveling means logical delete ≠ physical erasure — document residual-data assumptions.

## Export safety
- [ ] Only approved documents export; drafts watermarked.
- [ ] No internal instructions, key material, or hidden reasoning in exports.
- [ ] Embeddings excluded from client exports by default.
- [ ] Single-client plaintext export is behind an explicit warning and audited.

## AI provider keys
- [ ] Keys encrypted at rest; entered via password fields; never echoed back.
- [ ] Key-rotation reminders in the provider approval registry.

## Online AI controls
- [ ] Online disabled by default. *Evidence: `aiGateway.test.ts`.*
- [ ] PHI refused without provider approval + attestation + consent + confirmed preview.
- [ ] Per-client local-only override; emergency kill switch. *Evidence: `governance.test.ts`.*
- [ ] Outbound preview shows exact bytes; redaction disclosed as imperfect.

## Audit logs
- [ ] Security-relevant actions audited without clinical plaintext.
- [ ] AI operations log stores identifiers/metadata only (no prompt text).

## Cross-client isolation
- [ ] Repositories, retrieval, gateway, embeddings, and pre-save checks reject cross-client references. *Evidence: `clientRetrieval.test.ts`, `aiGateway.test.ts`.*
- [ ] Isolation holds after backup/restore and after migration. *Evidence: `backupHardening.test.ts`, `performance.test.ts`.*

## Prompt injection
- [ ] Client/knowledge text fenced as untrusted data; instructions inside remain inert. *Evidence: `pipeline.test.ts`, E2E injection check.*
- [ ] AI providers have no database write authority.

## Native packaging
- [ ] Web view configured with strict CSP; no remote code loading.
- [ ] Tauri allowlist / Capacitor permissions minimized to filesystem + keystore.
- [ ] Code signing / notarization for each platform.

## OS permissions
- [ ] Only filesystem (app dir) and keystore requested; no camera/mic/location/contacts.
- [ ] No background network unless online AI is explicitly enabled by the clinician.

## Crash logs & telemetry
- [ ] No analytics/telemetry SDKs. *Evidence: dependency review.*
- [ ] Crash reporters (if any) must NOT capture clinical content or memory dumps.

## Device-compromise assumptions
- [ ] Documented: application encryption cannot defend a compromised OS (malware, screen capture, coerced unlock, jailbreak/root).
- [ ] Guidance: device disk encryption, OS updates, screen lock required.

## Legal/security review before PHI use
- [ ] Independent code + crypto review completed.
- [ ] Penetration test of native builds.
- [ ] Counsel review of consent/disclosure wording and jurisdiction requirements.
- [ ] BAAs executed for any online provider before PHI.
