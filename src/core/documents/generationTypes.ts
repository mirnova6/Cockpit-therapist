/**
 * DocumentGenerationProvider — the replaceable seam for document drafting.
 *
 * Phase 3 ships one deterministic template provider. Phase 4 registers a
 * Local AI Generator and/or Secure Online AI Generator here; the document
 * database, review workflow, evidence system, and UI do not change because
 * every provider consumes the same assembled context and returns the same
 * segment/evidence structure.
 *
 * Providers are pure functions over their context: client text can never
 * trigger actions. The deterministic template provider is synchronous and
 * fully offline; Phase 4 AI providers are async and run through the
 * aiGateway (consent, isolation, logging, cancellation) before any model
 * call happens.
 */
import type { Client, ClinicalInput } from '../db/schema';
import type {
  DapNote,
  DocSegment,
  GenerationInfo,
  GenerationWarning,
  PlanNeed,
  PlanProblem,
  ProposedObjective,
  SourceSelection,
  TreatmentGoal,
  TreatmentPlanDoc,
} from '../db/documentSchema';
import type {
  AssessmentRecord,
  ClinicalHypothesis,
  ExtractedFact,
  NeedsAssessmentItem,
} from '../db/structuredSchema';

export interface GenerationContext {
  docType: 'dap-note' | 'treatment-plan';
  client: Client;
  sessionDate: string;
  sessionNumber?: number;
  selection: SourceSelection;
  inputs: ClinicalInput[];
  /** Approved facts plus any explicitly-included pending facts (labeled). */
  facts: Array<ExtractedFact & { pendingIncluded?: boolean }>;
  assessments: AssessmentRecord[];
  /** All assessments for the client — used for score-change statements. */
  assessmentHistory: AssessmentRecord[];
  hypotheses: ClinicalHypothesis[];
  goals: TreatmentGoal[];
  openGaps: NeedsAssessmentItem[];
  /** Existing document when regenerating/updating. */
  existingDap?: DapNote;
  existingPlan?: TreatmentPlanDoc;
}

export interface DapGenerationResult {
  segments: DocSegment[];
  generation: GenerationInfo;
}

export interface PlanGenerationResult {
  problems: PlanProblem[];
  segments: DocSegment[];
  hierarchy: PlanNeed[];
  goalPlanRationale: string;
  expectedImprovement: string;
  proposedObjectives: ProposedObjective[];
  generation: GenerationInfo;
}

export interface DocumentGenerationProvider {
  readonly id: string;
  readonly label: string;
  /** Honest disclosure shown with every draft this provider produces. */
  readonly disclosure: string;
  generateDapNote(context: GenerationContext): DapGenerationResult | Promise<DapGenerationResult>;
  generateTreatmentPlan(context: GenerationContext): PlanGenerationResult | Promise<PlanGenerationResult>;
}

/** Deterministic providers stay synchronous; callers may rely on it. */
export interface SyncDocumentGenerationProvider extends DocumentGenerationProvider {
  generateDapNote(context: GenerationContext): DapGenerationResult;
  generateTreatmentPlan(context: GenerationContext): PlanGenerationResult;
}

export function warning(kind: GenerationWarning['kind'], message: string): GenerationWarning {
  return { kind, message };
}
