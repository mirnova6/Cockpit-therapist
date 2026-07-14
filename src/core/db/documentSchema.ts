/**
 * Phase 3 document schema: DAP notes, Master Treatment Plans, and treatment
 * goals/objectives.
 *
 * Documents are SEGMENT-based: every sentence/block the generator produces is
 * a DocSegment carrying its own evidence references, factual/interpretive
 * kind, and risk flag. The clinician edits segments (text, delete, add,
 * mark therapist-authored); sections are rendered by grouping segments. The
 * original generated draft is frozen verbatim on the document and never
 * modified.
 */

// ------------------------------------------------------------- statuses

export type DocReviewStatus =
  | 'draft'
  | 'pending-review'
  | 'approved'
  | 'edited' // clinician edited, then approved
  | 'rejected'
  | 'superseded'
  | 'archived';

export const DOC_STATUS_LABELS: Record<DocReviewStatus, string> = {
  'draft': 'Draft',
  'pending-review': 'Pending review',
  'approved': 'Clinician approved',
  'edited': 'Clinician edited & approved',
  'rejected': 'Rejected',
  'superseded': 'Superseded',
  'archived': 'Archived',
};

export const APPROVED_DOC_STATUSES: DocReviewStatus[] = ['approved', 'edited'];

// ------------------------------------------------------------- segments

export type SegmentSourceType =
  | 'input'
  | 'fact'
  | 'assessment'
  | 'hypothesis'
  | 'goal'
  | 'gap'
  | 'client-record';

export interface SegmentSource {
  refType: SegmentSourceType;
  refId: string;
  /** Exact source excerpt when available. */
  excerpt?: string;
  date?: string;
  /** e.g. "Client Report", "PHQ-9", "Approved hypothesis". */
  label?: string;
}

export type SegmentKind = 'factual' | 'interpretive' | 'template' | 'therapist-authored';

export interface DocSegment {
  id: string;
  /** e.g. 'data' | 'assessment' | 'plan' | 'evidenced-by' | 'formulation:strengths' */
  section: string;
  text: string;
  kind: SegmentKind;
  sources: SegmentSource[];
  /** Content included from explicitly-selected PENDING information. */
  fromPendingSource?: boolean;
  riskRelated: boolean;
  /** Clinician confirmation for risk segments; approval is blocked without it. */
  riskAcknowledged?: boolean;
  riskNote?: string;
}

/** "Unsupported draft content": claims with no source that aren't the clinician's own words or a structural heading. */
export function isUnsupportedSegment(segment: DocSegment): boolean {
  return (
    segment.sources.length === 0 &&
    segment.kind !== 'therapist-authored' &&
    segment.kind !== 'template'
  );
}

// ------------------------------------------------------- source selection

export interface SourceSelection {
  inputIds: string[];
  factIds: string[];
  assessmentIds: string[];
  hypothesisIds: string[];
  goalIds: string[];
  includeDiagnoses: boolean;
  includeMedications: boolean;
  /** Client-level risk status; requires riskConfirmed. */
  includeRiskStatus: boolean;
  /** Explicit confirmation covering every selected risk-related item. */
  riskConfirmed: boolean;
  /** Pending facts explicitly chosen by the clinician (warned + labeled). */
  explicitlyIncludedPendingFactIds: string[];
  therapistInstructions?: string;
  style: DapStyle;
}

export const EMPTY_SELECTION: SourceSelection = {
  inputIds: [],
  factIds: [],
  assessmentIds: [],
  hypothesisIds: [],
  goalIds: [],
  includeDiagnoses: true,
  includeMedications: false,
  includeRiskStatus: false,
  riskConfirmed: false,
  explicitlyIncludedPendingFactIds: [],
  style: 'standard',
};

// --------------------------------------------------------------- styles

export type DapStyle =
  | 'brief'
  | 'standard'
  | 'detailed'
  | 'insurance'
  | 'residential'
  | 'substance-use'
  | 'trauma-informed'
  | 'psychodynamic'
  | 'cbt'
  | 'dbt'
  | 'act'
  | 'mi';

export interface DapStyleMeta {
  value: DapStyle;
  label: string;
  /** Fact categories surfaced first in the Data section. */
  emphasis: string[];
  length: 'brief' | 'standard' | 'detailed';
  note: string;
}

