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
| **3 — Documentation** | DAP note generator, Master Treatment Plan generator, goals & objectives editor, per-segment evidence linking, document review/approval with risk gating, version comparison, approved-only export | ✅ **Complete & tested** |
| **4 — Clinical intelligence** | ClinicalAIProvider architecture (deterministic / local / secure-online), client-record RAG with debug panel, clinician-managed knowledge base, 20-step Analyze-and-Update pipeline, living case formulations, intervention recommendations, safety & trust strategy, client-specific assistant, unsupported-claim verification, clinician feedback | ✅ **Complete & tested** |
| **5 — Quality & security** | Fictional-case evaluation harness with quality/risk/hallucination metrics, model comparison, feedback dashboard, audit & AI-operations viewers, provider approval registry with purpose gating, emergency disable switch, per-client local-only override, semantic-retrieval preparation (EmbeddingProvider seam), readiness checklist, exportable production readiness report | ✅ **Complete & tested** |
| **6 — Packaging & production hardening** | Platform-detection seam, durable file-backed encrypted storage adapter (native), OS-level secure key storage for device unlock (no recovery backdoor), browser→native migration path, backup v2 with SHA-256 integrity + inspect/dry-run/no-partial-restore, in-app guides (packaging, storage, migration, device testing, security review, production blockers, online-proxy plan, PDF-ingestion plan), honest processing-status indicator, local-AI setup guide with real readiness check, Tauri/Capacitor shell skeletons | ✅ **Complete & tested** |
| **7 — Security, HIPAA-conscious readiness & governance** | HIPAA-conscious readiness dashboard, Real PHI Readiness Gate (default blocked, 15 gates, named final approval), security review packet + data-flow map (no secrets/PHI), threat model (15 threats), editable/exportable policy & disclosure drafts (retention, deletion, backup, incident response, device, AI review, consent template, clinical disclaimer), AI vendor/BAA review with named reviewer gating online PHI at the gateway | ✅ **Complete & tested** |

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

## What works in Phase 3

- **Document generation behind a replaceable provider seam** — the
  `DocumentGenerationProvider` interface (`src/core/documents/`) ships with a
  Deterministic Template Generator; every draft displays: "This draft was assembled
  from approved client information using deterministic templates. Advanced AI
  generation is not connected yet." Phase 4 AI providers register in the same
  registry with no schema/workflow/UI changes.
- **Source selection with hard rules** — approved information by default; pending
  facts require explicit opt-in (warned + labeled "PENDING" in the draft); rejected/
  superseded information is impossible to include; risk-related sources require an
  explicit confirmation; all enforced in the context assembler, not just the UI, with
  cross-client selection rejected outright.
- **Segment-based documents** — every generated sentence is a segment carrying its
  evidence (source, excerpt, date, classification) and factual/interpretive/template/
  therapist-authored kind. Unsupported claims are flagged "Unsupported draft content".
  Clinicians edit/delete/add segments; the original generated draft is frozen forever.
- **DAP notes** — Data/Assessment/Plan sections, 12 styles (emphasis + length; facts
  never change), no invented mental-status observations, hypothesis content always
  labeled as hypothesis, autosaving draft editor.
- **Master Treatment Plans** — problem statements (screening scores explicitly marked
  "not a diagnosis"), evidence-linked Evidenced-By, deterministic formulation sections,
  ranked hierarchy of documented needs, goal plan, and proposed objective skeletons
  that flag missing baselines/targets/dates instead of inventing them. Approving a new
  plan supersedes the prior approved plan with full history.
- **Goals & objectives editor** — measurable-component fields (measurement method,
  baseline, target, dates, linked assessment), vague-wording warnings, therapist plans,
  progress tracking with notes, reorder/duplicate/status lifecycle, versioned edits.
- **Risk-gated review** — risk segments/problems/needs each require individual
  clinician confirmation (with disposition note) before a document can be approved;
  the repository enforces this regardless of UI. No bulk document approval exists.
- **Export** — approved documents only (copy / plain text / structured JSON / print
  view → PDF); drafts get watermarked print previews reading "DRAFT — NOT CLINICIAN
  APPROVED"; identifier format and content options; every export audited; no internal
  instructions or encryption material ever exported.

## What works in Phase 4

