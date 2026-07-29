# Phase 9 — Optional enhancements, scaling and product maturity

Phase 9 is the final enhancement phase. It adds no new clinical reasoning and
rewrites none of the Phase 1–8 systems. Everything here is either an additional
capability behind an explicit control, or a measured improvement to something
that already worked.

**Nothing in this phase changes the app's readiness posture.** The Real PHI
Readiness Gate is still blocked by default, the deployment classification still
defaults to "Ready for fictional-data beta", and the app still makes no
compliance claim.

---

## 1. Hybrid retrieval (§4)

`src/core/rag/hybridRetrieval.ts` adds a scoring layer over the existing
deterministic lexical retriever. Three components — lexical, semantic and
metadata — are combined under configurable weights.

The honesty rule is the interesting part: **semantic ranking is only used when a
real embedding provider is active and has produced vectors for the candidates.**
`resolveEffectiveMode()` downgrades to pure lexical otherwise and returns a
plain-language reason, which the retrieval debug panel displays. The app never
claims a semantic ranking it did not perform.

Isolation is unchanged and re-verified: retrieval namespaces are per-client, a
foreign vector aborts the whole retrieval rather than being silently dropped, and
an organization-scoped workspace adds a tenant namespace guard.

Configuration lives in AI settings: `retrievalMode`, `hybridRetrievalActivated`,
and the three weights. Default is `lexical` with hybrid deactivated.

## 2. Document extraction and OCR (§5, §6)

`src/core/documents/extraction/` extracts text from DOCX and PDF **with no added
dependencies**: DOCX via ZIP + `DecompressionStream('deflate-raw')`, PDF via
`FlateDecode` plus `Tj`/`TJ` operator parsing. Fixtures are real generated files,
not hand-written strings.

Extraction reports a method — `direct`, `ocr`, `manual`, `partial` or `failed` —
and never silently returns empty text as if it had succeeded.

OCR is a **seam, not an engine**. No OCR engine is bundled. `nullOcrProvider`
throws honestly when called, `DEFAULT_OCR_SETTINGS.enabled` is `false`, and
`runOcr()` refuses when OCR is disabled or unavailable. When an engine is
supplied, low-confidence output is flagged for clinician review rather than
accepted.

## 3. Organizations, workspaces and RBAC (§13–§15)

`src/core/org/` adds 7 roles and 16 permissions with an explicit
`ROLE_PERMISSIONS` table. Notable choices:

- The `support` role has **no** permissions — a support account has no clinical
  access at all, by construction rather than by policy.
- Single-clinician mode (the default, and what every existing install runs)
  returns the full permission set, so nothing about the current experience
  changes.
- `requireSameTenant()` and `scopeToTenant()` enforce workspace separation in the
  service layer; a cross-tenant read raises `IsolationViolationError`.
- Supervision notes default to `includedInClinicalRecord: false`. A supervisor's
  comment is not part of the client's record unless someone says it is.

## 4. Evaluation regression, proxy, CI (§7, §12, §16)

- `src/core/eval/regression.ts` compares an evaluation run against a stored
  baseline. `maxRiskFailures` and `maxIsolationFailures` are both `0` and safety
  failures always fail the run regardless of other thresholds.
- `proxy/` is a reference implementation of a secure online AI proxy —
  kill-switch-first request evaluation, rate limiting, metadata-only operation
  logging, and provider-error sanitization. **It is a reference, not a deployed
  service**, and using it does not make online PHI permissible; the Phase 7 gate
  still governs that.
- `.github/workflows/ci.yml` runs typecheck, unit tests, build and a secret scan.

## 5. Accessibility (§18)

See `docs/phase9/ACCESSIBILITY.md` for the full record, including the manual
checklist and a plainly-stated list of gaps.

Summary: skip navigation, real focus traps in dialogs, Escape on the mobile
navigation sheet, a visible focus ring, 44px touch targets on coarse pointers,
reduced-motion support, and three palette tokens darkened to reach WCAG AA (one
of which, `--ink-faint`, drives most secondary text in the app and was below AA
everywhere it appeared).

`src/core/a11y/` runs WCAG contrast arithmetic against tokens parsed out of
`theme.css`, and a static JSX audit with eight rules over all 72 `.tsx` files.
The test suite asserts both zero findings in the shipped UI **and** that the
auditor detects every rule against a deliberately broken fixture — a green
result cannot be vacuous.

**No screen-reader testing has been performed and no independent audit exists.**
Those are stated as blockers, not omissions.

## 6. Performance (§19)

Two optimizations, both measured before and after, both pinned by equivalence
tests rather than by trust.

### Lexical ranking: 459ms → 205ms (2.2×)

