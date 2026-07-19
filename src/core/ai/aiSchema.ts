/**
 * Phase 4 AI schema: provider settings, the AI operations log, clinician
 * feedback records, and the shared label vocabularies (extraction labels,
 * claim-verification statuses, qualitative confidence).
 *
 * Everything here is stored in the same AES-GCM encrypted `records` store as
 * every other collection — including provider API keys, which therefore never
 * exist in plaintext at rest. Locking discards the data key and with it all
 * access to these records.
 */

// ---------------------------------------------------------- provider types

export type AiProviderType = 'deterministic' | 'local' | 'online';

export const PROVIDER_TYPE_LABELS: Record<AiProviderType, string> = {
  deterministic: 'Deterministic (no AI model)',
  local: 'Local AI (on this device / local network)',
  online: 'Secure Online AI (leaves this device)',
};

export type AiCapability =
  | 'extraction'
  | 'document-generation'
  | 'clinical-synthesis'
  | 'case-formulation'
  | 'hypothesis-drafting'
  | 'intervention-recommendation'
  | 'safety-strategy'
  | 'question-answering'
  | 'knowledge-assistance'
  | 'claim-verification';

// --------------------------------------------------------------- settings

/**
 * Workspace-level AI configuration. Stored encrypted in the `ai-settings`
 * collection under a fixed key.
 *
 * Online processing is DISABLED by default, and enabling it is not enough by
 * itself: the gateway refuses to send protected information unless the
 * clinician has also attested that the provider relationship is approved for
 * that use (`onlinePhiApproved`). Configuration alone is never presented as
 * HIPAA compliance.
 */
export interface AiSettings {
  /** Which provider handles AI work: 'deterministic' | 'local' | 'online'. */
  activeProviderType: AiProviderType;

  // ---- local provider (Ollama / OpenAI-compatible endpoint) ----
  localEndpointUrl: string;
  localModel: string;
  /** Rough context-window size (tokens) the clinician says the model has. */
  localContextWindow?: number;
  localTemperature?: number;

  // ---- online provider (Anthropic API) ----
  /** Master switch; false by default. Nothing leaves the device while false. */
  onlineEnabled: boolean;
  onlineApiKey?: string;
  onlineModel: string;
  /**
   * Clinician attestation that an appropriate contractual arrangement /
   * Business Associate Agreement is in place with the provider. Displayed,
   * never asserted by the app on its own.
   */
  baaConfirmed: boolean;
  /**
   * Clinician attestation that this provider relationship is approved for
   * protected health information. The gateway REFUSES to send PHI online
   * without it.
   */
  onlinePhiApproved: boolean;
  /** Apply deterministic redaction before online sending (preview shown). */
  redactBeforeSend: boolean;

  updatedAt: string;
}

export const DEFAULT_AI_SETTINGS: AiSettings = {
  activeProviderType: 'deterministic',
  localEndpointUrl: 'http://localhost:11434',
  localModel: '',
  onlineEnabled: false,
  onlineModel: 'claude-sonnet-5',
  baaConfirmed: false,
  onlinePhiApproved: false,
  redactBeforeSend: false,
  updatedAt: '',
};

// ------------------------------------------------------- operation logging

export type AiOperationStatus = 'completed' | 'failed' | 'cancelled' | 'refused';

export type AiConsentStatus =
  | 'not-required-local'
  | 'not-required-deterministic'
  | 'verified'
  | 'refused-missing-consent'
  | 'refused-provider-not-approved'
  | 'refused-online-disabled';

/**
 * One entry per AI operation. Contains identifiers and metadata only —
 * never full plaintext prompts or clinical text — and is encrypted at rest
 * like everything else.
 */
export interface AiOperationRecord {
  id: string;
  clientId?: string;
  capability: AiCapability;
  providerType: AiProviderType;
  providerId: string;
  modelId: string;
  providerVersion: string;
  at: string;
  /** 'local' | 'online' | 'deterministic' processing mode used. */
  mode: AiProviderType;
  /** Source references only (type:id), never source text. */
  selectedSources: string[];
  /** Knowledge chunks retrieved (sourceId:chunkId), never chunk text. */
  knowledgeSources: string[];
  outputSchemaVersion: string;
  phiLeftDevice: boolean;
  redactionApplied: boolean;
  consentStatus: AiConsentStatus;
  /** Review status of whatever the operation produced. */
  reviewStatus: 'pending-review' | 'not-applicable';
  status: AiOperationStatus;
  /** Sanitized error label (no clinical content). */
  errorKind?: string;
  durationMs?: number;
}

export const AI_OUTPUT_SCHEMA_VERSION = '2026-07-p4.1';

// ------------------------------------------------------- extraction labels

export type ExtractionLabel =
  | 'explicitly-stated'
  | 'strongly-supported'
  | 'possible-inference'
  | 'ambiguous'
  | 'conflicting-information'
  | 'needs-further-assessment';

export const EXTRACTION_LABELS: Array<{ value: ExtractionLabel; label: string }> = [
  { value: 'explicitly-stated', label: 'Explicitly Stated' },
  { value: 'strongly-supported', label: 'Strongly Supported Extraction' },
  { value: 'possible-inference', label: 'Possible Inference' },
  { value: 'ambiguous', label: 'Ambiguous' },
  { value: 'conflicting-information', label: 'Conflicting Information' },
  { value: 'needs-further-assessment', label: 'Needs Further Assessment' },
];

