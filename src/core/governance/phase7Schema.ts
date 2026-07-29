/**
 * Phase 7 governance schema: HIPAA-conscious readiness materials.
 *
 * This phase adds NO clinical intelligence. It provides the data structures
 * for a threat model, editable policy drafts, and a "Real PHI Readiness Gate"
 * so the app, its documentation, and its workflows can be prepared for
 * independent legal/security review BEFORE any real PHI is used.
 *
 * Wording rule (enforced throughout the UI and exports): the app never claims
 * to be "HIPAA compliant", "legally approved", "safe for PHI", or "ready for
 * clinical deployment". It only ever describes itself as "HIPAA-conscious",
 * presents "readiness checklists", and states that use "requires legal/security
 * review" and "requires BAA/vendor verification where applicable". Real PHI use
 * is "not approved for real PHI until all required reviews are completed".
 */

// -------------------------------------------------------- shared wording

export const PHI_BLOCKED_STATUS = 'Blocked: not approved for real PHI.';

export const PHI_LIMITED_READY_STATUS =
  'Ready for limited reviewed use according to completed checklist. This is not a legal certification.';

export const HIPAA_CONSCIOUS_DISCLAIMER =
  'HIPAA-conscious readiness materials. These artifacts do NOT establish HIPAA compliance, legal approval, or safety for protected health information. They are prepared to support independent legal/security review and require BAA/vendor verification where applicable. Real PHI is not approved for use until all required reviews are completed.';

// --------------------------------------------------------- threat model

export type ThreatReviewStatus =
  | 'not-reviewed'
  | 'mitigation-in-place'
  | 'accepted-residual-risk'
  | 'needs-action'
  | 'reviewed';

export const THREAT_REVIEW_STATUSES: Array<{ value: ThreatReviewStatus; label: string }> = [
  { value: 'not-reviewed', label: 'Not reviewed' },
  { value: 'mitigation-in-place', label: 'Mitigation in place' },
  { value: 'accepted-residual-risk', label: 'Accepted residual risk' },
  { value: 'needs-action', label: 'Needs action before use' },
  { value: 'reviewed', label: 'Reviewed' },
];

export interface ThreatModelItem {
  id: string;
  /** Stable key so seeds can be re-synced without duplicating rows. */
  key: string;
  threat: string;
  category: string;
  riskDescription: string;
  currentMitigation: string;
  remainingRisk: string;
  requiredActionBeforeUse: string;
  reviewStatus: ThreatReviewStatus;
  notes?: string;
  reviewer?: string;
  reviewedAt?: string;
  updatedAt: string;
}

export type ThreatSeed = Omit<ThreatModelItem, 'id' | 'reviewStatus' | 'notes' | 'reviewer' | 'reviewedAt' | 'updatedAt'>;

/** The §"Threat Model" list. Defaults describe the app AS BUILT — clinicians
 *  edit remaining risk / required action for their own environment. */
