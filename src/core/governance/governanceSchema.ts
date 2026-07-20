/**
 * Phase 5 governance schema: the provider approval registry, the security &
 * compliance readiness checklist, and client-namespaced embedding records.
 *
 * Everything is stored in the encrypted records store. The checklist is a
 * READINESS tool — it never claims compliance is complete, and the UI must
 * always carry "requires legal/security review" wording.
 */
import type { AiCapability } from '../ai/aiSchema';

// ------------------------------------------------ provider approvals (§17)

export type ApprovalStatus = 'not-approved' | 'approved' | 'suspended' | 'expired';

export const APPROVAL_STATUSES: Array<{ value: ApprovalStatus; label: string }> = [
  { value: 'not-approved', label: 'Not approved' },
  { value: 'approved', label: 'Approved' },
  { value: 'suspended', label: 'Suspended' },
  { value: 'expired', label: 'Expired' },
];

export type BaaStatus = 'none' | 'in-progress' | 'signed' | 'not-required-no-phi';

export const BAA_STATUSES: Array<{ value: BaaStatus; label: string }> = [
  { value: 'none', label: 'No agreement' },
  { value: 'in-progress', label: 'In progress' },
  { value: 'signed', label: 'Signed BAA/contract on file' },
  { value: 'not-required-no-phi', label: 'Not required (no PHI use)' },
];

/** Purposes map to gateway capabilities so enforcement is mechanical. */
export const APPROVAL_PURPOSES: Array<{ value: AiCapability; label: string }> = [
  { value: 'extraction', label: 'Extraction' },
  { value: 'document-generation', label: 'Document generation' },
  { value: 'clinical-synthesis', label: 'Clinical synthesis / pipeline' },
  { value: 'case-formulation', label: 'Case formulation' },
  { value: 'hypothesis-drafting', label: 'Hypothesis drafting' },
  { value: 'intervention-recommendation', label: 'Intervention recommendations' },
  { value: 'safety-strategy', label: 'Safety & trust strategy' },
  { value: 'question-answering', label: 'Clinical assistant answers' },
  { value: 'knowledge-assistance', label: 'Knowledge assistance' },
  { value: 'claim-verification', label: 'Claim verification' },
];

export interface ProviderApproval {
  id: string;
  /** Registry key: matches ClinicalAIProvider.id (e.g. 'anthropic-online'). */
  providerId: string;
  providerName: string;
  providerType: 'local' | 'online';
  model: string;
  endpoint?: string;
  approvalStatus: ApprovalStatus;
  baaStatus: BaaStatus;
  approvedPurposes: AiCapability[];
  disallowedPurposes: AiCapability[];
  /** Approval expires / must be re-reviewed after this date. */
  reviewDueDate?: string;
  /** Reminder date for API key rotation. */
  keyRotationDue?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
  version: number;
}

// -------------------------------------------------- readiness checklist (§18)

export type ChecklistStatus = 'not-started' | 'in-progress' | 'ready-for-review' | 'reviewed' | 'blocked';

export const CHECKLIST_STATUSES: Array<{ value: ChecklistStatus; label: string }> = [
  { value: 'not-started', label: 'Not started' },
  { value: 'in-progress', label: 'In progress' },
  { value: 'ready-for-review', label: 'Ready for review' },
  { value: 'reviewed', label: 'Reviewed' },
  { value: 'blocked', label: 'Blocked' },
];

export interface ChecklistItem {
  id: string;
  category: string;
  item: string;
  status: ChecklistStatus;
  notes?: string;
  /** Pointer to evidence: a test name, audit entry, or document reference. */
  evidence?: string;
  dateReviewed?: string;
  reviewer?: string;
  nextReviewDate?: string;
  updatedAt: string;
}

export const READINESS_DISCLAIMER =
  'Readiness checklist — an internal preparation tool. Completing items here does NOT establish HIPAA compliance or legal adequacy; formal legal and security review is required.';