export const DAP_STYLES: DapStyleMeta[] = [
  { value: 'brief', label: 'Brief', emphasis: [], length: 'brief', note: 'Shortest form; core content only.' },
  { value: 'standard', label: 'Standard', emphasis: [], length: 'standard', note: 'Balanced default.' },
  { value: 'detailed', label: 'Detailed', emphasis: [], length: 'detailed', note: 'Includes all selected material.' },
  { value: 'insurance', label: 'Insurance-oriented', emphasis: ['functional-impairment', 'treatment-progress', 'treatment-goal'], length: 'standard', note: 'Leads with functioning, goal progress, and medical necessity framing.' },
  { value: 'residential', label: 'Residential treatment', emphasis: ['risk-factor', 'substance-use', 'medication'], length: 'standard', note: 'Emphasizes milieu-relevant stability and safety content.' },
  { value: 'substance-use', label: 'Substance-use treatment', emphasis: ['substance-use', 'craving', 'withdrawal', 'relapse-trigger'], length: 'standard', note: 'Leads with use, cravings, triggers, and recovery supports.' },
  { value: 'trauma-informed', label: 'Trauma-informed', emphasis: ['trauma', 'dissociation', 'protective-factor'], length: 'standard', note: 'Leads with trauma-related content and stabilization resources.' },
  { value: 'psychodynamic', label: 'Psychodynamic', emphasis: ['relationship-pattern', 'defense-adaptation', 'core-belief', 'therapeutic-relationship'], length: 'standard', note: 'Emphasizes relational and intrapsychic material already documented.' },
  { value: 'cbt', label: 'CBT-focused', emphasis: ['cognition', 'core-belief', 'coping-strategy'], length: 'standard', note: 'Emphasizes documented thoughts, beliefs, and skills practice.' },
  { value: 'dbt', label: 'DBT-focused', emphasis: ['emotional-regulation', 'coping-strategy'], length: 'standard', note: 'Emphasizes regulation skills and documented skill use.' },
  { value: 'act', label: 'ACT-focused', emphasis: ['coping-strategy', 'strength', 'treatment-goal'], length: 'standard', note: 'Emphasizes documented values-consistent action and acceptance work.' },
  { value: 'mi', label: 'Motivational Interviewing', emphasis: ['treatment-barrier', 'strength', 'treatment-progress'], length: 'standard', note: 'Emphasizes documented motivation, ambivalence, and change talk.' },
];

// ------------------------------------------------------------ generation

export type GenerationMethod = 'deterministic-template' | 'local-ai' | 'online-ai';

export interface GenerationInfo {
  method: GenerationMethod;
  providerId: string;
  providerLabel: string;
  generatedAt: string;
  /** Honest description shown with every draft. */
  disclosure: string;
  warnings: GenerationWarning[];
}

export interface GenerationWarning {
  kind: 'missing-info' | 'clinician-input-required' | 'risk' | 'pending-source' | 'unsupported';
  message: string;
}

// -------------------------------------------------------------- DAP note

