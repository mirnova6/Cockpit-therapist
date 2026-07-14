/**
 * Phase 2 structured clinical schema: extracted facts, assessments,
 * hypotheses, evidence links, contradictions, needs-further-assessment
 * items, and version snapshots.
 *
 * All entities are stored in the same AES-GCM encrypted `records` store as
 * Phase 1, each in its own collection, and every entity carries a clientId —
 * repositories enforce that no query and no link ever crosses clients.
 */

// ------------------------------------------------------- review status

export type ReviewStatus =
  | 'pending'
  | 'approved'
  | 'edited' // clinician edited then approved
  | 'rejected'
  | 'needs-clarification'
  | 'superseded';

export const REVIEW_STATUSES: Array<{ value: ReviewStatus; label: string }> = [
  { value: 'pending', label: 'Pending review' },
  { value: 'approved', label: 'Clinician approved' },
  { value: 'edited', label: 'Clinician edited' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'needs-clarification', label: 'Needs clarification' },
  { value: 'superseded', label: 'Superseded' },
];

export function reviewStatusLabel(status: ReviewStatus): string {
  return REVIEW_STATUSES.find((s) => s.value === status)?.label ?? status;
}

/** Statuses that count as part of the approved clinical record. */
export const APPROVED_STATUSES: ReviewStatus[] = ['approved', 'edited'];

// ------------------------------------------------- source classification

export type SourceClassification =
  | 'client-report'
  | 'therapist-observation'
  | 'assessment-based'
  | 'documented-diagnosis'
  | 'medication-record'
  | 'historical-record'
  | 'collateral'
  | 'prior-documentation'
  | 'needs-source-clarification';

export const SOURCE_CLASSIFICATIONS: Array<{ value: SourceClassification; label: string }> = [
  { value: 'client-report', label: 'Client Report' },
  { value: 'therapist-observation', label: 'Therapist Observation' },
  { value: 'assessment-based', label: 'Assessment-Based Finding' },
  { value: 'documented-diagnosis', label: 'Documented Diagnosis' },
  { value: 'medication-record', label: 'Medication Record' },
  { value: 'historical-record', label: 'Historical Record' },
  { value: 'collateral', label: 'Collateral Information' },
  { value: 'prior-documentation', label: 'Prior Clinical Documentation' },
  { value: 'needs-source-clarification', label: 'Needs Source Clarification' },
];

export function classificationLabel(value: SourceClassification): string {
  return SOURCE_CLASSIFICATIONS.find((c) => c.value === value)?.label ?? value;
}

// -------------------------------------------------------- fact category

export type ProfileSection =
  | 'presenting-problem'
  | 'symptoms'
  | 'diagnoses'
  | 'medications'
  | 'biological'
  | 'trauma-developmental'
  | 'family-relational'
  | 'substance-use'
  | 'risk'
  | 'protective'
  | 'strengths'
  | 'coping'
  | 'functional'
  | 'goals'
  | 'progress'
  | 'barriers'
  | 'therapeutic-relationship'
  | 'identity-themes'
  | 'other';

export const PROFILE_SECTIONS: Array<{ value: ProfileSection; label: string }> = [
  { value: 'presenting-problem', label: 'Presenting Problem' },
  { value: 'symptoms', label: 'Current Symptoms' },
  { value: 'diagnoses', label: 'Diagnoses' },
  { value: 'medications', label: 'Medications' },
  { value: 'biological', label: 'Biological & Medical Factors' },
  { value: 'trauma-developmental', label: 'Trauma & Developmental History' },
  { value: 'family-relational', label: 'Family & Relational Factors' },
  { value: 'substance-use', label: 'Substance-Use Factors' },
  { value: 'risk', label: 'Risk Factors' },
  { value: 'protective', label: 'Protective Factors' },
  { value: 'strengths', label: 'Strengths' },
  { value: 'coping', label: 'Coping & Regulation' },
  { value: 'functional', label: 'Functional Impairments' },
  { value: 'goals', label: 'Treatment Goals' },
  { value: 'progress', label: 'Treatment Progress' },
  { value: 'barriers', label: 'Treatment Barriers' },
  { value: 'therapeutic-relationship', label: 'Therapeutic Relationship Observations' },
  { value: 'identity-themes', label: 'Beliefs, Fears & Identity Themes' },
  { value: 'other', label: 'Other Clinical Information' },
];

