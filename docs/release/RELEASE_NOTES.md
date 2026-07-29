# Cockpit — fictional-data beta release notes

**This build is for fictional or fully de-identified data only.**
Do not enter real client information. The Real PHI Readiness Gate is blocked and
this release does not change that.

Cockpit is a documentation and organization aid for therapists. It does not make
clinical decisions. No AI output enters the record without clinician review.
Using this app does not make a practice HIPAA-compliant — that depends on
policies, infrastructure, agreements, and legal review that sit outside the
software.

---

## What this beta is for

Finding out whether the workflow holds up in realistic use: whether the review
gates are workable rather than annoying, whether retrieval surfaces the right
evidence, whether the documentation output is worth editing, and where the app
gets in the way. Feedback on all of that is the point of the round.

## What you can do

**Client record.** Create clients, capture clinical inputs over time (session
transcripts, notes, collateral), flag and review risk content, browse a timeline,
and see change history. Everything is encrypted at rest on your device.

**Structured clinical data.** Rule-based extraction of facts from inputs with a
preview before anything is saved, assessment tracking with official scoring
rules, clinical hypotheses, evidence links, contradictions and
missing-information tracking, and a review queue.

**Documentation.** DAP notes and Master Treatment Plans with per-segment evidence
links, review and approval with risk gating, version comparison, and
approved-only export.

**Clinical intelligence.** Client-record retrieval with a debug panel showing
exactly why each source ranked where it did, a clinician-managed knowledge base,
a 20-step Analyze-and-Update pipeline, living case formulations, intervention
suggestions, a safety and trust strategy view, and a client-specific assistant.
All output is draft until you approve it.

**Evaluation and governance.** A fictional-case evaluation harness, model
comparison, audit and AI-operations viewers, a provider approval registry with an
emergency disable switch, and the HIPAA-conscious readiness materials.

**Import and export.** Move one client's record between workspaces, or produce a
readable copy for a clinician who does not run Cockpit.

**Maintenance.** Feedback triage, schema migrations, and PHI-free diagnostics.

## What is deliberately not here

- **No connected AI model unless you connect one.** Out of the box the app uses
  deterministic, rule-based logic. If you point it at a local model or an
  approved online provider, it says so; if you do not, it never pretends
  otherwise.
- **No semantic search.** The retrieval mode setting exists, but with no
  embedding provider connected the app falls back to lexical ranking and tells
  you why in the debug panel.
- **No OCR.** Scanned documents are detected and reported as needing manual
  entry rather than silently producing empty text.
- **No signed desktop or mobile app.** This is a browser build. The Rust shell
  now compile-verifies in CI, but **no signed binary of any kind exists** for
  macOS, Windows, iOS or Android — producing one needs macOS and Windows hosts
  plus signing certificates that are not available. Do not describe this release
  as offering a native app.
- **The application icons in the repository are placeholders**, generated
  programmatically so the native build has something valid to embed. They are
  **not release assets** and must be replaced before any distributable build.
- **No online AI proxy.** A reference implementation exists in the repository; it
  is not deployed and is not connected.

## Ground rules for the round

1. **No real client information, of any kind.** Use the sample fictional
   workspace at `/beta`, or invent your own.
2. If you enter something real by accident, delete the workspace. Do not put it
   in a bug report.
3. Bug reports capture structured fields only — screen, steps, expected, actual —
   and require you to confirm they contain no client information. Please keep
   them that way.
4. Treat every AI draft as a draft. That is what the review gates are for, and
   whether they work is part of what this round is testing.

## Known limitations

- **Accessibility: no screen-reader testing has been done**, and there are no
  live-region announcements for asynchronous updates such as draft generation
  finishing. If you use a screen reader, please tell us what breaks — that
  feedback is especially valuable. Details and a manual checklist are in
  `docs/phase9/ACCESSIBILITY.md`.
- Browser storage is not durable in the way a native app's storage is. Take
  backups from workspace settings; do not rely on the browser keeping data.
- Reading one client's records decrypts the whole collection, so very large
  workspaces will feel slower on first load. Repeat reads within a session are
  roughly 7× faster.
- Data-dense tables have not been checked for screen-reader row/column context.
- Score trends have no textual alternative.
- Six dependency advisories are open and reviewed: five affect only the
  development toolchain and never ship, one is in shipped code but is not
  reachable in this app's configuration. See `security/advisory-exceptions.json`.

## Getting help and giving feedback

- Guided checklist and feedback: `/beta`
- Bug reports: `/beta` (PHI-free by construction)
- Triage status: `/maintenance`
- Readiness posture: `/governance`

## Build identity

| | |
| --- | --- |
| Merge commit | `fb1cfcded3bbc3084d900891db82e99400bf08b1` |
| Short hash | `fb1cfcd` |
| Merged from | PR #1 — Phases 6–9 |
| Date | 2026-07-29 |
| Baseline tag | `fictional-data-beta-baseline` |

## Verification for this build

| | |
| --- | --- |
| Unit tests | 472 across 44 files |
| Browser E2E checks | 175 |
| Repeated E2E stability | 20/20 consecutive runs on the merge commit in CI — 175 checks each, 20/20 distinct ports, zero failures |
| Native Rust shell | compiles clean (`cargo check` + `cargo clippy -- -D warnings`) in CI. **No signed binary exists.** |
| Typecheck / build | clean |
| Secret scan | clean |
| Dependency advisories | 6, all reviewed |
| Real PHI Readiness Gate | **blocked** |
| Deployment classification | **Ready for fictional-data beta** |

## Statement of readiness

This build is **not approved for real PHI until all required reviews are
completed** — independent security review, legal review, accessibility review
including screen-reader testing, real-device validation, signed native builds,
adopted policies, and clinician training. Those are tracked in the Real PHI
Readiness Gate, which stays blocked by default and is unchanged by this release.
