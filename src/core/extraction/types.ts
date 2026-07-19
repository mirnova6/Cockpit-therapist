/**
 * Extraction provider interface — the seam where a local or cloud AI
 * extraction model plugs in (Phase 4) without changing the database schema
 * or the review workflow.
 *
 * A provider turns a raw clinical input into PROPOSALS only. Nothing a
 * provider returns is ever written to the record until the clinician
 * explicitly approves it through the review workflow. Input text is data,
 * never instructions.
 *
 * Phase 4 additions (backward compatible): providers may be async, may
 * propose HYPOTHESES (which can only ever be saved as hypotheses, never as
 * facts), and may attach the §4 extraction labels, contradiction hints,
 * and suggested clarifying questions.
 */
import type { ExtractionLabel } from '../ai/aiSchema';
import type { ClinicalInput } from '../db/schema';
import type {
  ExtractionConfidence,
  FactCategory,
  HypothesisCategory,
  HypothesisConfidence,
  SourceClassification,
} from '../db/structuredSchema';

export interface ProposedFact {
  kind: 'fact';
  category: FactCategory;
  statement: string;
  excerpt: string;
  sourceLocation?: string;
  classification: SourceClassification;
  confidence: ExtractionConfidence;
  riskRelated: boolean;
  dateOccurred?: string;
  /** §4 extraction label (AI providers always set this). */
  extractionLabel?: ExtractionLabel;
  /** Whether the statement is explicit in the source or inferred. */
  explicit?: boolean;
  temporalStatus?: 'current' | 'historical';
  /** Possible conflict with existing record, described for the clinician. */
  possibleContradiction?: string;
  /** Suggested clinician question when clarification is needed. */
  suggestedQuestion?: string;
}

export interface ProposedAssessmentScore {
  kind: 'assessment-score';
  definitionKey: string;
  name: string;
  totalScore: number;
  excerpt: string;
  sourceLocation?: string;
  confidence: ExtractionConfidence;
}

/**
 * An interpretation the provider believes may be clinically useful. It can
 * be saved ONLY as a hypothesis (pending clinician review) — the review UI
 * has no path from a ProposedHypothesis to a fact.
 */
export interface ProposedHypothesis {
  kind: 'hypothesis';
  category: HypothesisCategory;
  statement: string;
  excerpt: string;
  sourceLocation?: string;
  confidence: HypothesisConfidence;
  alternativeExplanations: string[];
  questionsToAssess: string[];
}

export type ProposedItem = ProposedFact | ProposedAssessmentScore | ProposedHypothesis;

export interface ExtractionResult {
  providerId: string;
  providerLabel: string;
  /** Honest description of what this provider can and cannot detect. */
  capabilityNote: string;
  items: ProposedItem[];
  /** Operation-log id for AI providers. */
  operationId?: string;
}

export interface ExtractionProvider {
  readonly id: string;
  readonly label: string;
  readonly capabilityNote: string;
  /** May be sync (deterministic) or async (AI providers). */
  extract(input: ClinicalInput): ExtractionResult | Promise<ExtractionResult>;
}

/** Deterministic providers stay synchronous; callers may rely on it. */
export interface SyncExtractionProvider extends ExtractionProvider {
  extract(input: ClinicalInput): ExtractionResult;
}