export function extractionLabelText(value: ExtractionLabel): string {
  return EXTRACTION_LABELS.find((l) => l.value === value)?.label ?? value;
}

/** Labels that describe inference rather than explicit statement. */
export const INFERENTIAL_LABELS: ExtractionLabel[] = [
  'possible-inference',
  'ambiguous',
  'conflicting-information',
  'needs-further-assessment',
];

// -------------------------------------------------- claim verification

export type ClaimStatus =
  | 'directly-supported'
  | 'supported-by-hypothesis'
  | 'general-clinical-guidance'
  | 'therapist-authored'
  | 'unsupported'
  | 'contradicted'
  | 'needs-clarification';

export const CLAIM_STATUS_LABELS: Record<ClaimStatus, string> = {
  'directly-supported': 'Directly Supported',
  'supported-by-hypothesis': 'Supported by Approved Hypothesis',
  'general-clinical-guidance': 'General Clinical Guidance',
  'therapist-authored': 'Therapist Authored',
  'unsupported': 'Unsupported',
  'contradicted': 'Contradicted',
  'needs-clarification': 'Needs Clarification',
};

/** Statuses that must be highlighted before clinician approval. */
export const FLAGGED_CLAIM_STATUSES: ClaimStatus[] = [
  'unsupported',
  'contradicted',
  'needs-clarification',
];

// ------------------------------------------------------------- confidence

/**
 * Qualitative confidence only (§18) — the same four labels used for
 * hypotheses since Phase 2. No numeric probabilities anywhere.
 */
export type ConfidenceLevel =
  | 'insufficient-evidence'
  | 'low-support'
  | 'moderate-support'
  | 'strong-support';

export const CONFIDENCE_LABELS: Record<ConfidenceLevel, string> = {
  'insufficient-evidence': 'Insufficient Evidence',
  'low-support': 'Low Support',
  'moderate-support': 'Moderate Support',
  'strong-support': 'Strong Support',
};

export interface ConfidenceInputs {
  supportingSources: number;
  approvedSources: number;
  distinctTimePeriods: number;
  contradictingSources: number;
  explicit: boolean;
}

/**
 * Deterministic qualitative confidence per §18: source count, approval,
 * longitudinal repetition, contradiction, explicit-vs-inferred. High
 * confidence never converts a hypothesis into a fact — this function only
 * labels support, it never changes entity kinds.
 */
export function computeConfidence(inputs: ConfidenceInputs): ConfidenceLevel {
  if (inputs.supportingSources === 0) return 'insufficient-evidence';
  let score = 0;
  score += Math.min(inputs.supportingSources, 3);
  score += Math.min(inputs.approvedSources, 2);
  score += Math.min(inputs.distinctTimePeriods - 1, 2);
  if (inputs.explicit) score += 1;
  score -= inputs.contradictingSources * 2;
  if (score <= 0) return 'insufficient-evidence';
  if (score <= 2) return 'low-support';
  if (score <= 4) return 'moderate-support';
  return 'strong-support';
}

// -------------------------------------------------------------- feedback

export type FeedbackLabel =
  | 'accurate'
  | 'partially-accurate'
  | 'inaccurate'
  | 'useful'
  | 'not-useful'
  | 'too-vague'
  | 'too-certain'
  | 'missing-evidence'
  | 'missed-contradiction'
  | 'missed-risk'
  | 'over-pathologized'
  | 'clinically-inappropriate'
  | 'culturally-incomplete';

export const FEEDBACK_LABELS: Array<{ value: FeedbackLabel; label: string }> = [
  { value: 'accurate', label: 'Accurate' },
  { value: 'partially-accurate', label: 'Partially Accurate' },
  { value: 'inaccurate', label: 'Inaccurate' },
  { value: 'useful', label: 'Useful' },
  { value: 'not-useful', label: 'Not Useful' },
  { value: 'too-vague', label: 'Too Vague' },
  { value: 'too-certain', label: 'Too Certain' },
  { value: 'missing-evidence', label: 'Missing Evidence' },
  { value: 'missed-contradiction', label: 'Missed Contradiction' },
  { value: 'missed-risk', label: 'Missed Risk' },
  { value: 'over-pathologized', label: 'Over-Pathologized' },
  { value: 'clinically-inappropriate', label: 'Clinically Inappropriate' },
  { value: 'culturally-incomplete', label: 'Culturally Incomplete' },
];

/**
 * Clinician feedback on an AI-generated output. Stored in its own
 * collection, separate from the clinical record; scoped to one client and
 * never used as clinical data for any client. No automatic fine-tuning or
 * retraining happens in Phase 4 — these records exist for the clinician and
 * for the Phase 5 evaluation export.
 */
export interface AiFeedbackRecord {
  id: string;
  clientId: string;
  operationId?: string;
  targetType: string;
  targetId: string;
  labels: FeedbackLabel[];
  comment?: string;
  author: string;
  at: string;
}