export interface DapNote {
  id: string;
  clientId: string;
  sessionDate: string;
  sessionNumber?: number;
  levelOfCare: string;
  style: DapStyle;
  /** Live, clinician-editable content. */
  segments: DocSegment[];
  /** Frozen generated draft — never modified after creation. */
  originalSegments: DocSegment[];
  sourceSelection: SourceSelection;
  generation: GenerationInfo;
  reviewStatus: DocReviewStatus;
  clinicianComments?: string;
  reviewedBy?: string;
  approvedAt?: string;
  supersededBy?: string;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export const DAP_SECTIONS: Array<{ key: string; label: string }> = [
  { key: 'data', label: 'Data' },
  { key: 'assessment', label: 'Assessment' },
  { key: 'plan', label: 'Plan' },
];

// -------------------------------------------------------- treatment plan

export interface PlanProblem {
  id: string;
  text: string;
  sources: SegmentSource[];
  riskRelated: boolean;
  riskAcknowledged?: boolean;
  riskNote?: string;
  fromPendingSource?: boolean;
}

export interface PlanNeed {
  id: string;
  rank: number;
  need: string;
  rationale: string;
  sources: SegmentSource[];
  riskRelated: boolean;
  riskAcknowledged?: boolean;
  riskNote?: string;
}

export interface TreatmentPlanDoc {
  id: string;
  clientId: string;
  planDate: string;
  reviewDate?: string;
  diagnosesSnapshot: string[];
  problems: PlanProblem[];
  /** evidenced-by + formulation:* segments. */
  segments: DocSegment[];
  hierarchy: PlanNeed[];
  goalIds: string[];
  /** Frozen copy of the linked goals, captured at approval. */
  goalsSnapshot?: TreatmentGoal[];
  goalPlanRationale: string;
  expectedImprovement: string;
  /** Objective skeletons proposed by the generator (never invented numbers). */
  proposedObjectives: ProposedObjective[];
  originalDraft: {
    problems: PlanProblem[];
    segments: DocSegment[];
    hierarchy: PlanNeed[];
    goalPlanRationale: string;
    expectedImprovement: string;
    proposedObjectives: ProposedObjective[];
  };
  sourceSelection: SourceSelection;
  generation: GenerationInfo;
  reviewStatus: DocReviewStatus;
  clinicianComments?: string;
  reviewedBy?: string;
  approvedAt?: string;
  supersededBy?: string;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export const FORMULATION_SECTIONS: Array<{ key: string; label: string }> = [
  { key: 'formulation:current', label: 'Current difficulties' },
  { key: 'formulation:history', label: 'Relevant history' },
  { key: 'formulation:maintaining', label: 'Maintaining factors' },
  { key: 'formulation:protective', label: 'Protective factors' },
  { key: 'formulation:strengths', label: 'Strengths' },
  { key: 'formulation:barriers', label: 'Treatment barriers' },
  { key: 'formulation:needs-assessment', label: 'Areas needing further assessment' },
];

// ------------------------------------------------------ goals & objectives

export type GoalKind = 'short-term' | 'long-term';
export type GoalStatus = 'active' | 'achieved' | 'continued' | 'revised' | 'discontinued';
export type ObjectiveProgress = 'not-started' | 'in-progress' | 'achieved' | 'revised' | 'discontinued';

export const MEASUREMENT_METHODS = [
  'Client self-report in session',
  'Frequency log / diary card',
  'Standardized assessment score',
  'Therapist observation',
  'Collateral report',
  'Attendance / completion record',
  'Other (describe in plan)',
] as const;

export interface TherapistPlan {
  action?: string;
  modality?: string;
  frequency?: string;
  tracking?: string;
}

export interface Objective {
  id: string;
  description: string;
  targetProblem?: string;
  measurementMethod?: string;
  timeFrame?: string;
  baseline?: string;
  target?: string;
  targetDate?: string;
  linkedAssessmentKey?: string;
  linkedProblemText?: string;
  progress: ObjectiveProgress;
  progressNotes: Array<{ at: string; note: string; author: string }>;
  therapistPlan: TherapistPlan;
}

export interface ProposedObjective {
  id: string;
  description: string;
  targetProblem?: string;
  measurementMethod?: string;
  linkedAssessmentKey?: string;
  sources: SegmentSource[];
  /** What the clinician must supply — the generator never invents these. */
  missing: string[];
}

export interface TreatmentGoal {
  id: string;
  clientId: string;
  kind: GoalKind;
  title: string;
  rationale?: string;
  status: GoalStatus;
  order: number;
  objectives: Objective[];
  createdAt: string;
  updatedAt: string;
  version: number;
}

// --------------------------------------------------- completeness rules

/** Missing measurable components — the app flags these instead of inventing them. */
export function objectiveMissingItems(objective: {
  description: string;
  measurementMethod?: string;
  baseline?: string;
  target?: string;
  targetDate?: string;
  timeFrame?: string;
}): string[] {
  const missing: string[] = [];
  if (!objective.measurementMethod?.trim()) missing.push('Measurement method not established');
  if (!objective.baseline?.trim()) missing.push('Baseline not documented');
  if (!objective.target?.trim()) missing.push('Target not set');
  if (!objective.targetDate?.trim() && !objective.timeFrame?.trim()) {
    missing.push('Target date or time frame not selected');
  }
  return missing;
}

const VAGUE_PATTERNS = [
  /\bfeel better\b/i,
  /\bimprove coping\b/i,
  /\bunderstand (their |his |her )?trauma\b/i,
  /\bdo better\b/i,
  /\bbe happier\b/i,
];

export function isVagueObjectiveWording(description: string): boolean {
  return VAGUE_PATTERNS.some((p) => p.test(description));
}