*400-document corpus, 20 queries.* Three changes:

1. Term counts are built once per document, so document frequency is a `Map`
   lookup per (term, document) instead of a linear `includes` scan of that
   document's token array.
2. Tokenization makes a single pass instead of `filter().map().filter()`, which
   allocated three intermediate arrays per document per query.
3. Suffix stemming uses `endsWith` instead of a regex with a callback. Stemming
   ran on every token of every document on every query and was the single
   largest cost.

Equivalence is asserted against the previous implementation, which is kept in the
test file: identical scores, identical order, identical matched terms across
several queries and two corpora. The stemmer is separately fuzzed against the
regex it replaced over 20,000 generated tokens.

### Encrypted store: 58ms cold → 8.5ms warm (6.8×)

*30 clients / 750 inputs.* Reading one client's inputs requires decrypting every
input in the workspace, because records are stored by collection rather than by
client. Profiling attributed ~80% of that to AES-GCM itself (23ms of 29ms per
750 records; base64 was 2.6ms and `JSON.parse` 0.4ms), so the fix is to avoid
repeating the cipher rather than to speed it up.

`EncryptedStore` now keeps a session-scoped cache of decrypted JSON, keyed by
each record's AES-GCM IV. Because a fresh IV is generated on every write, the key
doubles as a version token — a record rewritten by another tab is detected even
if it lands in the same millisecond.

Security properties preserved, and tested:

- Nothing decrypted is persisted. The cache is an in-memory `Map`.
- It belongs to the store instance, which belongs to the session. Locking drops
  the session, and `lock()` also clears it explicitly.
- Only the *string* is cached, never a shared object, so every caller still gets
  an independent value it may freely mutate — behaviour is identical to
  decrypting every time.
- It is bounded (8M characters) and stops admitting entries rather than growing
  without limit.

Work avoided is proven by **counting real `crypto.subtle.decrypt` calls**, not by
timing, so the assertions do not flake: a warm read performs 0, and after an edit
exactly 1 record is re-decrypted.

## 7. Import and export interoperability (§21)

`src/core/interop/` defines a versioned portable client record, a Markdown
rendering for a clinician who does not run Cockpit, and an assessment-score CSV.

**Export** refuses unless the clinician acknowledges that the file is unencrypted
plain text, and the file states that obligation on its face. Local-only records
are excluded by default; facts whose source input was excluded are dropped rather
than shipped without provenance; attachment metadata travels but attachment bytes
never do; keys, passphrases, IVs, credentials and prompts are stripped
recursively and the result is re-scanned before it is returned.

**Import** is parse → preview → commit. The preview shows every record, every
risk-flagged item and every review status that will be downgraded. Committing
requires a token matching that exact preview, a named clinician, an explicit
needs-review acknowledgement, and individual acknowledgement of each risk-flagged
record.

What does **not** transfer, enforced in the service layer:

| | Reason |
| --- | --- |
| Review status | A clinician in this workspace has not seen this content. |
| AI-analysis consent | Consent was given to a different clinician in a different setting. |
| Risk sign-off | The sending clinician's review is not this clinician's review. |
| Contact details enabled | Not auto-enabled on import. |

An import always creates a **new** client. A same-named client produces a
warning, never a merge — a wrong merge silently corrupts a clinical record in a
way that is very hard to unpick. Imported prose is data, never instructions.

## 8. Migrations, diagnostics and triage (§2, §20, §22)

- `src/core/storage/migrations.ts` — `CURRENT_SCHEMA_VERSION = 2`. Dry-run is
  the default. A workspace written by a newer build is refused rather than
  partially interpreted. Every record is validated as an encryption envelope
  before and after, and a migration that would lose a record aborts.
- `src/core/observability/diagnostics.ts` — operational events with **no field
  capable of holding PHI**. Codes are sanitized to machine-ish tokens, client
  references are opaque and non-reversible, and export requires a no-PHI
  confirmation.
- `src/core/beta/feedbackTriage.ts` + `triageRepository.ts` — 15 categories, 9
  statuses, severities and priorities, with a dashboard covering open blockers,
  most-common categories and regression candidates. The no-PHI confirmation is
  enforced in the repository, not just the form, and free text is scrubbed of
  secret-shaped tokens.

All three are reachable at `/maintenance`.

---

## What Phase 9 does not do

- It does not make the app ready for real PHI. The gate is unchanged.
- It does not bundle an OCR engine, a semantic embedding model, or a deployed
  proxy. Each is a seam with an honest refusal when nothing is behind it.
- It does not turn on organizations or RBAC for existing installs; single-
  clinician mode is unchanged.
- It does not claim accessibility conformance. It measures 13 contrast pairs and
  8 static rules, and says so.
