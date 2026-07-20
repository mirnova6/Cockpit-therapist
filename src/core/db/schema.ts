/**
 * Structured clinical schema — Phase 1 entities.
 *
 * Later phases add ExtractedClinicalFact, ClinicalHypothesis, Assessment,
 * DapNote, CaseFormulation, TreatmentPlan, EvidenceLink, InterventionRecommendation,
 * RiskRecord, and ClinicianReview as sibling collections; the collection-based
 * store and repository pattern here is designed so they slot in without
 * touching existing entities.
 */

// ---------------------------------------------------------------- risk

export type RiskLevel = 'not-assessed' | 'low' | 'moderate' | 'high' | 'acute';

export interface RiskStatus {
  level: RiskLevel;
  note?: string;
  reviewedBy?: string;
  reviewedAt?: string; // ISO
}

export const RISK_LEVELS: Array<{ value: RiskLevel; label: string; description: string }> = [
  { value: 'not-assessed', label: 'Not assessed', description: 'No clinician risk review recorded yet' },
  { value: 'low', label: 'Low', description: 'No current indicators of elevated risk' },
  { value: 'moderate', label: 'Moderate', description: 'Risk factors present; monitoring indicated' },
  { value: 'high', label: 'High', description: 'Significant risk factors; active safety planning' },
  { value: 'acute', label: 'Acute', description: 'Immediate safety concern; follow crisis procedures' },
];

export function riskLabel(level: RiskLevel): string {
  return RISK_LEVELS.find((r) => r.value === level)?.label ?? level;
}

/** Sort weight so "acute" surfaces first when sorting by risk. */
export function riskWeight(level: RiskLevel): number {
  return { 'acute': 4, 'high': 3, 'moderate': 2, 'low': 1, 'not-assessed': 0 }[level];
}

// ---------------------------------------------------------------- client

export type LevelOfCare =
  | 'outpatient'
  | 'iop'
  | 'php'
  | 'residential'
  | 'inpatient'
  | 'detox'
  | 'sober-living'
  | 'other';

export const LEVELS_OF_CARE: Array<{ value: LevelOfCare; label: string }> = [
  { value: 'outpatient', label: 'Outpatient' },
  { value: 'iop', label: 'Intensive Outpatient (IOP)' },
  { value: 'php', label: 'Partial Hospitalization (PHP)' },
  { value: 'residential', label: 'Residential' },
  { value: 'inpatient', label: 'Inpatient' },
  { value: 'detox', label: 'Detox / Withdrawal Management' },
  { value: 'sober-living', label: 'Sober Living' },
  { value: 'other', label: 'Other' },
];

export type ClientStatus = 'active' | 'waitlist' | 'on-hold' | 'discharged' | 'transferred';

export const CLIENT_STATUSES: Array<{ value: ClientStatus; label: string }> = [
  { value: 'active', label: 'Active' },
  { value: 'waitlist', label: 'Waitlist' },
  { value: 'on-hold', label: 'On hold' },
  { value: 'discharged', label: 'Discharged' },
  { value: 'transferred', label: 'Transferred' },
];

export interface DiagnosisEntry {
  id: string;
  label: string;
  code?: string; // ICD-10 / DSM code if known
  kind: 'diagnosis' | 'impression'; // documented diagnosis vs diagnostic impression
  noted?: string; // ISO date
}

export interface MedicationEntry {
  id: string;
  name: string;
  dose?: string;
  frequency?: string;
  prescriber?: string;
  status: 'current' | 'discontinued';
  noted?: string; // ISO date
}

export interface ContactInfo {
  phone?: string;
  email?: string;
  emergencyContact?: string;
}

export interface Client {
  id: string;
  displayName: string; // name or initials — clinician's choice
  preferredIdentifier?: string; // e.g. chart number
  pronouns?: string;
  dateOfBirth?: string; // ISO date
  contactEnabled: boolean;
  contact?: ContactInfo;
  levelOfCare: LevelOfCare;
  status: ClientStatus;
  admissionDate?: string;
  dischargeDate?: string;
  assignedTherapist?: string;
  presentingProblem?: string;
  diagnoses: DiagnosisEntry[];
  medications: MedicationEntry[];
  risk: RiskStatus;
  /**
   * Per-client local-only override (§17): when true, NOTHING about this
   * client may be sent to an online AI provider, regardless of per-input
   * consent flags or workspace settings. Enforced in the aiGateway.
   */
  aiLocalOnly?: boolean;
  createdAt: string;
  updatedAt: string;
  archived: boolean;
}

// ------------------------------------------------------- clinical input