export type FactCategory =
  | 'presenting-problem'
  | 'symptom'
  | 'diagnosis'
  | 'medication'
  | 'medical-factor'
  | 'sleep'
  | 'appetite'
  | 'energy'
  | 'cognition'
  | 'mood'
  | 'anxiety'
  | 'trauma'
  | 'dissociation'
  | 'substance-use'
  | 'craving'
  | 'withdrawal'
  | 'relapse-trigger'
  | 'risk-factor'
  | 'protective-factor'
  | 'strength'
  | 'coping-strategy'
  | 'family-factor'
  | 'developmental-factor'
  | 'cultural-factor'
  | 'relationship-pattern'
  | 'conflict-pattern'
  | 'core-belief'
  | 'core-fear'
  | 'shame-theme'
  | 'defense-adaptation'
  | 'emotional-regulation'
  | 'functional-impairment'
  | 'treatment-goal'
  | 'treatment-progress'
  | 'treatment-barrier'
  | 'intervention-used'
  | 'therapeutic-relationship'
  | 'other';

export const FACT_CATEGORIES: Array<{
  value: FactCategory;
  label: string;
  section: ProfileSection;
  riskByDefault?: boolean;
}> = [
  { value: 'presenting-problem', label: 'Presenting Problem', section: 'presenting-problem' },
  { value: 'symptom', label: 'Symptom', section: 'symptoms' },
  { value: 'diagnosis', label: 'Diagnosis', section: 'diagnoses' },
  { value: 'medication', label: 'Medication', section: 'medications' },
  { value: 'medical-factor', label: 'Medical Factor', section: 'biological' },
  { value: 'sleep', label: 'Sleep', section: 'symptoms' },
  { value: 'appetite', label: 'Appetite', section: 'symptoms' },
  { value: 'energy', label: 'Energy', section: 'symptoms' },
  { value: 'cognition', label: 'Cognition', section: 'symptoms' },
  { value: 'mood', label: 'Mood', section: 'symptoms' },
  { value: 'anxiety', label: 'Anxiety', section: 'symptoms' },
  { value: 'trauma', label: 'Trauma', section: 'trauma-developmental' },
  { value: 'dissociation', label: 'Dissociation', section: 'symptoms' },
  { value: 'substance-use', label: 'Substance Use', section: 'substance-use' },
  { value: 'craving', label: 'Craving', section: 'substance-use' },
  { value: 'withdrawal', label: 'Withdrawal', section: 'substance-use' },
  { value: 'relapse-trigger', label: 'Relapse Trigger', section: 'substance-use' },
  { value: 'risk-factor', label: 'Risk Factor', section: 'risk', riskByDefault: true },
  { value: 'protective-factor', label: 'Protective Factor', section: 'protective' },
  { value: 'strength', label: 'Strength', section: 'strengths' },
  { value: 'coping-strategy', label: 'Coping Strategy', section: 'coping' },
  { value: 'family-factor', label: 'Family Factor', section: 'family-relational' },
  { value: 'developmental-factor', label: 'Developmental Factor', section: 'trauma-developmental' },
  { value: 'cultural-factor', label: 'Cultural Factor', section: 'identity-themes' },
  { value: 'relationship-pattern', label: 'Relationship Pattern', section: 'family-relational' },
  { value: 'conflict-pattern', label: 'Conflict Pattern', section: 'family-relational' },
  { value: 'core-belief', label: 'Core Belief', section: 'identity-themes' },
  { value: 'core-fear', label: 'Core Fear', section: 'identity-themes' },
  { value: 'shame-theme', label: 'Shame Theme', section: 'identity-themes' },
  { value: 'defense-adaptation', label: 'Defense / Coping Adaptation', section: 'coping' },
  { value: 'emotional-regulation', label: 'Emotional Regulation Pattern', section: 'coping' },
  { value: 'functional-impairment', label: 'Functional Impairment', section: 'functional' },
  { value: 'treatment-goal', label: 'Treatment Goal', section: 'goals' },
  { value: 'treatment-progress', label: 'Treatment Progress', section: 'progress' },
  { value: 'treatment-barrier', label: 'Treatment Barrier', section: 'barriers' },
  { value: 'intervention-used', label: 'Intervention Used', section: 'other' },
  { value: 'therapeutic-relationship', label: 'Therapeutic Relationship Observation', section: 'therapeutic-relationship' },
  { value: 'other', label: 'Other Clinical Information', section: 'other' },
];