export const THREAT_MODEL_SEED: ThreatSeed[] = [
  {
    key: 'lost-stolen-device',
    threat: 'Lost or stolen device',
    category: 'Device',
    riskDescription: 'A device holding the encrypted workspace is lost or stolen.',
    currentMitigation:
      'All records/blobs are AES-256-GCM encrypted at rest; the data key is wrapped by a PBKDF2-derived key and never persisted unwrapped. Without the passphrase the storage is ciphertext. Auto-lock discards the in-memory key on inactivity.',
    remainingRisk:
      'A device unlocked and open at the time of theft, or a weak passphrase, reduces protection. Application encryption cannot protect an actively-unlocked session.',
    requiredActionBeforeUse:
      'Require full-disk encryption and OS screen lock on every device; set a short auto-lock; use a strong passphrase. Confirm remote-wipe options for mobile.',
  },
  {
    key: 'forgotten-passphrase',
    threat: 'Forgotten passphrase',
    category: 'Access',
    riskDescription: 'The clinician forgets the workspace passphrase.',
    currentMitigation:
      'There is intentionally NO recovery backdoor. The passphrase (or an optional OS-keystore device unlock the clinician explicitly enabled) is the only path. The app clearly warns that a lost passphrase means encrypted data may be unrecoverable.',
    remainingRisk:
      'Data protected only by a forgotten passphrase is unrecoverable by design. Device unlock does not survive a wiped/replaced device.',
    requiredActionBeforeUse:
      'Document a passphrase-custody procedure (e.g. sealed record in a safe) and a tested backup + restore routine so a forgotten passphrase does not mean total loss.',
  },
  {
    key: 'browser-storage-eviction',
    threat: 'Browser storage eviction',
    category: 'Storage durability',
    riskDescription: 'A browser evicts IndexedDB under disk pressure or on cache-clear, losing the local workspace.',
    currentMitigation:
      'Encrypted backups can be exported at any time. Phase 6 adds a durable file-backed storage adapter for native builds that does not rely on browser storage.',
    remainingRisk:
      'The browser build depends on browser storage durability; eviction between backups loses data since the last backup.',
    requiredActionBeforeUse:
      'Use the native build for real use, or enforce a strict backup schedule. Verify persistent-storage permission where the browser offers it.',
  },
  {
    key: 'native-storage-compromise',
    threat: 'Native storage compromise',
    category: 'Storage security',
    riskDescription: 'An attacker gains read access to the native app’s on-disk files.',
    currentMitigation:
      'The file-backed adapter writes only encrypted envelopes — identical ciphertext to the browser build. No plaintext PHI, prompts, outputs, or API keys are written to disk.',
    remainingRisk:
      'Files remain ciphertext without the passphrase, but a compromised host can capture the passphrase or memory while unlocked.',
    requiredActionBeforeUse:
      'Rely on OS-level file permissions and full-disk encryption; independent review of the native storage implementation is required.',
  },
  {
    key: 'malware-compromised-device',
    threat: 'Malware or compromised device',
    category: 'Device',
    riskDescription: 'Malware, keylogger, or screen capture runs on the device.',
    currentMitigation:
      'Application-level encryption, auto-lock, and no-plaintext-at-rest reduce data-at-rest exposure. Locking cancels in-flight AI operations and clears AI state.',
    remainingRisk:
      'A compromised device defeats application-level protections: it can capture the passphrase, screen contents, or unwrapped key while unlocked. This is outside the app’s control.',
    requiredActionBeforeUse:
      'Endpoint security policy (updates, anti-malware, least privilege, dedicated device) is required and is the practice’s responsibility.',
  },
  {
    key: 'accidental-phi-export',
    threat: 'Accidental export of PHI',
    category: 'Export',
    riskDescription: 'A clinician exports client data and mishandles the resulting file.',
    currentMitigation:
      'Only approved documents export; drafts are watermarked; unencrypted client JSON export sits behind an explicit warning; backups are encrypted envelopes only; exports never contain internal instructions or key material. Every export is audited.',
    remainingRisk:
      'Once an unencrypted export leaves the app, the app cannot protect it. Human error in handling exported files remains.',
    requiredActionBeforeUse:
      'Adopt the Export & records-handling policy: where exports may go, encryption in transit/at rest, and secure deletion of temporary files.',
  },
  {
    key: 'wrong-client-exposure',
    threat: 'Wrong-client data exposure',
    category: 'Isolation',
    riskDescription: 'Data from one client is shown, retrieved, or generated into another client’s record.',
    currentMitigation:
      'Cross-client isolation is enforced in repositories, retrieval, the AI gateway, embeddings, and pre-save checks — not just the UI. A namespace check aborts retrieval if a foreign record appears.',
    remainingRisk:
      'Clinician mis-selection during manual entry (typing into the wrong open client) is a workflow risk the app cannot fully prevent.',
    requiredActionBeforeUse:
      'Confirm the active client indicator in the UI during training; verify the isolation tests remain green.',
  },
  {
    key: 'online-ai-misconfig',
    threat: 'Online AI misconfiguration',
    category: 'Online AI',
    riskDescription: 'Online AI is enabled or pointed at an unapproved provider, risking PHI egress.',
    currentMitigation:
      'Online mode is off by default and layered: enable + PHI-approval attestation + per-input consent + provider-registry approval + outbound preview + per-send confirmation. The gateway refuses PHI if any gate fails, and an emergency kill switch blocks all online sends instantly.',
    remainingRisk:
      'A clinician who deliberately satisfies every gate with an inappropriate provider can still send. Approval accuracy depends on the registry being maintained honestly.',
    requiredActionBeforeUse:
      'Keep online mode disabled until a signed BAA/contract is recorded and legal review confirms the arrangement. Verify refusal paths with fictional data in the evaluation harness first.',
  },
  {
    key: 'missing-baa-approval',
    threat: 'Missing BAA / provider approval',
    category: 'Vendor governance',
    riskDescription: 'PHI is sent to an online provider without an executed BAA/contract or a completed approval.',
    currentMitigation:
      'The provider approval registry gates online PHI at the gateway: status must be "approved", not past its review date, and the capability must be allowed, or the send is refused and logged.',
    remainingRisk:
      'The registry reflects what the clinician records. A mistakenly-approved entry, or a provider that is approved without a real BAA, is a governance failure the app cannot detect.',
    requiredActionBeforeUse:
      'Complete the AI Vendor / BAA review for every online provider with a named legal/security reviewer before enabling online PHI.',
  },
  {
    key: 'prompt-injection',
    threat: 'Prompt injection',
    category: 'AI safety',
    riskDescription: 'Malicious or accidental instructions inside client text attempt to redirect AI behavior or exfiltrate data.',
    currentMitigation:
      'All client text is fenced as untrusted data in prompts; AI providers have no database write authority; the readiness gate and governance state are computed from stored flags, never from client content; injection strings are inert data in tests.',
    remainingRisk:
      'A model may still produce a low-quality or off-target answer; the separate deterministic verifier flags unsupported content, but review is required.',
    requiredActionBeforeUse:
      'Retain mandatory clinician review of all AI output; keep the injection-inertness tests green.',
  },
  {
    key: 'backup-file-exposure',
    threat: 'Backup file exposure',
    category: 'Backup',
    riskDescription: 'An exported backup file is intercepted or stored insecurely.',
    currentMitigation:
      'Backups contain only encrypted envelopes and are unreadable without the passphrase. Backup v2 adds a SHA-256 integrity checksum so tampering/corruption is detected before restore.',
    remainingRisk:
      'A backup protected by a weak passphrase, or stored where the passphrase is also exposed, is at risk. The app cannot control where backups are stored.',
    requiredActionBeforeUse:
      'Adopt the Backup & recovery and Backup-storage policies: encrypted storage location, retention, and separation of passphrase from backup media.',
  },
  {
    key: 'unauthorized-local-access',
    threat: 'Unauthorized local access',
    category: 'Access',
    riskDescription: 'Someone other than the clinician uses the device while the workspace is available.',
    currentMitigation:
      'Passphrase/PIN unlock with escalating lockout backoff; auto-lock on inactivity; the in-memory key is discarded on lock.',
    remainingRisk:
      'An unlocked, unattended session is accessible. Single-clinician trust model: there are no per-user roles yet.',
    requiredActionBeforeUse:
      'Short auto-lock, OS screen lock, and a lock-on-leave habit. Multi-user access control is out of scope until a future phase.',
  },
  {
    key: 'model-hallucination',
    threat: 'Model hallucination',
    category: 'AI safety',
    riskDescription: 'An AI model fabricates facts, scores, observations, or citations.',
    currentMitigation:
      'Excerpts must exist verbatim or items are downgraded; assessment scores must appear in the text; a separate deterministic verifier labels every sentence and flags unsupported/contradicted content; interpretations can only be saved as pending hypotheses. Nothing is written without clinician approval.',
    remainingRisk:
      'Weak local models raise unsupported-claim rates (measurable in the evaluation harness). Verification reduces but cannot eliminate hallucination risk.',
    requiredActionBeforeUse:
      'Evaluate any model with the fictional-case harness; retain per-item clinician review; never bulk-approve.',
  },
  {
    key: 'unsupported-clinical-output',
    threat: 'Unsupported clinical output',
    category: 'AI safety',
    riskDescription: 'Generated documentation contains claims not backed by approved evidence.',
    currentMitigation:
      'Every generated sentence carries evidence and a factual/interpretive/template kind; unsupported claims are flagged "Unsupported draft content"; risk language forces risk gating; undocumented objective numbers become explicit "Clinician input required" gaps.',
    remainingRisk:
      'Clinicians can still approve flagged content. The safeguard is a prompt for review, not a hard block.',
    requiredActionBeforeUse:
      'Train reviewers to resolve every flag before approval; keep verification tests green.',
  },
  {
    key: 'clinician-overreliance',
    threat: 'Clinician overreliance on AI',
    category: 'Clinical responsibility',
    riskDescription: 'A clinician defers clinical judgment to AI output instead of using it as a draft aid.',
    currentMitigation:
      'All AI output is draft until clinician approval; the app never converts screening scores to diagnoses, never determines risk autonomously, and labels every AI mode. The Clinical Responsibility Disclaimer states the clinician is responsible for all clinical decisions.',
    remainingRisk:
      'Overreliance is a human-factors risk the software cannot fully prevent.',
    requiredActionBeforeUse:
      'Complete clinician training/disclosure acknowledging that AI output is a draft aid and the clinician remains responsible for the record.',
  },
];