- **AI provider architecture** — a vendor-neutral `ClinicalAIProvider` seam with three
  provider types: *Deterministic* (always available, never simulates model output),
  *Local AI* (any OpenAI-compatible endpoint — Ollama, LM Studio, llama.cpp — with a
  genuine connectivity check that verifies the configured model is actually served),
  and *Secure Online AI* (Anthropic Messages API over HTTPS). Every AI operation is
  logged (provider, model, mode, sources, consent status, whether PHI left the device)
  with identifiers only — never prompt text. Providers never touch the database.
- **Online mode is disabled by default** and layered: enabling it is not enough — the
  clinician must also attest the provider relationship is approved for PHI (the gateway
  otherwise refuses to send protected information), every source input must carry
  AI-analysis consent and not be local-only, and each send shows exactly the outbound
  text (with optional best-effort redaction, previewed and never claimed perfect) behind
  an explicit confirmation. The app never claims configuration equals HIPAA compliance.
- **Client-record RAG** — deterministic lexical retrieval (BM25-style + documented
  boosts for approval status, source type, recency, longitudinal repetition, and risk
  intent) over one client's authorized record only. Longitudinal questions pull from
  multiple time periods, contradictions are always surfaced, rejected material is never
  retrieved, pending facts only by explicit opt-in — and a retrieval-debug panel shows
  every source, score, reason, and exclusion. A final namespace check aborts retrieval
  if a foreign record ever appears.
- **Clinician-managed knowledge base** — encrypted library of manuals, protocols,
  scoring guides, articles, and clinician-authored frameworks with full metadata,
  six statuses, allowed/excluded uses, and re-review dates. Text is chunked with
  section/page markers; ONLY clinician-approved, non-expired sources are retrievable;
  every cited passage keeps its source, section/page, version, and citation. No
  invented references; no proprietary frameworks unless the clinician supplies and
  approves the material.
- **Analyze and Update** — the 20-step reasoning pipeline (validation, consent,
  classification, explicit extraction, separated inferences, longitudinal + contradictory
  retrieval, knowledge lookup, change-over-time, drafting, verification, isolation
  check) produces a Clinical Update Summary where every item is a proposal with exact
  evidence: approve / edit-and-approve / reject / save-as-hypothesis / needs-further-
  assessment / do-not-save, per item, no bulk path. Risk mentions always require
  individual review. Cancellable mid-run; deterministic mode runs the whole pipeline
  honestly with rule-based extraction.
- **AI extraction** — registers through the Phase 2 `ExtractionProvider` seam with the
  six §4 labels (Explicitly Stated → Needs Further Assessment). Hallucination guards:
  excerpts must exist verbatim in the source or the item is downgraded; assessment
  scores must appear in the text; the deterministic risk scan can only ADD risk
  sensitivity; interpretations arrive as hypothesis proposals that can only ever be
  saved as pending hypotheses — never as facts.
- **AI document generation** — registers through the Phase 3
  `DocumentGenerationProvider` seam. Model prose returns with per-sentence citations
  mapped back to real evidence, then a SEPARATE deterministic verifier labels every
  sentence (seven statuses); unsupported/contradicted content is flagged, hypothesis
  citations force labeled interpretive kind, risk language forces the existing risk
  gating, and undocumented objective numbers become explicit "Clinician input
  required" gaps. One click copies proposed objectives into the Goals editor without
  approving the plan.
- **Living case formulation** — ten frameworks (BPS, Five Ps, developmental,
  trauma-informed, attachment, CBT, psychodynamic, substance-use, family systems,
  cultural), clinician-toggleable. Sections carry supporting evidence, contradicting
  evidence, alternative explanations, and qualitative confidence; empty sections say
  so instead of fabricating. Updates are PROPOSALS with a Previous → Proposed diff
  (what changed, evidence added, confidence shifts); approving supersedes with full
  version history — never a silent overwrite.
- **Best interventions** — rule-based matching of 20 modalities against approved
  client evidence, tiered *established / tentative / exploratory* (established requires
  BOTH client evidence and approved knowledge support with real citations). Every
  option carries readiness indicators, cautions, pacing, signs of benefit/overwhelm,
  measurement, and alternatives — presented as options, never directives. Trauma
  processing surfaces a stabilization concern when stabilization evidence is missing
  or risk is elevated.
- **Safety & trust strategy** — alliance guidance (communication style, pacing,
  validation, directness, challenge, rupture triggers, repair, autonomy, questions to
  ask the client) built from approved evidence, with hypothesis-based items labeled;
  approved via clinician review with history.