export function factCategoryMeta(value: FactCategory) {
  return FACT_CATEGORIES.find((c) => c.value === value) ?? FACT_CATEGORIES[FACT_CATEGORIES.length - 1];
}

// ------------------------------------------------------ extracted fact

export type ExtractionMethod = 'rule-based' | 'manual' | 'ai-provider';

export const EXTRACTION_METHOD_LABELS: Record<ExtractionMethod, string> = {
  'rule-based': 'Rule-Based Extraction',
  'manual': 'Manually Entered',
  'ai-provider': 'AI Extraction Provider',
};

export type ExtractionConfidence = 'high' | 'moderate' | 'low';

export interface ExtractedFact {
  id: string;
  clientId: string;
  sourceInputId: string;
  sourceInputVersion: number;
  category: FactCategory;
  statement: string;
  /** Exact supporting excerpt from the source text. */
  excerpt?: string;
  /** e.g. "line 14" or "section: Sleep". */
  sourceLocation?: string;
  dateOccurred?: string;
  dateRecorded: string;
  classification: SourceClassification;
  extractionMethod: ExtractionMethod;
  extractionConfidence: ExtractionConfidence;
  temporalStatus: 'current' | 'historical';
  reviewStatus: ReviewStatus;
  /** Free-text note describing what the clinician corrected, if edited. */
  clinicianCorrection?: string;
  riskRelated: boolean;
  createdAt: string;
  updatedAt: string;
  version: number;
}

// ---------------------------------------------------------- assessment

export interface SubscaleScore {
  label: string;
  score: number;
}

export interface AssessmentRecord {
  id: string;
  clientId: string;
  /** Definition key ('phq9', …) or 'custom'. */
  definitionKey: string;
  /** Display name (custom name for custom assessments). */
  name: string;
  dateAdministered: string;
  totalScore?: number;
  subscaleScores?: SubscaleScore[];
  /** Computed from encoded official rules only; undefined = not configured. */
  severityInterpretation?: string;
  clinicianNotes?: string;
  sourceInputId?: string;
  riskFlags: string[];
  /** Required disposition note when riskFlags is non-empty. */
  riskDisposition?: string;
  reviewStatus: ReviewStatus;
  createdAt: string;
  updatedAt: string;
  version: number;
}

// ---------------------------------------------------------- hypothesis

export type HypothesisCategory =
  | 'attachment-pattern'
  | 'core-belief'
  | 'core-fear'
  | 'trauma-adaptation'
  | 'defense-mechanism'
  | 'substance-use-function'
  | 'emotional-regulation-pattern'
  | 'relational-pattern'
  | 'shame-pattern'
  | 'maintaining-factor'
  | 'motivation-for-change'
  | 'treatment-barrier'
  | 'protective-process'
  | 'other';

export const HYPOTHESIS_CATEGORIES: Array<{ value: HypothesisCategory; label: string }> = [
  { value: 'attachment-pattern', label: 'Attachment Pattern' },
  { value: 'core-belief', label: 'Core Belief' },
  { value: 'core-fear', label: 'Core Fear' },
  { value: 'trauma-adaptation', label: 'Trauma Adaptation' },
  { value: 'defense-mechanism', label: 'Defense Mechanism' },
  { value: 'substance-use-function', label: 'Substance-Use Function' },
  { value: 'emotional-regulation-pattern', label: 'Emotional Regulation Pattern' },
  { value: 'relational-pattern', label: 'Relational Pattern' },
  { value: 'shame-pattern', label: 'Shame Pattern' },
  { value: 'maintaining-factor', label: 'Maintaining Factor' },
  { value: 'motivation-for-change', label: 'Motivation for Change' },
  { value: 'treatment-barrier', label: 'Treatment Barrier' },
  { value: 'protective-process', label: 'Protective Process' },
  { value: 'other', label: 'Other Clinical Hypothesis' },
];

export type HypothesisConfidence =
  | 'insufficient-evidence'
  | 'low-support'
  | 'moderate-support'
  | 'strong-support';