// --------------------------------------------------------- policy drafts

export type PolicyStatus = 'draft' | 'in-review' | 'reviewed-by-counsel' | 'adopted';

export const POLICY_STATUSES: Array<{ value: PolicyStatus; label: string }> = [
  { value: 'draft', label: 'Draft (unreviewed)' },
  { value: 'in-review', label: 'In review' },
  { value: 'reviewed-by-counsel', label: 'Reviewed by counsel/security' },
  { value: 'adopted', label: 'Adopted by practice' },
];

export interface PolicyDraft {
  id: string;
  key: string;
  title: string;
  category: string;
  /** Editable plain-text body; seeded from a template. */
  body: string;
  status: PolicyStatus;
  reviewer?: string;
  reviewedAt?: string;
  version: number;
  updatedAt: string;
}

export type PolicySeed = Pick<PolicyDraft, 'key' | 'title' | 'category' | 'body'>;

const DRAFT_HEADER =
  'DRAFT — TEMPLATE FOR LEGAL/SECURITY REVIEW. This is a starting point, not legal advice, and does not establish HIPAA compliance. Edit for your jurisdiction, practice, and devices; have counsel/security review before adoption.\n\n';

/** Seeded policy/disclosure/consent templates. Bodies are editable + exportable. */
export const POLICY_SEED: PolicySeed[] = [
  {
    key: 'local-only-use',
    title: 'Local-only use policy',
    category: 'Use policy',
    body:
      DRAFT_HEADER +
      'Purpose: Define use of the application in local-only mode (no data leaves the device).\n\n' +
      '1. Default posture: The application runs local-only. Online AI is disabled unless explicitly enabled and governed by the Online AI use policy.\n' +
      '2. Data location: All client data is stored encrypted on the local device only. No cloud sync is used.\n' +
      '3. Deterministic and local AI: Deterministic features and any local AI model run on-device; no PHI is transmitted off the device.\n' +
      '4. Backups: Encrypted backups are the clinician’s responsibility and are governed by the Backup & recovery policy.\n' +
      '5. Devices: Only approved, encrypted, access-controlled devices may hold the workspace.\n' +
      '6. Review: This policy requires legal/security review before real PHI use.',
  },
  {
    key: 'online-ai-use',
    title: 'Online AI use policy',
    category: 'Use policy',
    body:
      DRAFT_HEADER +
      'Purpose: Govern any use of online AI providers that could transmit PHI off the device.\n\n' +
      '1. Prohibition by default: Online AI processing of PHI is prohibited until a signed BAA/contract is on file and the provider is marked approved in the registry.\n' +
      '2. Preconditions (all required): online mode enabled; PHI-approval attestation recorded; per-input consent present; provider approved for the specific purpose; outbound content previewed; send explicitly confirmed.\n' +
      '3. Vendor governance: Each provider must complete the AI Vendor / BAA review with a named reviewer and expiration date.\n' +
      '4. Emergency stop: The emergency disable (kill switch) must be tested and available; when engaged, all online sends are refused.\n' +
      '5. Minimum necessary: Send only the minimum information required; use redaction where available (disclosed as best-effort).\n' +
      '6. Logging: Every online operation is logged (provider, model, mode, consent, PHI flag) without prompt text.\n' +
      '7. Review: This policy requires legal/security review and BAA/vendor verification before any online PHI use.',
  },
  {
    key: 'data-retention',
    title: 'Data retention policy',
    category: 'Records handling',
    body:
      DRAFT_HEADER +
      'Purpose: Define how long client records are retained.\n\n' +
      '1. Retention period: Retain clinical records for [JURISDICTION-REQUIRED PERIOD — e.g. N years after last service or after a minor reaches majority]. Consult applicable state and federal requirements.\n' +
      '2. Basis: Retention is driven by legal/regulatory and clinical need, not convenience.\n' +
      '3. Inventory: Maintain an inventory of where records and backups live.\n' +
      '4. Disposition: At end of retention, destroy per the Secure deletion policy.\n' +
      '5. Legal hold: Suspend destruction for any record under legal hold.\n' +
      '6. Review: Retention periods require legal review for the practice’s jurisdiction.',
  },
  {
    key: 'secure-deletion',
    title: 'Secure deletion policy',
    category: 'Records handling',
    body:
      DRAFT_HEADER +
      'Purpose: Define how client data is securely deleted.\n\n' +
      '1. In-app deletion: Client deletion cascades across every collection (records, attachments, AI operations, embeddings, intelligence). Deletion is audited.\n' +
      '2. Backups: Deletion is not complete until backups containing the data are also destroyed or rotated out per schedule.\n' +
      '3. Media sanitization: When retiring a device, perform full-disk sanitization/crypto-erase.\n' +
      '4. Exports: Securely delete any temporary or exported files per the Export & records-handling policy.\n' +
      '5. Verification: Record who performed deletion and when.\n' +
      '6. Review: Secure-deletion adequacy requires security review.',
  },
  {
    key: 'backup-recovery',
    title: 'Backup & recovery policy',
    category: 'Backup',
    body:
      DRAFT_HEADER +
      'Purpose: Ensure recoverability while protecting confidentiality.\n\n' +
      '1. Frequency: Create an encrypted backup at least [FREQUENCY — e.g. daily on active days] and before major changes or app updates.\n' +
      '2. Integrity: Use backup v2 (SHA-256 checksum). Verify the integrity badge before relying on a backup.\n' +
      '3. Restore testing: Perform and document a test restore at least [INTERVAL — e.g. quarterly].\n' +
      '4. Passphrase separation: Backups are encrypted with the workspace passphrase; store the passphrase separately from backup media.\n' +
      '5. Retention: Keep [N] backup generations; rotate and securely delete older ones per the Secure deletion policy.\n' +
      '6. Review: Backup adequacy requires security review.',
  },
  {
    key: 'backup-storage',
    title: 'Backup storage policy',
    category: 'Backup',
    body:
      DRAFT_HEADER +
      'Purpose: Define where and how backups are stored.\n\n' +
      '1. Location: Store encrypted backups in [APPROVED LOCATION — e.g. encrypted external drive / practice-approved encrypted storage]. Do not store backups with the passphrase.\n' +
      '2. Access: Limit access to authorized personnel only.\n' +
      '3. Cloud: If cloud storage is used, a BAA with the storage provider is required (this app does not provide cloud storage).\n' +
      '4. Transport: Encrypt backups in transit; never email unencrypted.\n' +
      '5. Review: Storage location and any cloud/vendor use require legal/security review and BAA/vendor verification.',
  },
  {
    key: 'export-records-handling',
    title: 'Export & records-handling policy',
    category: 'Records handling',
    body:
      DRAFT_HEADER +
      'Purpose: Govern exports and handling of records produced by the app.\n\n' +
      '1. Approved documents: Only clinician-approved documents are exported for the record; drafts carry a "DRAFT — NOT CLINICIAN APPROVED" watermark.\n' +
      '2. Unencrypted exports: Unencrypted client JSON export is behind a warning and must be handled as PHI: encrypted at rest, access-controlled, securely deleted when no longer needed.\n' +
      '3. Destination: Define approved destinations (EHR, secure print, secure messaging). No unapproved third-party services.\n' +
      '4. Minimum necessary: Export only what is needed for the purpose.\n' +
      '5. Audit: Exports are audited in-app; the practice maintains a disclosure log where required.\n' +
      '6. Review: Export handling requires legal/security review.',
  },
  {
    key: 'device-security',
    title: 'Device security policy',
    category: 'Device',
    body:
      DRAFT_HEADER +
      'Purpose: Define minimum device requirements.\n\n' +
      '1. Full-disk encryption enabled on every device holding the workspace.\n' +
      '2. OS screen lock with a short timeout; app auto-lock configured.\n' +
      '3. OS and browser kept current with security updates.\n' +
      '4. Anti-malware/endpoint protection per practice standard; least-privilege accounts.\n' +
      '5. No shared/public devices; dedicated device preferred; separate OS/browser profile at minimum.\n' +
      '6. Mobile: remote-wipe capability enabled where available.\n' +
      '7. Review: Device standards require security review and per-device verification (see Device security checklist).',
  },
  {
    key: 'incident-response',
    title: 'Incident-response policy',
    category: 'Incident response',
    body:
      DRAFT_HEADER +
      'Purpose: Define how suspected security incidents are handled.\n\n' +
      '1. Detection: Any suspected unauthorized access, device loss, malware, or data exposure is an incident.\n' +
      '2. Immediate steps: Lock/secure the workspace; isolate the device; preserve logs (in-app audit + AI operations); do not destroy evidence.\n' +
      '3. Assessment: Determine what data was involved and whether PHI was exposed.\n' +
      '4. Roles: Identify the responsible person and escalation contacts (see Breach-response escalation).\n' +
      '5. Documentation: Record timeline, scope, and remediation.\n' +
      '6. Review: This plan requires legal/security review; breach notification obligations are jurisdiction-specific.',
  },
  {
    key: 'breach-escalation',
    title: 'Breach-response escalation policy',
    category: 'Incident response',
    body:
      DRAFT_HEADER +
      'Purpose: Define escalation and notification for confirmed or likely breaches.\n\n' +
      '1. Escalation contacts: [PRACTICE OWNER], [PRIVACY/SECURITY OFFICER], [LEGAL COUNSEL], [CYBER INSURANCE], as applicable.\n' +
      '2. Timelines: Follow applicable breach-notification timelines (e.g. HIPAA Breach Notification Rule and state law). Consult counsel promptly.\n' +
      '3. Notifications: Determine obligations to affected individuals, regulators, and (where applicable) media, per legal advice.\n' +
      '4. Vendor breaches: If an online provider/vendor is involved, invoke BAA breach terms.\n' +
      '5. Post-incident: Conduct a review and update safeguards.\n' +
      '6. Review: Notification obligations require legal review; this template does not determine whether a breach is reportable.',
  },
  {
    key: 'ai-output-review',
    title: 'AI output review policy',
    category: 'Clinical governance',
    body:
      DRAFT_HEADER +
      'Purpose: Govern clinician review of AI-assisted output.\n\n' +
      '1. Draft-only: All AI output is a draft aid and is not part of the record until the clinician approves it.\n' +
      '2. Per-item review: Approve/edit/reject each proposed item; risk-sensitive items require individual review and are never bulk-approved.\n' +
      '3. Verification flags: Resolve every "unsupported"/"contradicted" flag before approval.\n' +
      '4. No auto-diagnosis: Screening scores are never treated as diagnoses; risk is never determined autonomously.\n' +
      '5. Provenance: Prefer approved evidence; document when pending sources are used.\n' +
      '6. Review: This policy supports, and does not replace, professional judgment.',
  },
  {
    key: 'clinical-documentation-responsibility',
    title: 'Clinical documentation responsibility policy',
    category: 'Clinical governance',
    body:
      DRAFT_HEADER +
      'Purpose: Assign responsibility for the clinical record.\n\n' +
      '1. Ownership: The clinician is solely responsible for the accuracy, completeness, and clinical appropriateness of the record.\n' +
      '2. Tool role: The application is a documentation and organization aid; it does not make clinical decisions.\n' +
      '3. Finalization: Only clinician-approved content becomes part of the official record.\n' +
      '4. Corrections: Amend records per practice policy and applicable law; version history is retained.\n' +
      '5. Review: This policy supports professional and legal documentation standards, which require legal review.',
  },
  {
    key: 'consent-disclosure-template',
    title: 'Client consent / disclosure template',
    category: 'Consent & disclosure',
    body:
      DRAFT_HEADER +
      'Purpose: Template language to inform clients about tool use (adapt with counsel; obtain consent as required).\n\n' +
      'Your clinician uses a software tool to organize clinical information and to help draft documentation. Key points:\n' +
      '• Your information is stored encrypted on your clinician’s device and is not sold or used for advertising.\n' +
      '• Draft materials generated with software assistance are always reviewed and approved by your clinician before they become part of your record.\n' +
      '• [IF APPLICABLE] With appropriate agreements in place, some information may be processed by an external AI service to assist drafting. This is only done under a signed agreement and applicable law. [REMOVE IF LOCAL-ONLY.]\n' +
      '• You may ask questions about how your information is handled at any time.\n\n' +
      'Consent: I have had the opportunity to ask questions about the use of this tool.\n' +
      'Client signature: _____________________  Date: __________\n\n' +
      'This template requires legal review for your jurisdiction and does not itself constitute valid informed consent.',
  },
  {
    key: 'clinical-responsibility-disclaimer',
    title: 'Clinical responsibility disclaimer',
    category: 'Disclaimer',
    body:
      DRAFT_HEADER +
      'Cockpit is a documentation and organization aid. It does not make clinical decisions, diagnose, or determine risk. ' +
      'All AI-assisted output is a draft and has no clinical authority until the clinician reviews and approves it. ' +
      'Screening scores are not diagnoses. The clinician is responsible for all clinical judgments and for the accuracy and appropriateness of the record. ' +
      'Using this software does not by itself make a practice HIPAA compliant; compliance depends on the practice’s policies, devices, agreements, and applicable law, and requires independent legal/security review. ' +
      'The app is not approved for use with real protected health information until all required reviews are completed.',
  },
];