- **Clinical assistant** — per-client Q&A that uses only that client's authorized
  record plus approved knowledge, with citations, contradictions, qualitative
  confidence, follow-up questions, and navigation-only suggested actions. In
  deterministic mode answers are retrieval-based and say so; with a model, answers are
  verified sentence-by-sentence by the separate deterministic verifier. The assistant
  has no write authority — nothing in any answer can approve, modify, delete, or
  export records.
- **Clinician feedback** — 13 rating labels on any AI output, stored separately from
  the clinical record, never crossing clients, never auto-training anything; a Phase 5
  evaluation export bundles feedback + operation metadata on demand.
- **Navigation** — client sections are grouped (Overview / Documentation / Clinical
  Understanding / Assessments and Risk / More); mobile shows exactly five bottom-nav
  groups with a destination sheet, never 14 items. Local vs online processing is
  always visibly labeled, and locking the workspace cancels in-flight AI operations
  and clears all AI state.

## What works in Phase 5

- **Clinical AI Evaluation harness** — a dedicated area (fully separate from real
  clients) that runs FICTIONAL test cases through the real engines inside an
  ephemeral, encrypted, in-memory sandbox: fictional material never touches the
  client database and real records are never read. Ten built-in fictional cases
  (alcohol use with ambivalence, depression with shame, GAD with reassurance
  seeking, PTSD, high relapse risk, complicated grief, attachment conflict,
  guarded client, historical SI with current denial, conflicting reports) each
  carry raw material, expected extraction/risk/formulation/plan/intervention
  targets, and known traps (no current SI from history, no score→diagnosis, no
  avoidance-as-resistance, no trauma processing before stabilization, no invented
  MSE, no ignored contradictions, no hypothesis-as-fact). Custom fictional cases
  can be added as validated JSON. All ten §4 task types run for real.
- **Metrics** — extraction precision/recall/F1 with category/risk/excerpt error
  lists; hallucination metrics over the Phase 4 claim statuses with the exact
  failing sentence and reason; retrieval quality (expected retrieved/missed with
  failure explanations, contradiction retrieval, longitudinal coverage, isolation);
  DAP/plan/formulation/intervention quality checks; risk-safety metrics scored
  separately with high-priority failures. All labeled internal quality checks —
  never clinically validated measures.
- **Model comparison** — the latest run per provider (deterministic / local /
  online) for one fictional case+task, side by side: score, missed items,
  unsupported claims, trap results, risk handling, rating, duration, and
  data-leaving-device status. Real client data is never used.
- **Feedback dashboard** — read-only trends across all 13 feedback labels with
  filters (client, provider, output type, date, label); feedback never changes
  records and never crosses clients.
- **Audit & AI operations viewers** — category and action-type filters covering
  every §14 review need; the operations table shows provider/model/mode, consent
  and attestation status, source/knowledge counts, token estimates, timings,
  status, and error category — never prompt text.
- **Organizational online controls** — provider approval registry (BAA status,
  per-purpose allow/deny, expiration, key-rotation reminders) that the gateway
  ENFORCES for online sends; an emergency disable switch that refuses every
  online send instantly; a per-client local-only override honored by AI and
  embeddings alike.
- **Semantic retrieval preparation** — an `EmbeddingProvider` seam (deterministic
  lexical default, local OpenAI-compatible, secure online) with client-namespaced
  encrypted vectors that are regenerable, excluded from exports, and deleted with
  the client. Online embedding obeys every online-AI gate. The UI states plainly
  that semantic retrieval is NOT active unless a real provider is configured;
  a preview search compares vector vs lexical ranking when one is.
- **Readiness checklist & production report** — 20 seeded categories (encryption
  through HIPAA policy review) with status/notes/evidence/reviewer/review dates,
  and an exportable report assembling live workspace state with known
  limitations and the items required before real client data, online PHI, or
  multi-user deployment. Both carry explicit "requires legal/security review"
  wording — no compliance claims, ever.

## What works in Phase 6

- **Platform detection & native seams** — a `detectPlatform()` seam distinguishes
  browser / Tauri (desktop) / Capacitor (mobile) / test, and `platformCapabilities()`
  reports whether durable file-system storage and OS key storage are available on the
  current host. The UI states the real posture honestly — e.g. in a browser it shows
  "Browser storage (development)" and does not offer capabilities the host cannot back.
