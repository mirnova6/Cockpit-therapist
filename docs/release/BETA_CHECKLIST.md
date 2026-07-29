# Fictional-data beta — release checklist

**Scope of this release: fictional or fully de-identified data only.**
Real client information (PHI) is **not** permitted in this beta. The Real PHI
Readiness Gate remains blocked and is unchanged by anything in this release.

This document is the operator-facing checklist for cutting the beta. It mirrors
the in-app checklist at `/release` (`RELEASE_CHECK_SEED` in
`src/core/release/releaseSchema.ts`) — the in-app version is the live record;
this file is what a human works through and signs.

Cockpit is a documentation and organization aid. It does not make clinical
decisions. Nothing becomes part of the official record without clinician review.
Using the app does not make a practice HIPAA-compliant.

---

## A. Gate the release on these — do not cut without them

| # | Item | State at time of writing | Evidence |
| --- | --- | --- | --- |
| A1 | Automated tests green on the release commit | ✅ | 472 unit tests, 175 E2E checks, typecheck, build — CI green on the release commit |
| A2 | Repeated E2E stability green | ✅ | 20/20 consecutive runs, 20/20 distinct ports, zero flakes; `stability` job in CI |
| A3 | Secret scan clean | ✅ | `npm run scan:secrets`, enforced in CI |
| A4 | Dependency advisories reviewed and unexpired | ✅ | `npm run audit:deps`; `security/advisory-exceptions.json`, review expires 2026-10-29 |
| A5 | Real PHI Readiness Gate is **blocked** | ✅ **Required to stay blocked** | `/governance/phi-gate`; asserted by `phase7.test.ts` ("starts blocked with no items complete") |
| A6 | Deployment classification is **"Ready for fictional-data beta"** and no higher | ✅ | `/release` deployment decision report |
| A7 | Beta banner is present and states fictional/de-identified only | ✅ | Global `BetaBanner`; asserted in E2E |
| A8 | Bug reporting requires the no-PHI confirmation | ✅ | Asserted in E2E and unit tests |
| A9 | No build artifact contains a provider API key or clinical data | ✅ | Secret scan + `dist/` contains no fixture data |
| A10 | Native Rust shell compiles clean | ✅ | `cargo check` + `cargo clippy -D warnings`; `native` job in CI |
| A11 | Release notes written and reviewed | ✅ | `docs/release/RELEASE_NOTES.md` |

**If A5 is not blocked, stop.** A beta build must not ship with the PHI gate
satisfied unless every gate item has genuinely been completed and approved.

## B. Confirm before handing builds to testers

- [ ] Testers have been told, in writing, that **no real client information may
      be entered**, and what to do if they enter some by accident (delete the
      workspace; do not file a bug containing it).
- [ ] Testers know bug reports capture structured fields only and must contain
      no PHI.
- [ ] The guided beta checklist at `/beta` has been reviewed for this round.
- [ ] Sample fictional workspace loads and is clearly marked `[FICTIONAL]`.
- [ ] A named person is responsible for triaging incoming feedback at
      `/maintenance`.
- [ ] Testers know how to reach that person.

## C. Platform builds — not required for a browser beta

These are **not** gates for a fictional-data browser beta. They are gates for a
packaged beta and for any clinical use. Current state is **blocked pending
toolchains and certificates** (see `native/README.md`).

| Item | Blocker |
| --- | --- |
| macOS desktop build produced & signed | macOS host + Apple Developer ID + notarization (Rust itself is no longer a blocker — the code compile-verifies in CI) |
| Windows desktop build produced & signed | Windows host + Authenticode certificate |
| iOS build produced | macOS + Xcode + signing identity |
| Android build produced | Android SDK + signing keystore |

Real icons must also replace the committed placeholders before any distributable
build. Record each item as `blocked` in `/release` until the host and certificate
exist.
**Do not mark them done, and do not display native capabilities the build does
not actually have.**

## D. Not required for this beta — required before clinical use

Listed so nobody mistakes a green beta checklist for clinical readiness. Every
one of these is tracked in the Real PHI Readiness Gate.

- [ ] Native durable storage verified on each target device
- [ ] OS key storage / device unlock verified on device, including that wiping
      the OS key forces passphrase unlock
- [ ] Backup & restore verified on device
- [ ] Real-device test checklist completed (`docs/phase8/DEVICE_TESTING.md`)
- [ ] Independent security review completed
- [ ] Legal / HIPAA review completed
- [ ] **Accessibility review completed** — including a screen-reader session.
      No screen-reader testing has been performed; see
      `docs/phase9/ACCESSIBILITY.md`
- [ ] Policies adopted, BAAs signed where applicable, clinician training completed

## E. Cutting the release

1. Confirm every item in **A**.
2. Confirm **B** with the person running the beta round.
3. Tag the release commit. The `stability` job runs on tags and on `main`; it can
   also be dispatched manually to confirm a candidate on its branch first.
4. Attach `docs/release/RELEASE_NOTES.md`.
5. Export the deployment decision report from `/release` and file it with the
   release. It must read **"Ready for fictional-data beta"**.

## G. Merge baseline

| Field | Value |
| --- | --- |
| Merge commit | `fb1cfcded3bbc3084d900891db82e99400bf08b1` |
| Short hash | `fb1cfcd` |
| Merged | 2026-07-29 |
| Source PR | #1 — Phases 6–9 |
| Branch merged | `claude/therapist-assistant-app-miat78` → `main` |
| Post-merge CI run | [30478546627](https://github.com/mirnova6/Cockpit-therapist/actions/runs/30478546627) |
| Baseline tag | `fictional-data-beta-baseline` |

This is the commit the fictional-data beta baseline tag points at.

### Post-merge CI result on this commit

| Job | Result |
| --- | --- |
| Unit, typecheck, build, E2E | ✅ success |
| Repeated E2E stability | ✅ success — **20/20 runs, 175 checks each, 20/20 distinct ports, 0 failures** |
| Native desktop (Tauri) compile check | ✅ success — `cargo check` + `cargo clippy -- -D warnings` |
| Dependency audit and secret scanning | ✅ success |

The stability job ran **automatically** on the `main` push; it is gated to
`main`, tags and manual dispatch.

## F. Sign-off

| Field | Value |
| --- | --- |
| Release tag | |
| Commit | |
| Date | |
| Cut by | |
| Beta round owner | |
| PHI gate confirmed blocked by | |
| Deployment classification recorded | |
| Notes | |
