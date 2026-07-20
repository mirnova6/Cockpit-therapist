# Production Blocker List (Phase 6)

Gates before each level of use. Nothing here is a compliance claim; the app
itself never asserts readiness for real PHI.

## A. Must fix before FICTIONAL testing
_(Baseline for running the app safely with made-up data.)_

- [x] Encrypted-at-rest storage with no plaintext PHI (verified).
- [x] Passphrase unlock, auto-lock, failed-attempt lockout.
- [x] Client isolation across all repositories and retrieval.
- [x] Backup export + integrity-checked restore with preview.
- [x] AI online mode disabled by default; deterministic mode always available.
- [x] Evaluation harness runs in an ephemeral sandbox (no real-client mixing).
- [x] All automated tests green (`npm test`, `node e2e/smoke.mjs`).

_Status: cleared for fictional testing in the browser build._

## B. Must fix before DE-IDENTIFIED testing
_(Real-world-shaped data with identifiers removed, on a real device.)_

- [ ] Native packaging (Tauri desktop and/or Capacitor mobile) built and signed.
- [ ] Durable native file storage wired (FileBackedAdapter over the OS filesystem).
- [ ] OS device-unlock wired to the platform keystore (bridges implemented).
- [ ] Real-device testing checklist executed on at least one desktop + one mobile target.
- [ ] Backup/restore verified on-device with the restore preview.
- [ ] Documented de-identification procedure performed OUTSIDE the app.

## C. Must fix before REAL PHI, LOCAL-ONLY use
_(Local-first, no online AI, real client data.)_

- [ ] Independent security review of crypto + storage completed.
- [ ] Penetration test of native builds.
- [ ] Legal review of consent/disclosure wording and jurisdiction requirements.
- [ ] Practice policies documented: data retention, incident response, device security.
- [ ] Verified backup schedule and tested restore procedure.
- [ ] Secure-deletion residual-data assumptions reviewed for the target OS/hardware.
- [ ] Readiness checklist categories A–M marked "Reviewed" in-app.

## D. Must fix before ONLINE PHI processing
- [ ] Signed BAA/contract with each online provider, recorded in the approval registry.
- [ ] Provider approval registry entry approved, unexpired, with allowed purposes set.
- [ ] **Server-side proxy** implemented so PHI does not transit directly browser→provider (see `ONLINE_PROXY_PLAN.md`). Direct-browser mode is for fictional/dev use.
- [ ] Emergency kill switch and refusal paths tested with fictional data.
- [ ] Legal confirmation the provider arrangement covers the intended uses.

## E. Must fix before ORGANIZATIONAL / MULTI-USER use
- [ ] Per-user authentication, roles, and per-user audit attribution.
- [ ] Server-side or synchronized storage with its own security review.
- [ ] Centralized provider governance / admin controls.
- [ ] Data-sharing and access-control policies for multiple clinicians.
- [ ] Availability, backup, and disaster-recovery plan for shared storage.

---

Legend: `[x]` implemented/verified in this repo · `[ ]` outstanding blocker.
