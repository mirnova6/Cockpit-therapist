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
| **2 — Structured clinical data** | Extracted facts with rule-based extraction preview, assessment tracking with official scoring rules, hypotheses, evidence links, contradictions & missing-information tracking, review queue, version history, structured profile | ✅ **Complete & tested** |
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

## What works in Phase 2

- **Extraction preview** — every saved input has "Extract structured information".
  A deterministic rule-based provider proposes facts (assessment scores, medications
  with doses, diagnosis codes/phrases, explicit risk keywords, quoted statements,
  BPS headings, fixed symptom lexicon) with exact evidence excerpts and line
  locations. Nothing is written to the record until the clinician approves, edits,
  rejects, or defers each proposal. No AI model is connected and the UI says so —
  results are labeled "Rule-Based Extraction (deterministic)". The provider
  interface (`src/core/extraction/`) is the seam where a local/cloud AI provider
  plugs in during Phase 4 with no schema or workflow changes.
- **Structured clinical profile** — approved facts organized into 19 sections with
  source classification, review status, temporal status, evidence expanders, and
  source links that open the original input with the excerpt highlighted. Three
  views: Approved profile / Pending review / Full history. Pending and rejected
  facts never appear as approved information.
- **Assessment tracking** — PHQ-9, GAD-7, PCL-5, AUDIT, DAST-10 with officially
  published scoring bands (sources cited in code); C-SSRS screener with categorical
  triage rules; BAM-R and custom measures show "Score recorded. Interpretation
  rules not yet configured." rather than invented interpretations. Trend chart +
  chronological table, change-vs-previous with published meaningful-change
  thresholds only (PHQ-9 ≥5, PCL-5 ≥10). Risk-flagged assessments (any C-SSRS
  ideation, PHQ-9 item 9) require a clinician disposition note and individual review.
- **Clinical hypotheses** — clinician-authored interpretations with category,
  qualitative confidence (never numeric probabilities), alternative explanations,
  missing information, questions to assess next, supporting/contradicting evidence,
  and full lifecycle (active / rejected / superseded) with version history.
- **Evidence links** — every link stores the exact excerpt and validates at the
  repository level that source, target, and link belong to the same client.
  "Open in context" jumps to the source input with the excerpt highlighted.
- **Contradictions & missing information** — structured records with two evidence
  pointers, seven resolution statuses (never auto-resolved), and prioritized
  needs-further-assessment items with suggested questions.
- **Review queue** — per-client tab and global screen with filters (client, type,
  risk, extraction method). Bulk approval exists only for low-risk facts; risk
  items are skipped by the service layer itself and always require an individual
  note. Approve / edit-and-approve / reject / needs-clarification / open source.
- **Version history** — every mutation snapshots the prior state with reason,
  author, date, and review decision; side-by-side Previous/Current comparison
  labeled in text, not color alone.

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
    db/                    Phase 1 schema + ClinicalDatabase repositories
                           structuredSchema + StructuredRepository (Phase 2 entities)
    assessments/           assessment definitions with cited official scoring rules
    extraction/            ExtractionProvider interface + deterministic rule-based provider
    auth/                  AuthService: setup/unlock/lock/lockout/credential changes
    backup/                encrypted workspace snapshot + restore
  state/                   zustand stores bridging core ←→ UI
  features/                auth, clients, dashboard, inputs, profile, assessments,
                           hypotheses, evidence, extraction, review, settings
  app/                     design system (theme.css), shared components, router
e2e/smoke.mjs              browser-level end-to-end verification (33 checks)
```

Replaceability seams for later phases: the storage engine sits behind `StorageAdapter`
(SQLite can replace IndexedDB), entities are collection-scoped in `ClinicalDatabase`
(Phase 2 entities slot in beside existing ones), and AI/RAG components will consume the
same repositories without touching the UI layer.

## Develop & test

```bash
npm install
npm run dev          # local dev server
npm test             # 64 unit tests: crypto, auth, repositories, structured data,
                     # extraction rules, assessment scoring, backup, filters
npm run typecheck    # strict TS
npm run build        # production build
node e2e/smoke.mjs   # 33-check browser E2E: setup → clients → risk review →
                     # extraction → profile → assessments → queue → relaunch
```