/** Seeded checklist: category → items. Statuses all start 'not-started'. */
export const CHECKLIST_SEED: Array<{ category: string; items: Array<{ item: string; evidence?: string }> }> = [
  {
    category: 'Encryption',
    items: [
      { item: 'All records and blobs AES-256-GCM encrypted at rest', evidence: 'cryptoService.test.ts; E2E encrypted-at-rest check' },
      { item: 'Key derivation PBKDF2-SHA256 310k iterations; DEK never persisted unwrapped', evidence: 'authService.test.ts' },
      { item: 'Model API keys stored only inside the encrypted records store', evidence: 'aiGateway.test.ts encryption-at-rest' },
    ],
  },
  {
    category: 'Authentication',
    items: [
      { item: 'Passphrase minimum length enforced; PIN optional and rate-limited', evidence: 'authService.test.ts' },
      { item: 'Failed-attempt lockout with escalating backoff', evidence: 'authService.test.ts lockout tests' },
    ],
  },
  {
    category: 'Locking behavior',
    items: [
      { item: 'Auto-lock clears the in-memory key after inactivity', evidence: 'useAutoLock hook; manual check' },
      { item: 'Locking cancels in-flight AI operations and clears AI state', evidence: 'aiGateway.test.ts cancelAll; authStore.lock' },
    ],
  },
  {
    category: 'Backup and restore',
    items: [
      { item: 'Backups contain only encrypted envelopes and restore across all phases', evidence: 'backupService.test.ts (P1–P5 round trips)' },
    ],
  },
  {
    category: 'Secure deletion',
    items: [
      { item: 'Client deletion cascades across every collection including AI, embeddings, and intelligence records', evidence: 'database.test.ts; governance.test.ts embedding deletion' },
    ],
  },
  {
    category: 'Export controls',
    items: [
      { item: 'Only approved documents export; drafts watermarked; no internal instructions or key material in exports', evidence: 'documents.test.ts export rules' },
      { item: 'Embeddings excluded from client exports by default', evidence: 'governance.test.ts' },
    ],
  },
  {
    category: 'Audit logging',
    items: [
      { item: 'Security-relevant actions audited without clinical plaintext', evidence: 'aiGateway.test.ts isolation audit; audit viewer' },
    ],
  },
  {
    category: 'AI provider configuration',
    items: [
      { item: 'Deterministic fallback always available; provider readiness is genuinely checked', evidence: 'providers.test.ts' },
    ],
  },
  {
    category: 'Online processing safeguards',
    items: [
      { item: 'Online disabled by default; PHI refused without provider approval + attestation + consent + confirmed preview', evidence: 'aiGateway.test.ts consent gate; governance.test.ts purpose gating' },
      { item: 'Emergency disable switch immediately blocks online sends', evidence: 'governance.test.ts kill switch' },
    ],
  },
  {
    category: 'BAA/contract tracking',
    items: [
      { item: 'Provider approval registry records BAA status, purposes, expiration, and key rotation dates', evidence: 'Provider approval registry screen' },
    ],
  },
  {
    category: 'Risk workflow',
    items: [
      { item: 'Risk content requires individual review and disposition; never bulk-approvable; AI never determines risk', evidence: 'structuredRepository.test.ts; pipeline.test.ts risk tests' },
    ],
  },
  {
    category: 'Clinician review',
    items: [
      { item: 'Nothing becomes part of the record without explicit clinician decision', evidence: 'pipeline.test.ts; documents.test.ts' },
    ],
  },
  {
    category: 'Cross-client isolation',
    items: [
      { item: 'Repositories, retrieval, gateway, and embeddings all reject cross-client references', evidence: 'clientRetrieval.test.ts; aiGateway.test.ts; governance.test.ts' },
    ],
  },
  {
    category: 'Data retention policy',
    items: [{ item: 'Practice-level retention/destruction policy documented (outside the app)' }],
  },
  {
    category: 'Device security',
    items: [
      { item: 'Device disk encryption, OS updates, and screen lock verified on every device used' },
      { item: 'Browser profile isolation / dedicated device policy decided' },
    ],
  },
  {
    category: 'Incident response',
    items: [{ item: 'Breach/incident response plan documented, including notification obligations' }],
  },
  {
    category: 'Access control',
    items: [{ item: 'Single-clinician access model documented; multi-user access is out of scope until a future phase' }],
  },
  {
    category: 'Native packaging',
    items: [
      { item: 'Capacitor/Tauri packaging evaluated (keychain-backed key storage, OS keystore)' },
      { item: 'SQLite adapter behind StorageAdapter evaluated for native builds' },
    ],
  },
  {
    category: 'Legal review',
    items: [{ item: 'Counsel review of consent language, disclosures, and jurisdiction requirements' }],
  },
  {
    category: 'HIPAA policy review',
    items: [
      { item: 'Administrative/physical/technical safeguards mapped to practice policies — requires legal/security review' },
      { item: 'BAAs executed for every online provider before any PHI use' },
    ],
  },
];

// ------------------------------------------------------- embeddings (§16)

export interface EmbeddingRecord {
  id: string;
  /** Namespace — embeddings are only ever queried within one client. */
  clientId: string;
  refType: string;
  refId: string;
  /** Which provider/model produced the vector. */
  providerId: string;
  modelId: string;
  dimension: number;
  vector: number[];
  textHash: string;
  createdAt: string;
}
