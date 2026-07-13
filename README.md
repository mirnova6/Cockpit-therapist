# Cockpit — Therapist Clinical Workspace

A local-first, client-centered clinical information system for therapists: organize
everything known about each client, capture clinical inputs over time, and (in later
phases) generate documentation, formulations, and treatment plans — always with
mandatory clinician review.

Cockpit is a documentation and organization aid. It does not make clinical decisions.
Nothing becomes part of the official record without clinician review, and using the app
alone does not make a practice HIPAA-compliant — compliance also depends on policies,
infrastructure, agreements, and legal review.

## Build status

| Phase | Scope | Status |
| --- | --- | --- |
| **1 — Foundation** | Authentication, encrypted client database, Choose Client screen, client dashboard, clinical input storage, risk-flag review, change history, backup/restore, auto-lock | ✅ **Complete & tested** |
| 2 — Structured clinical data | Extracted facts, assessments, hypotheses, evidence links, review statuses, version history | Not started |
| 3 — Documentation | DAP generator, treatment plan generator, clinician review UI, exporting | Not started |
| 4 — Clinical intelligence | Client-record + knowledge retrieval (RAG), reasoning pipeline, formulation updates, intervention recommendations | Not started |
| 5 — Quality & security | Clinical AI evaluation, hallucination checks, prompt-injection protection, expanded audit, online mode | Not started |

Per the build standard, there are **no placeholder buttons or simulated features** —
everything visible in the UI works today. Where a later-phase concept already needs
data captured now (e.g. per-entry *AI analysis consent*), the flag is stored as real
metadata and labeled honestly in the UI.

## What works in Phase 1

- **First-run setup** — creates an encrypted workspace: name, passphrase (min 8 chars),
  optional 4–8 digit quick-unlock PIN, auto-lock interval.
- **Lock screen** — passphrase or PIN unlock, failed-attempt tracking with escalating
  lockout (5 failures → 30 s, doubling, capped at 15 min), always lands on Choose Client.
- **Choose Client** — cards with pronouns, level of care, main diagnosis, risk indicator
  (icon + text, never color alone), last session, last updated, pending risk reviews;
  search (name / identifier / diagnosis), six sort keys, filters for risk, level of care,
  status, and archived; recently-viewed strip; supports 50+ isolated client profiles.
- **Client dashboard** — snapshot, presenting problem, diagnoses & impressions,
  medications, risk & safety status (clinician-confirmed updates only), recent inputs,
  recent changes with author + date. Missing data reads “Not yet documented” — never fabricated.
- **Add clinical information** — all 14 input types from the spec, date of information,
  session date/number, author/source, client-reported vs therapist-entered vs collateral,
  encrypted file attachments, risk flag, AI-analysis consent flag.
- **Risk workflow** — risk-flagged entries surface on the dashboard, sidebar, and client
  cards until the clinician records a disposition note; reviews are stamped with name and
  time; risk status changes require an explicit confirmation checkbox and are never bundled
  into bulk actions.
- **Clinical inputs & timeline** — filterable list, full detail view with versioned edits,
  archive/restore, permanent delete (removes attachments), month-grouped timeline.
- **Client settings** — edit details, archive/restore, unencrypted JSON export behind an
  explicit warning, type-to-confirm permanent deletion that wipes every associated record.
- **Workspace settings** — change passphrase (re-wraps the data key; data untouched),
  set/remove PIN, auto-lock interval, encrypted full-workspace backup + restore, recent
  security activity from the audit log.
- **Auto-lock** — clears the in-memory key after configurable inactivity, including when
  the tab is hidden past the timeout.

## Security model

- All records and attachments are encrypted at rest with **AES-256-GCM**.
- A random 256-bit data key (DEK) encrypts everything; the DEK is wrapped by a key derived
  from the passphrase (and optionally the PIN) via **PBKDF2-SHA256, 310k iterations**.
- Unlocking unwraps the DEK into memory only; locking discards it. Wrong passphrases fail
  key-unwrap (GCM auth) — there is no password stored anywhere, hashed or otherwise.
- Plaintext meta is limited to non-PHI bootstrap data (key parameters, clinician display
  name, lockout counters, auto-lock setting).
- Backups export the encrypted envelopes verbatim — unreadable without the passphrase.
- Verified in tests: the IndexedDB stores contain no plaintext PHI, tampered ciphertext is
  rejected, and client text such as “ignore your previous instructions” is inert data (§26).

## Architecture

React 18 + TypeScript + Vite, responsive from a 390px phone to desktop (sidebar on
desktop, bottom navigation on mobile). The core is deliberately platform-agnostic so it
can be wrapped with Capacitor (iOS/Android) and Tauri/Electron (macOS/Windows) later.

```
src/
  core/                    platform-agnostic domain layer (no React imports)
    crypto/                WebCrypto AES-GCM + PBKDF2 key wrapping
    storage/               StorageAdapter interface + IndexedDB impl + EncryptedStore
    db/                    schema (spec §7 entities) + ClinicalDatabase repositories
    auth/                  AuthService: setup/unlock/lock/lockout/credential changes
    backup/                encrypted workspace snapshot + restore
  state/                   zustand stores bridging core ←→ UI
  features/                auth, clients, dashboard, inputs, settings screens
  app/                     design system (theme.css), shared components, router
e2e/smoke.mjs              browser-level end-to-end verification
```

Replaceability seams for later phases: the storage engine sits behind `StorageAdapter`
(SQLite can replace IndexedDB), entities are collection-scoped in `ClinicalDatabase`
(Phase 2 entities slot in beside existing ones), and AI/RAG components will consume the
same repositories without touching the UI layer.

## Develop & test

```bash
npm install
npm run dev          # local dev server
npm test             # 30 unit tests: crypto, auth, repositories, backup, filters
npm run typecheck    # strict TS
npm run build        # production build
node e2e/smoke.mjs   # full browser E2E: setup → client → risk review → lock/unlock
```