- **Durable local storage adapter** — `FileBackedAdapter` implements the same
  `StorageAdapter` interface as IndexedDB, storing one encrypted JSON file per record,
  blob, and meta entry under `meta/`, `records/`, and `blobs/` directories (base64url
  filenames, `Uint8Array` preserved losslessly). It plugs in behind a small `FileStore`
  interface (read / write / remove / list) that a Tauri or Capacitor shell implements
  against the real file system — the encrypted envelopes are identical to the browser
  build, so nothing about the crypto or schema changes across platforms.
- **OS-level secure key storage & device unlock** — a `SecureKeyStore` seam (OS Keychain
  / Keystore on native, honestly unavailable in the browser) enables optional device
  unlock: a random wrapping key is generated and stored **only** in the OS secure
  store, never on disk and never derivable from anything else. There is **no recovery
  backdoor** — if the device is wiped or the key is removed from the OS store, unlock
  falls back to the passphrase, and a lost passphrase still clearly means encrypted data
  may be unrecoverable. A dedicated test verifies a wiped key store forces passphrase
  unlock and never trips the lockout counter.
- **Browser → native migration** — the same encrypted-backup pipeline moves a workspace
  from the browser build to a native build: export an encrypted v2 backup, import it into
  the native app, unlock with the same passphrase. No plaintext migration files are ever
  written; a performance test exercises a 50-client / large-transcript workspace round-trip.
- **Backup v2 hardening** — backups now carry a schema version, per-collection counts, and
  a **SHA-256 checksum** over a canonical body. `inspectBackup()` previews any backup
  (validity, version, counts, checksum status, blockers, warnings) before writing anything;
  restore inspects first and **refuses to clear existing data unless the backup is valid**,
  so a corrupt or truncated file can never leave a half-restored workspace. v1 backups
  still restore (checksum reported "absent-legacy"). A dry-run mode validates without
  writing. The restore screen shows the integrity badge and record counts before you commit.
- **In-app guides & checklists** — eight planning/preparation documents are bundled
  offline (no fetch) and readable inside the app at **/guides**: native packaging, durable
  storage, browser→native migration, a per-device real-device testing checklist, a security
  review checklist, a production blocker list (gates before fictional / de-identified / real
  use), an online-AI proxy architecture plan, and a privacy-respecting PDF/document ingestion
  plan. Every document is explicitly a planning artifact and makes no compliance claim.
- **Honest processing-status indicator** — a status pill reflects the genuinely active AI
  mode: "Local-only" by default, "Local AI — on this device" only when a local model
  actually passes its readiness check, "Online AI — sends leave device" only when online
  mode is truly active, and "Online disabled (kill switch)" when the emergency switch is on.
  It never claims a mode that is not real.
- **Local AI setup guide** — an in-app guide walks through Ollama / LM Studio / llama.cpp,
  runs the real connectivity/readiness check, and reports "No local model connected"
  honestly when none is served — it never pretends a model is active. Context-window and
  performance caveats are stated up front.
- **Native shell skeletons** — `native/` ships example Tauri config + Rust command
  skeletons (file-store and keychain) and an example Capacitor config, documenting the
  exact `FileStore` / `SecureKeyStore` contract a shell must satisfy. These are
  integration scaffolding, not a built binary; the desktop/mobile store implementations
  are the remaining native work called out in the production blocker list.

## What works in Phase 7

Phase 7 adds **no clinical intelligence**. It prepares the app, documentation, and
workflows for independent legal/security review **before any real PHI is used**. The
app never claims to be "HIPAA compliant", "legally approved", "safe for PHI", or
"ready for clinical deployment" — it is **HIPAA-conscious**, presents **readiness
checklists**, and states that use **requires legal/security review** and **BAA/vendor
verification where applicable**.

- **HIPAA-conscious readiness dashboard** (`/governance`) — one hub summarizing live
  status across the Real PHI gate, threat model, policies, vendor/BAA review, the
  readiness checklist, and audit logs, with the honest "Not approved for real PHI"
  posture front and center.
- **Real PHI Readiness Gate** (`/governance/phi-gate`) — fifteen required gates
  (native build, durable storage, OS key storage, backup/restore, secure deletion,
  export review, online-AI approval, BAA/vendor review, security review, legal/HIPAA
  review, incident-response, data-retention, device security, clinician training, and
  a **named final manual approval**). All start incomplete, so the default status is
  **"Blocked: not approved for real PHI."** Items become complete only through explicit
  manual review; even when every item is done the app says only **"Ready for limited
  reviewed use according to completed checklist. This is not a legal certification."**
  The status is computed purely from stored flags and takes no client content, so it
  cannot be flipped by any record or prompt (verified in tests).