export const HYPOTHESIS_CONFIDENCES: Array<{ value: HypothesisConfidence; label: string }> = [
  { value: 'insufficient-evidence', label: 'Insufficient Evidence' },
  { value: 'low-support', label: 'Low Support' },
  { value: 'moderate-support', label: 'Moderate Support' },
  { value: 'strong-support', label: 'Strong Support' },
];

export interface ClinicalHypothesis {
  id: string;
  clientId: string;
  category: HypothesisCategory;
  statement: string;
  confidence: HypothesisConfidence;
  alternativeExplanations: string[];
  missingInformation: string[];
  questionsToAssess: string[];
  clinicianComments?: string;
  reviewStatus: ReviewStatus;
  lifecycleStatus: 'active' | 'rejected' | 'superseded';
  createdAt: string;
  updatedAt: string;
  version: number;
}

// -------------------------------------------------------- evidence link

export type EvidenceTargetType = 'fact' | 'hypothesis' | 'assessment' | 'contradiction' | 'gap';

export type EvidenceRelationship =
  | 'supports'
  | 'contradicts'
  | 'contextualizes'
  | 'historical-background'
  | 'needs-verification';

export const EVIDENCE_RELATIONSHIPS: Array<{ value: EvidenceRelationship; label: string }> = [
  { value: 'supports', label: 'Supports' },
  { value: 'contradicts', label: 'Contradicts' },
  { value: 'contextualizes', label: 'Contextualizes' },
  { value: 'historical-background', label: 'Historical Background' },
  { value: 'needs-verification', label: 'Needs Verification' },
];

export type EvidenceStrength = 'strong' | 'moderate' | 'weak';

export interface EvidenceLink {
  id: string;
  clientId: string;
  targetType: EvidenceTargetType;
  targetId: string;
  sourceInputId: string;
  sourceInputVersion: number;
  excerpt: string;
  sourceLocation?: string;
  dateOfSource: string;
  relationship: EvidenceRelationship;
  strength: EvidenceStrength;
  reviewStatus: ReviewStatus;
  createdAt: string;
}

// ------------------------------------------------------- contradiction

export type ContradictionResolution =
  | 'unresolved'
  | 'clarified'
  | 'both-contextually-true'
  | 'source-error'
  | 'historical-change'
  | 'clinician-resolved'
  | 'no-longer-relevant';

export const CONTRADICTION_RESOLUTIONS: Array<{ value: ContradictionResolution; label: string }> = [
  { value: 'unresolved', label: 'Unresolved' },
  { value: 'clarified', label: 'Clarified' },
  { value: 'both-contextually-true', label: 'Both Contextually True' },
  { value: 'source-error', label: 'Source Error' },
  { value: 'historical-change', label: 'Historical Change' },
  { value: 'clinician-resolved', label: 'Clinician Resolved' },
  { value: 'no-longer-relevant', label: 'No Longer Relevant' },
];

export interface EvidencePointer {
  sourceInputId?: string;
  description: string;
}

export interface Contradiction {
  id: string;
  clientId: string;
  topic: string;
  description: string;
  clinicalSignificance?: string;
  firstEvidence: EvidencePointer;
  secondEvidence: EvidencePointer;
  resolutionStatus: ContradictionResolution;
  clinicianNote?: string;
  dateIdentified: string;
  dateResolved?: string;
  createdAt: string;
  updatedAt: string;
  version: number;
}

// ------------------------------------------- needs further assessment

export type GapPriority = 'high' | 'medium' | 'low';
export type GapStatus = 'open' | 'in-progress' | 'answered' | 'no-longer-relevant';

export interface NeedsAssessmentItem {
  id: string;
  clientId: string;
  topic: string;
  reason: string;
  existingEvidence?: string;
  suggestedQuestions: string[];
  priority: GapPriority;
  status: GapStatus;
  clinicianNote?: string;
  createdAt: string;
  updatedAt: string;
  version: number;
}

// ------------------------------------------------------ version record

export type VersionedEntityType =
  | 'fact'
  | 'assessment'
  | 'hypothesis'
  | 'evidence'
  | 'contradiction'
  | 'gap';

export interface VersionRecord {
  id: string;
  clientId: string;
  entityType: VersionedEntityType;
  entityId: string;
  /** The version number this snapshot represents (the state BEFORE the change). */
  entityVersion: number;
  snapshot: unknown;
  reason: string;
  author: string;
  at: string;
  reviewDecision?: string;
}