export type ClinicalInputType =
  | 'bps'
  | 'session-transcript'
  | 'rough-notes'
  | 'dap-note'
  | 'assessment'
  | 'risk-assessment'
  | 'medication-update'
  | 'diagnosis-update'
  | 'therapist-observation'
  | 'client-quote'
  | 'uploaded-document'
  | 'prior-treatment-plan'
  | 'discharge-info'
  | 'other';

export const INPUT_TYPES: Array<{
  value: ClinicalInputType;
  label: string;
  sessionLinked: boolean;
}> = [
  { value: 'bps', label: 'Biopsychosocial (BPS)', sessionLinked: false },
  { value: 'session-transcript', label: 'Session transcript', sessionLinked: true },
  { value: 'rough-notes', label: 'Rough session notes', sessionLinked: true },
  { value: 'dap-note', label: 'DAP note', sessionLinked: true },
  { value: 'assessment', label: 'Assessment', sessionLinked: false },
  { value: 'risk-assessment', label: 'Risk assessment', sessionLinked: false },
  { value: 'medication-update', label: 'Medication update', sessionLinked: false },
  { value: 'diagnosis-update', label: 'Diagnosis update', sessionLinked: false },
  { value: 'therapist-observation', label: 'Therapist observation', sessionLinked: true },
  { value: 'client-quote', label: 'Client quote', sessionLinked: true },
  { value: 'uploaded-document', label: 'Uploaded document', sessionLinked: false },
  { value: 'prior-treatment-plan', label: 'Prior treatment plan', sessionLinked: false },
  { value: 'discharge-info', label: 'Discharge information', sessionLinked: false },
  { value: 'other', label: 'Other clinical input', sessionLinked: false },
];

export function inputTypeLabel(type: ClinicalInputType): string {
  return INPUT_TYPES.find((t) => t.value === type)?.label ?? type;
}

export type ReportedBy = 'client-reported' | 'therapist-entered' | 'collateral';

export const REPORTED_BY_OPTIONS: Array<{ value: ReportedBy; label: string }> = [
  { value: 'therapist-entered', label: 'Therapist-entered' },
  { value: 'client-reported', label: 'Client-reported' },
  { value: 'collateral', label: 'Collateral source' },
];

export interface AttachmentRef {
  id: string; // blob id
  name: string;
  mimeType: string;
  size: number;
}

/**
 * Processing status of a raw input. Phase 1 stores raw material only;
 * the analysis pipeline (Phase 4) moves inputs through
 * pending-analysis → analyzed.
 */
export type ProcessingStatus = 'stored' | 'pending-analysis' | 'analyzed';

export interface RiskReview {
  reviewedBy: string;
  reviewedAt: string;
  note?: string;
}

export interface ClinicalInput {
  id: string;
  clientId: string;
  inputType: ClinicalInputType;
  dateOfInformation: string; // ISO date the information refers to
  sessionDate?: string;
  sessionNumber?: number;
  dateEntered: string; // ISO datetime
  rawText: string;
  attachments: AttachmentRef[];
  authorSource: string;
  reportedBy: ReportedBy;
  containsRisk: boolean;
  /** Clinician sign-off that flagged risk content has been reviewed. */
  riskReview?: RiskReview;
  /** Stored consent: may this record be included in AI analysis (Phase 4+)? */
  allowAiAnalysis: boolean;
  /** Record must never leave the device, even if online sync is later enabled. */
  localOnly: boolean;
  processingStatus: ProcessingStatus;
  version: number;
  archived: boolean;
  updatedAt: string;
}

// ------------------------------------------------------- change history

export interface ChangeRecord {
  id: string;
  clientId?: string; // absent for app-level changes
  entity: 'client' | 'clinical-input' | 'settings';
  entityId: string;
  action: 'created' | 'updated' | 'archived' | 'restored' | 'deleted' | 'risk-reviewed';
  summary: string;
  author: string;
  at: string; // ISO datetime
}

// ---------------------------------------------------------------- audit

export type AuditCategory = 'auth' | 'data' | 'export' | 'backup' | 'security';

export interface AuditEvent {
  id: string;
  at: string;
  category: AuditCategory;
  action: string;
  detail?: string;
}

// ---------------------------------------------------------------- prefs

export interface UserPrefs {
  recentlyViewed: Array<{ clientId: string; at: string }>;
  /** Formulation frameworks the clinician has enabled (default: all). */
  enabledFrameworks?: string[];
}

export const DEFAULT_PREFS: UserPrefs = { recentlyViewed: [] };

// ---------------------------------------------------------------- utils

export function newId(): string {
  return crypto.randomUUID();
}

export function nowIso(): string {
  return new Date().toISOString();
}