- **Security review packet** (`/governance/security-packet`) — architecture, encryption,
  key management, local storage, backup/restore, export behavior, AI modes, local AI,
  online safeguards, provider registry, audit behavior, risk workflow, client isolation,
  prompt-injection protections, known limitations, and remaining production blockers.
  Assembled from static prose plus aggregate counts; contains **no** API keys, endpoints,
  passphrases, provider names, or client PHI. Exportable as text/JSON.
- **Data-flow map** (`/governance/data-flow`) — for each kind of data: what is entered,
  where it is stored, whether it is encrypted, when (if ever) it leaves the device, what
  requires clinician/provider approval, what appears in exports and audit logs, and what
  is never stored in plaintext. Schema-level and static — contains no client PHI.
- **Threat model** (`/governance/threats`) — fifteen threats (lost/stolen device,
  forgotten passphrase, storage eviction, native/host compromise, accidental PHI export,
  wrong-client exposure, online-AI misconfiguration, missing BAA, prompt injection,
  backup exposure, unauthorized access, hallucination, unsupported output, clinician
  overreliance) each with risk description, current mitigation, remaining risk, required
  action before real use, and an editable review status. Exportable.
- **Policy & disclosure drafts** (`/governance/policies`) — editable, versioned,
  exportable templates: local-only use, online-AI use, data retention, secure deletion,
  backup & recovery, backup storage, export & records-handling, device security,
  incident response, breach-response escalation, AI output review, clinical documentation
  responsibility, a client consent/disclosure template, and a clinical responsibility
  disclaimer. Each carries a "DRAFT — for legal/security review" header and can be reset
  to its template.
- **AI vendor / BAA review** (`/providers`) — the provider approval registry now records
  the review date and named legal/security reviewer alongside provider, model, endpoint,
  purposes, BAA/contract status, and approval. The gateway continues to **refuse online
  PHI** unless the provider is approved, unexpired, and the purpose is allowed.

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
- Phase 4: model API keys are stored inside the same encrypted records store (never
  plaintext), the AI operations log stores identifiers and metadata only, online
  processing is impossible without explicit layered consent, prompts fence all client
  text as untrusted data, AI providers have no database write authority, cross-client
  evidence is rejected before every retrieval/generation/save, and locking cancels
  in-flight AI operations and clears all AI state.
- Phase 5: fictional evaluation runs execute in an ephemeral in-memory sandbox under
  an ephemeral key (test data can never mix with real clients), the provider approval
  registry and emergency disable switch gate online sends at the gateway, per-client
  local-only overrides beat every other setting, embeddings are client-namespaced,
  encrypted, export-excluded, and deleted with the client, and the readiness tooling
  never claims compliance — every artifact carries "requires legal/security review".
- Phase 7: the Real PHI Readiness Gate defaults to **blocked** and its status is computed
  only from stored completion flags — never from client content — so injected text cannot
  flip it; the final gate item requires a named approver; the security review packet and
  data-flow map are assembled from static prose plus counts and contain no API keys,
  endpoints, passphrases, provider names, or client PHI (canary tests enforce this); audit
  logs are re-verified to hold no clinical plaintext after governance activity; and the AI
  vendor/BAA review keeps the gateway's online-PHI refusal in force. No wording anywhere
  claims HIPAA compliance, legal approval, or safety for PHI.
- Phase 6: the native file-backed storage adapter stores only encrypted envelopes (same
  AES-256-GCM records as the browser build — no plaintext on disk); device unlock stores
  a random wrapping key **only** in the OS Keychain/Keystore with **no recovery backdoor**
  (a wiped key store forces passphrase unlock and never trips lockout, verified in tests);
  browser→native migration goes exclusively through the encrypted backup pipeline (no
  plaintext migration files); backup v2 adds a SHA-256 integrity checksum and a validate-
  before-clear restore that refuses to leave a half-restored workspace; and the processing-
  status indicator and local-AI guide never claim a mode or model that is not genuinely
  active.

## Architecture

React 18 + TypeScript + Vite, responsive from a 390px phone to desktop (sidebar on
desktop, bottom navigation on mobile). The core is deliberately platform-agnostic so it
can be wrapped with Capacitor (iOS/Android) and Tauri (macOS/Windows) — Phase 6 adds the
platform-detection seam, a file-backed storage adapter, and OS key-storage seams those
shells implement, plus example native configs under `native/`.