// ----------------------------------------------------- PHI readiness gate

export interface PhiGateItem {
  id: string;
  key: string;
  label: string;
  detail: string;
  /** Only ever set true by explicit manual review — never derived from data. */
  complete: boolean;
  /** The final human sign-off; recorded with a named approver. */
  requiresNamedApproval?: boolean;
  completedBy?: string;
  completedAt?: string;
  notes?: string;
  updatedAt: string;
}

export type PhiGateSeed = Pick<PhiGateItem, 'key' | 'label' | 'detail'> & { requiresNamedApproval?: boolean };

/** The required gates. ALL start incomplete → default status is blocked. */
export const PHI_GATE_SEED: PhiGateSeed[] = [
  { key: 'native-build', label: 'Native app build completed', detail: 'A signed desktop/mobile build using the durable storage adapter and OS key storage has been produced.' },
  { key: 'durable-storage-verified', label: 'Durable native storage verified', detail: 'File-backed encrypted storage verified on the target device(s); no reliance on evictable browser storage.' },
  { key: 'os-key-storage-verified', label: 'OS secure key storage verified', detail: 'OS Keychain/Keystore-backed device unlock verified, including that a wiped key store forces passphrase unlock (no backdoor).' },
  { key: 'backup-restore-verified', label: 'Backup/restore verified', detail: 'Encrypted backup + integrity-checked restore tested end-to-end on the target device(s).' },
  { key: 'secure-deletion-verified', label: 'Secure deletion verified', detail: 'Client deletion cascade and media/backup sanitization verified per the Secure deletion policy.' },
  { key: 'export-workflow-reviewed', label: 'Export workflow reviewed', detail: 'Export destinations, watermarking, and records-handling reviewed and approved.' },
  { key: 'online-ai-disabled-or-approved', label: 'Online AI disabled or approved', detail: 'Online AI is disabled, OR every online provider is approved with a signed BAA and the safeguards are satisfied.' },
  { key: 'baa-vendor-review', label: 'BAA/vendor review completed where applicable', detail: 'AI Vendor / BAA review completed with a named reviewer for every online provider in use.' },
  { key: 'security-review', label: 'Security review completed', detail: 'Independent security review of encryption, storage, and key management completed.' },
  { key: 'legal-hipaa-review', label: 'Legal / HIPAA review completed', detail: 'Counsel review of safeguards, consent/disclosure language, and jurisdiction requirements completed.' },
  { key: 'incident-response-plan', label: 'Incident-response plan completed', detail: 'Incident-response and breach-escalation policies adopted and understood.' },
  { key: 'data-retention-policy', label: 'Data-retention policy completed', detail: 'Retention and secure-deletion policies adopted for the practice’s jurisdiction.' },
  { key: 'device-security-requirements', label: 'Device security requirements completed', detail: 'Device security checklist completed for every device that will hold the workspace.' },
  { key: 'clinician-training-disclosure', label: 'Clinician training/disclosure completed', detail: 'Clinician(s) trained on AI-as-draft-aid, review workflow, and responsibility; client disclosure/consent prepared.' },
  { key: 'final-manual-approval', label: 'Final manual approval recorded', detail: 'A named, responsible reviewer records explicit final approval that all above items are complete.', requiresNamedApproval: true },
];

export interface PhiGateStatus {
  blocked: boolean;
  statusLine: string;
  completed: number;
  total: number;
  incompleteLabels: string[];
  /** True only when the final named approval item is complete. */
  finalApprovalRecorded: boolean;
}

/**
 * Compute the gate status PURELY from stored completion flags. This function
 * takes NO client content and cannot be influenced by any record or prompt —
 * the gate can only be changed by explicit manual completion of every item.
 */
export function computePhiGateStatus(items: PhiGateItem[]): PhiGateStatus {
  const total = items.length;
  const completed = items.filter((i) => i.complete).length;
  const incompleteLabels = items.filter((i) => !i.complete).map((i) => i.label);
  const finalApprovalRecorded = items.some((i) => i.requiresNamedApproval && i.complete);
  const blocked = completed < total || total === 0;
  return {
    blocked,
    statusLine: blocked ? PHI_BLOCKED_STATUS : PHI_LIMITED_READY_STATUS,
    completed,
    total,
    incompleteLabels,
    finalApprovalRecorded,
  };
}
