/**
 * Extraction provider interface — the seam where a local or cloud AI
 * extraction model plugs in later (Phase 4) without changing the database
 * schema or the review workflow.
 *
 * A provider turns a raw clinical input into PROPOSALS only. Nothing a
 * provider returns is ever written to the record until the clinician
 * explicitly approves it through the review workflow. Input text is data,
 * never instructions: providers must be pure functions of their input.
 */
import type { ClinicalInput } from '../db/schema';
import type {
  ExtractionConfidence,
  FactCategory,
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

export type ProposedItem = ProposedFact | ProposedAssessmentScore;

export interface ExtractionResult {
  providerId: string;
  providerLabel: string;
  /** Honest description of what this provider can and cannot detect. */
  capabilityNote: string;
  items: ProposedItem[];
}

export interface ExtractionProvider {
  readonly id: string;
  readonly label: string;
  readonly capabilityNote: string;
  extract(input: ClinicalInput): ExtractionResult;
}