```
src/
  core/                    platform-agnostic domain layer (no React imports)
    crypto/                WebCrypto AES-GCM + PBKDF2 key wrapping + raw wrapping keys
    platform/              platform detection, capabilities, native bridges, bootstrap
    storage/               StorageAdapter interface + IndexedDB impl + file-backed
                           adapter (native) + EncryptedStore
    db/                    schemas + ClinicalDatabase repositories (Phases 1–4:
                           structured, documents, intelligence, AI, knowledge)
    assessments/           assessment definitions with cited official scoring rules
    extraction/            ExtractionProvider seam: rule-based + AI providers
    documents/             DocumentGenerationProvider seam: template + AI providers
    ai/                    ClinicalAIProvider seam, gateway (consent/isolation/logging/
                           cancellation, kill switch, registry enforcement), Anthropic +
                           local transports, redaction, prompt assembly, claim verification
    rag/                   deterministic lexical client-record retrieval + debug
    knowledge/             clinician-managed knowledge base (chunking, approval,
                           retrieval with citation preservation)
    pipeline/              20-step Analyze-and-Update reasoning pipeline
    eval/                  Phase 5 evaluation harness: fictional cases, metrics,
                           trap evaluators, ephemeral sandbox, task runners
    governance/            provider approval registry + vendor/BAA review, readiness
                           checklist, production readiness report, embedding records,
                           Phase 7: threat model, policy drafts, Real PHI readiness gate,
                           security review packet + data-flow map assemblers
    embeddings/            EmbeddingProvider seam + embedding service (semantic
                           retrieval preparation)
    formulation/           10-framework living case-formulation engine + diffing
    interventions/         rule-based intervention recommendation engine
    strategy/              safety & trust strategy engine
    assistant/             client-specific assistant (retrieval-only + AI modes)
    auth/                  AuthService: setup/unlock/lock/lockout/credential changes,
                           OS-key-store device unlock (no backdoor) + SecureKeyStore seam
    backup/                encrypted workspace snapshot + restore, backup v2 integrity
                           (checksum, inspect, dry-run, no-partial-restore)
  state/                   zustand stores bridging core ←→ UI
  features/                auth, clients, dashboard, inputs, profile, assessments,
                           hypotheses, evidence, extraction, review, documents, goals,
                           intelligence, knowledge, evaluation, governance, guides, settings
  app/                     design system (theme.css), shared components, router
    features/governance/   Phase 7 screens: readiness dashboard, Real PHI gate, security
                           packet, data-flow map, threat model, policy drafts
docs/phase6/               8 offline planning docs (bundled into the app at /guides)
docs/phase7/               Phase 7 governance overview (readiness materials live in-app)
native/                    example Tauri + Capacitor configs and command skeletons
e2e/smoke.mjs              browser-level end-to-end verification (135 checks)
```

Replaceability seams: the storage engine sits behind `StorageAdapter` (the Phase 6
`FileBackedAdapter` shows a second implementation; SQLite could be a third), native
hosts implement the small `FileStore` and `SecureKeyStore` interfaces, entities are
collection-scoped in `ClinicalDatabase` (new entities slot in beside existing ones),
and AI/RAG components consume the same repositories without touching the UI layer.

## Develop & test

```bash
npm install
npm run dev          # local dev server
npm test             # 246 unit tests: crypto, auth, repositories, structured data,
                     # extraction rules, assessment scoring, documents, backup,
                     # AI gateway/consent/isolation, RAG, knowledge base, verification,
                     # pipeline, formulation, interventions, assistant, evaluation
                     # harness, governance controls, embeddings, platform detection,
                     # file-backed storage, device unlock (no backdoor), backup v2
                     # integrity, storage performance + browser→native migration,
                     # Phase 7 PHI-gate / packet / data-flow / policy / threat-model
npm run typecheck    # strict TS
npm run build        # production build
node e2e/smoke.mjs   # 135-check browser E2E: setup → clients → risk review →
                     # extraction → profile → assessments → documents → AI settings →
                     # knowledge → formulation → interventions → assistant →
                     # Analyze-and-Update → evaluation harness → audit/ops viewers →
                     # provider registry → readiness report → device/storage posture →
                     # local-AI guide → guides/checklists → backup restore preview →
                     # HIPAA-conscious governance (PHI gate, packet, data-flow, threats,
                     # policies, vendor/BAA) → relaunch → encrypted-at-rest check
```
