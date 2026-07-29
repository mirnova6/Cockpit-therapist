# Phase 7 — Security, HIPAA-conscious readiness, legal preparation & real-use governance

Phase 7 adds **no clinical intelligence**. It prepares the app, its documentation,
and its workflows for independent legal/security review **before any real PHI is
used**. All Phase 1–6 protections are preserved (encryption, client isolation,
review gates, evidence tracking, risk safeguards, AI provider controls, audit logs,
backup/restore, evaluation harness, local-first design).

## Wording rule (enforced in the UI and every export)

The app never claims to be **HIPAA compliant**, **legally approved**, **safe for
PHI**, or **ready for clinical deployment**. It only ever describes itself as
**HIPAA-conscious**, presents **readiness checklists**, states that use **requires
legal/security review** and **requires BAA/vendor verification where applicable**,
and treats real PHI as **not approved for real PHI until all required reviews are
completed**.

## Where each deliverable lives (all in-app, offline)

| Deliverable | Location |
| --- | --- |
| HIPAA-conscious readiness dashboard | `/governance` — `GovernanceHubScreen` |
| Real "Not approved for PHI" gate | `/governance/phi-gate` — `PhiGateScreen` (default **blocked**) |
| Security review packet | `/governance/security-packet` — assembled by `securityPacket.ts` |
| Data-flow map | `/governance/data-flow` — `dataFlowMap.ts` |
| Threat model | `/governance/threats` — `ThreatModelScreen` + `phase7Schema.ts` seed |
| Policy & disclosure drafts | `/governance/policies` — editable + exportable |
| AI vendor / BAA review | `/providers` — provider registry, now with review date + named reviewer |
| Readiness checklist & report | `/readiness` (Phase 5) |
| Audit & AI operations | `/audit` (Phase 5) |

## Real PHI Readiness Gate

Fifteen required gates, all starting **incomplete**, so the default status is:

> **Blocked: not approved for real PHI.**

The status can only change after **every** item is marked complete through explicit
manual review — the final item requires a **named approver**. Even when all items
are complete the app says only:

> **Ready for limited reviewed use according to completed checklist. This is not a
> legal certification.**

The gate status is computed purely from stored completion flags (`computePhiGateStatus`)
and takes **no** client content, so it cannot be flipped by any record or prompt
(prompt-injection safe — verified in tests).

## Policy / disclosure drafts included

Local-only use, Online AI use, Data retention, Secure deletion, Backup & recovery,
Backup storage, Export & records-handling, Device security, Incident-response,
Breach-response escalation, AI output review, Clinical documentation responsibility,
Client consent / disclosure template, and a Clinical responsibility disclaimer.

Every draft carries a "DRAFT — TEMPLATE FOR LEGAL/SECURITY REVIEW" header, is
editable, versioned, and exportable, and can be reset to its seeded template.

## Threat model coverage

Lost/stolen device, forgotten passphrase, browser storage eviction, native storage
compromise, malware/compromised device, accidental PHI export, wrong-client exposure,
online AI misconfiguration, missing BAA/provider approval, prompt injection, backup
file exposure, unauthorized local access, model hallucination, unsupported clinical
output, and clinician overreliance on AI. Each item records risk description, current
mitigation, remaining risk, required action before real use, and a review status.

## Exports contain no secrets or PHI

The security review packet and data-flow map are built from static architecture prose
plus aggregate counts. They contain no API keys, endpoints, passphrases, provider
names, or client PHI (verified by tests that plant secret/PHI canaries and assert
their absence).

## Tests (see `src/core/governance/phase7.test.ts`, 12 tests)

- Readiness gate starts blocked; missing legal/security review keeps PHI blocked.
- Missing BAA/provider approval blocks online PHI; online AI refuses without approval or attestation.
- Local-only policy and threat-model edits persist.
- Security review packet exports without secrets/PHI; data-flow map contains no client PHI.
- Audit logs contain no clinical plaintext.
- Real PHI gate cannot be bypassed by prompt-injection content.
- (E2E) Backup/restore and export warnings remain active.

**This is preparation material. It makes no compliance claim and does not, by itself,
make any practice HIPAA compliant.**
