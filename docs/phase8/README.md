# Phase 8 — Beta, native packaging execution, real-device validation & deployment prep

Phase 8 moves the app from a browser-based, fully-tested prototype toward a real
packaged beta for **fictional or fully de-identified data only**. It adds no new
clinical intelligence, preserves all Phase 1–7 protections, and does **not**
bypass the Phase 7 Real PHI Readiness Gate or claim HIPAA compliance.

## Native packaging status (honest)

The web app is platform-agnostic. Native shells implement only `FileStore` +
`SecureKeyStore` + platform detection, all already wired in
`src/core/platform/`. Everything written to disk / the OS keychain is
AES-256-GCM ciphertext produced by the web layer.

| Target | State | Blockers to a distributable build |
| --- | --- | --- |
| Desktop (macOS/Windows) | **Code + config complete, buildable** — real Tauri 2 project in `native/tauri/` (`Cargo.toml`, `tauri.conf.json`, `src/main.rs` with file/keychain/os commands, capabilities). **Not built/signed here.** | Rust toolchain; build on macOS *and* Windows; Apple Developer ID + notarization / Windows Authenticode certs; icon set. |
| Mobile (iOS/Android) | **Config complete** — real `native/capacitor/capacitor.config.ts`; web-side FileStore + keystore bridges implemented. **Not built here.** | macOS + Xcode (iOS), Android SDK (Android); signing identities; secure-storage plugin; on-device validation. |

Full steps + exact blockers: `native/README.md`.

## What ships in this phase (implemented & tested here)

- **Web-side native seams completed**: Capacitor `FileStore` added (both desktop
  and mobile now bind file storage + keystore); precise `runtimeEnvironment()`
  indicator (browser-development / native-desktop / native-mobile) surfaced in
  Device & storage settings — never claims a native mode that isn't present.
- **Beta Testing Mode** (`/beta`): global banner ("fictional or fully
  de-identified data only … real PHI remains blocked"), sample fictional
  workspace seeding (clearly `[FICTIONAL]`), guided testing checklist, PHI-free
  bug reporting (requires a "no PHI" confirmation, captures structured fields
  only), feedback, and an exportable beta test report.
- **Release checklist + deployment decision report** (`/release`): human-tracked
  release items plus a live-state deployment classification that **defaults to
  "Ready for fictional-data beta"** and never to real-PHI readiness; performance
  snapshot of live read timings.
- **Performance/stress tests**: 50-client workspace, large transcripts, and
  native-mode backup/restore with a large workspace — with recorded timings.

## E2E harness isolation (hardening patch)

The browser E2E harness previously bound a hard-coded port (4173, `--strictPort`),
so runs could contend with each other or with a stale server. It now:

- takes an **OS-assigned free port per run** (`E2E_PARALLEL` runs can execute
  concurrently; `E2E_FORCE_PORT` exists only to exercise the guards);
- starts **its own preview server** and treats readiness as "the server actually
  answers with our build", not merely a log line — it polls `index.html`, compares
  the served entry-bundle hash against `dist/index.html`, and fetches the bundle;
- **aborts loudly with a non-zero exit** if a stale or foreign server answers the
  port, rather than testing the wrong build, and re-verifies the served build id
  at the end of the run;
- uses a **throwaway browser profile** (`mkdtemp`) per run;
- **always tears down** server + profile — via `finally` plus `exit`, `SIGINT`,
  `SIGTERM`, `SIGHUP`, and `uncaughtException` handlers.

`npm run test:e2e:repeat` runs the whole suite 20 consecutive times and reports a
flake summary (per-run ports, check counts, and any failing check names).

### Encrypted-at-rest check strengthened

The old check substring-scanned the raw IndexedDB dump for PHI markers. Because
payloads are stored as **base64** ciphertext, the four-character token `PTSD`
collided with random ciphertext ~1% per 500 KB — a false positive, not a leak
(verified by simulation; a real run scans ~289 KB across ~249 records). The check
now makes two independent guarantees: a **structural positive proof** that every
record payload is exactly an `{iv, data}` base64 envelope, and a **word-boundary**
content scan that cannot collide with base64 runs.

## Runtime environment indicator

`runtimeEnvironment()` reports the real environment. In the browser build it says
"Browser development mode" and offers no native capabilities. Native modes are
reported only when the corresponding runtime is actually present.

## Security posture (unchanged guarantees, re-verified)

- No plaintext PHI in storage or logs; no API keys in plaintext.
- Bug reports capture structured fields only and exclude client data by default.
- No cross-client retrieval; online AI refused without provider approval.
- The Real PHI Readiness Gate remains authoritative and blocked by default.
- No compliance claims anywhere.

See `docs/phase8/DEVICE_TESTING.md` for the per-platform real-device checklist.
