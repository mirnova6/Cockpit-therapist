/**
 * Phase 4 intelligence schema: living case formulations, safety & trust
 * strategies, intervention recommendation sets, Clinical Update Summaries,
 * and the client-specific assistant thread.
 *
 * Everything is client-scoped, encrypted at rest, versioned, and draft
 * until clinician review — an AI provider can only ever PROPOSE content
 * that lands in these records via application services.
 */
import type { ConfidenceLevel } from '../ai/aiSchema';
import type { SegmentSource } from './documentSchema';
import type { FactCategory, ReviewStatus } from './structuredSchema';
import type { RetrievalDebug } from '../rag/clientRetrieval';

// -------------------------------------------------- generation provenance

export interface IntelligenceGeneration {
  providerType: 'deterministic' | 'local' | 'online';
  providerId: string;
  modelId?: string;
  generatedAt: string;
  /** Honest description of how this content was produced. */
  disclosure: string;
  operationId?: string;
}

// -------------------------------------------------------- formulations

export type FormulationFramework =
  | 'biopsychosocial'
  | 'five-ps'
  | 'developmental'
  | 'trauma-informed'
  | 'attachment-based'
  | 'cognitive-behavioral'
  | 'psychodynamic'
  | 'substance-use'
  | 'family-systems'
  | 'cultural';

export interface FrameworkMeta {
  value: FormulationFramework;
  label: string;
  sections: Array<{ key: string; label: string; categories: FactCategory[] }>;
}

export const FORMULATION_FRAMEWORKS: FrameworkMeta[] = [
  {
    value: 'biopsychosocial',
    label: 'Biopsychosocial',
    sections: [
      { key: 'biological', label: 'Biological factors', categories: ['medical-factor', 'medication', 'sleep', 'appetite', 'energy'] },
      { key: 'psychological', label: 'Psychological factors', categories: ['mood', 'anxiety', 'cognition', 'core-belief', 'core-fear', 'shame-theme', 'emotional-regulation', 'coping-strategy', 'defense-adaptation', 'dissociation'] },
      { key: 'social', label: 'Social factors', categories: ['family-factor', 'relationship-pattern', 'conflict-pattern', 'cultural-factor', 'functional-impairment'] },
    ],
  },
  {
    value: 'five-ps',
    label: 'Five Ps',
    sections: [
      { key: 'presenting', label: 'Presenting', categories: ['presenting-problem', 'symptom', 'mood', 'anxiety'] },
      { key: 'predisposing', label: 'Predisposing', categories: ['developmental-factor', 'trauma', 'family-factor', 'medical-factor'] },
      { key: 'precipitating', label: 'Precipitating', categories: ['relapse-trigger', 'conflict-pattern', 'presenting-problem'] },
      { key: 'perpetuating', label: 'Perpetuating', categories: ['substance-use', 'defense-adaptation', 'relationship-pattern', 'treatment-barrier', 'core-belief'] },
      { key: 'protective', label: 'Protective', categories: ['protective-factor', 'strength', 'coping-strategy'] },
    ],
  },
  {
    value: 'developmental',
    label: 'Developmental',
    sections: [
      { key: 'early', label: 'Early experiences', categories: ['developmental-factor', 'trauma', 'family-factor'] },
      { key: 'adaptations', label: 'Adaptations formed', categories: ['defense-adaptation', 'coping-strategy', 'core-belief', 'emotional-regulation'] },
      { key: 'present-cost', label: 'Present-day cost', categories: ['functional-impairment', 'relationship-pattern', 'symptom', 'treatment-barrier'] },
    ],
  },
  {
    value: 'trauma-informed',
    label: 'Trauma-informed',
    sections: [
      { key: 'trauma-history', label: 'Trauma history', categories: ['trauma', 'developmental-factor'] },
      { key: 'adaptations', label: 'Survival adaptations', categories: ['defense-adaptation', 'dissociation', 'emotional-regulation', 'coping-strategy'] },
      { key: 'current-impact', label: 'Current impact', categories: ['symptom', 'relationship-pattern', 'functional-impairment', 'shame-theme'] },
      { key: 'stabilization', label: 'Stabilization resources', categories: ['protective-factor', 'strength', 'coping-strategy'] },
    ],
  },
  {
    value: 'attachment-based',
    label: 'Attachment-based',
    sections: [
      { key: 'attachment-history', label: 'Attachment history', categories: ['developmental-factor', 'family-factor', 'trauma'] },
      { key: 'relational-patterns', label: 'Relational patterns', categories: ['relationship-pattern', 'conflict-pattern', 'therapeutic-relationship'] },
      { key: 'internal-models', label: 'Internal working models', categories: ['core-belief', 'core-fear', 'shame-theme'] },
    ],
  },
  {
    value: 'cognitive-behavioral',
    label: 'Cognitive-behavioral',
    sections: [
      { key: 'situations', label: 'Situations & triggers', categories: ['relapse-trigger', 'presenting-problem', 'conflict-pattern'] },
      { key: 'cognitions', label: 'Cognitions & core beliefs', categories: ['cognition', 'core-belief', 'core-fear'] },
      { key: 'behaviors', label: 'Behavioral responses', categories: ['coping-strategy', 'defense-adaptation', 'substance-use'] },
      { key: 'maintenance', label: 'Maintenance cycle', categories: ['treatment-barrier', 'emotional-regulation', 'functional-impairment'] },
    ],
  },
  {
    value: 'psychodynamic',
    label: 'Psychodynamic',
    sections: [
      { key: 'conflicts', label: 'Core conflicts & fears', categories: ['core-fear', 'core-belief', 'shame-theme'] },
      { key: 'defenses', label: 'Defenses', categories: ['defense-adaptation', 'dissociation'] },
      { key: 'relational', label: 'Relational enactments', categories: ['relationship-pattern', 'therapeutic-relationship', 'conflict-pattern'] },
      { key: 'origins', label: 'Developmental origins', categories: ['developmental-factor', 'trauma', 'family-factor'] },
    ],
  },
  {
    value: 'substance-use',
    label: 'Substance-use',
    sections: [
      { key: 'use-pattern', label: 'Use pattern', categories: ['substance-use', 'craving', 'withdrawal'] },
      { key: 'function', label: 'Function of use', categories: ['emotional-regulation', 'coping-strategy', 'trauma', 'shame-theme'] },
      { key: 'triggers', label: 'Triggers & maintenance', categories: ['relapse-trigger', 'relationship-pattern', 'treatment-barrier'] },
      { key: 'recovery-capital', label: 'Recovery capital', categories: ['protective-factor', 'strength', 'treatment-progress'] },
    ],
  },
  {
    value: 'family-systems',
    label: 'Family systems',
    sections: [
      { key: 'structure', label: 'Family structure & roles', categories: ['family-factor', 'developmental-factor'] },
      { key: 'patterns', label: 'Interaction patterns', categories: ['relationship-pattern', 'conflict-pattern'] },
      { key: 'impact', label: 'Impact on presenting problems', categories: ['presenting-problem', 'symptom', 'functional-impairment'] },
    ],
  },
  {
    value: 'cultural',
    label: 'Cultural formulation',
    sections: [
      { key: 'identity', label: 'Cultural identity', categories: ['cultural-factor'] },
      { key: 'explanatory', label: 'Cultural explanations of distress', categories: ['cultural-factor', 'core-belief', 'presenting-problem'] },
      { key: 'stressors-supports', label: 'Cultural stressors & supports', categories: ['cultural-factor', 'family-factor', 'protective-factor'] },
      { key: 'clinician-relationship', label: 'Culture & the clinical relationship', categories: ['therapeutic-relationship', 'cultural-factor'] },
    ],
  },
];

export function frameworkMeta(framework: FormulationFramework): FrameworkMeta {
  return FORMULATION_FRAMEWORKS.find((f) => f.value === framework) ?? FORMULATION_FRAMEWORKS[0];
}

export const GUIDING_QUESTION =
  'What happened to this person, how did they adapt to survive it, and what does that adaptation now cost them?';

export interface FormulationSection {
  key: string;
  label: string;
  /** Current formulation text for this area. */
  text: string;
  supportingEvidence: SegmentSource[];
  contradictingEvidence: SegmentSource[];
  alternativeExplanations: string[];
  confidence: ConfidenceLevel;
  /** True when the section rests on hypotheses rather than approved facts. */
  hypothesisBased: boolean;
  lastUpdated: string;
}

export interface CaseFormulation {
  id: string;
  clientId: string;
  framework: FormulationFramework;
  sections: FormulationSection[];
  areasNeedingAssessment: string[];
  reviewStatus: ReviewStatus;
  updateReason: string;
  /** Previous approved formulation this proposal would replace. */
  previousFormulationId?: string;
  generation: IntelligenceGeneration;
  reviewedBy?: string;
  approvedAt?: string;
  clinicianComments?: string;
  createdAt: string;
  updatedAt: string;
  version: number;
}

/** Per-section change row for the Previous → Proposed view (§11). */
export interface FormulationSectionChange {
  key: string;
  label: string;
  changeType: 'added' | 'removed' | 'modified' | 'unchanged';
  previousText?: string;
  proposedText?: string;
  evidenceAdded: SegmentSource[];
  evidenceContradicted: SegmentSource[];
  previousConfidence?: ConfidenceLevel;
  proposedConfidence?: ConfidenceLevel;
}

// ------------------------------------------------- safety/trust strategy

export interface StrategyItem {
  text: string;
  sources: SegmentSource[];
  /** 'fact' items rest on approved facts; 'hypothesis' items are labeled. */
  basis: 'fact' | 'hypothesis';
  confidence: ConfidenceLevel;
}

export interface StrategySection {
  key: string;
  label: string;
  items: StrategyItem[];
}

export const STRATEGY_SECTION_KEYS: Array<{ key: string; label: string }> = [
  { key: 'communication', label: 'Helpful communication style' },
  { key: 'pacing', label: 'Helpful pacing' },
  { key: 'validation', label: 'Validation needs' },
  { key: 'directness', label: 'Level of directness' },
  { key: 'challenge', label: 'Introducing challenge or confrontation' },
  { key: 'unsafe', label: 'What may feel unsafe' },
  { key: 'rupture-triggers', label: 'Likely rupture triggers' },
  { key: 'warning-signs', label: 'Signs of withdrawal, appeasement, testing, or defensiveness' },
  { key: 'autonomy', label: 'Supporting autonomy' },
  { key: 'repair', label: 'Repairing ruptures' },
  { key: 'avoid', label: 'What to avoid saying' },
  { key: 'trust-signs', label: 'Signs that trust is increasing' },
  { key: 'ask-client', label: 'Questions to ask the client directly' },
];

export interface SafetyTrustStrategy {
  id: string;
  clientId: string;
  sections: StrategySection[];
  reviewStatus: ReviewStatus;
  generation: IntelligenceGeneration;
  reviewedBy?: string;
  approvedAt?: string;
  clinicianComments?: string;
  createdAt: string;
  updatedAt: string;
  version: number;
}

// --------------------------------------------------- intervention sets

export type RecommendationTier = 'established' | 'tentative' | 'exploratory';

export const TIER_LABELS: Record<RecommendationTier, string> = {
  established: 'Established (client evidence + approved knowledge support)',
  tentative: 'Tentative (partial support)',
  exploratory: 'Exploratory (limited support — discuss before relying on it)',
};

export interface KnowledgeCitation {
  sourceId: string;
  chunkId: string;
  title: string;
  citation: string;
  section?: string;
  page?: string;
  passage: string;
}

export interface InterventionRecommendation {
  id: string;
  name: string;
  clinicalTarget: string;
  whyItMayFit: string;
  clientEvidence: SegmentSource[];
  knowledgeSupport: KnowledgeCitation[];
  tier: RecommendationTier;
  readinessIndicators: string[];
  cautions: string[];
  whatToAvoid: string[];
  suggestedPacing: string;
  signsOfBenefit: string[];
  signsOfOverwhelm: string[];
  howToMeasure: string[];
  confidence: ConfidenceLevel;
  alternatives: string[];
  /** Set when evidence suggests inadequate stabilization (§14). */
  stabilizationConcern?: string;
}

export interface InterventionSet {
  id: string;
  clientId: string;
  recommendations: InterventionRecommendation[];
  /** Modalities considered but not recommended, with the reason. */
  notRecommended: Array<{ name: string; reason: string }>;
  generation: IntelligenceGeneration;
  reviewStatus: ReviewStatus;
  reviewedBy?: string;
  createdAt: string;
  updatedAt: string;
  version: number;
}

// ---------------------------------------------- clinical update summary

export type UpdateItemKind =
  | 'explicit-information'
  | 'proposed-fact'
  | 'proposed-hypothesis'
  | 'assessment-change'
  | 'risk-mention'
  | 'goal-progress'
  | 'theme'
  | 'contradiction'
  | 'formulation-change'
  | 'treatment-implication'
  | 'next-session-focus'
  | 'intervention-option'
  | 'missing-information';

export type UpdateItemDecision =
  | 'approved'
  | 'edited-approved'
  | 'rejected'
  | 'saved-as-hypothesis'
  | 'needs-further-assessment'
  | 'not-saved';

export interface UpdateSummaryItem {
  id: string;
  kind: UpdateItemKind;
  title: string;
  detail: string;
  /** Exact source excerpts backing this item. */
  sources: SegmentSource[];
  extractionLabel?: string;
  confidence?: ConfidenceLevel;
  riskRelated: boolean;
  requiresIndividualReview: boolean;
  /** Payload for creating the real record on approval. */
  factPayload?: Record<string, unknown>;
  hypothesisPayload?: Record<string, unknown>;
  suggestedQuestion?: string;
  decision?: UpdateItemDecision;
  decidedAt?: string;
  decidedBy?: string;
  clinicianComment?: string;
  /** Id of the record created by the decision, when one was created. */
  resultingRecordId?: string;
}

export interface PipelineStepRecord {
  step: number;
  name: string;
  status: 'done' | 'skipped' | 'failed';
  note?: string;
}

export interface ClinicalUpdateSummary {
  id: string;
  clientId: string;
  sourceInputId: string;
  steps: PipelineStepRecord[];
  items: UpdateSummaryItem[];
  sourcesUsed: SegmentSource[];
  retrievalDebug?: RetrievalDebug;
  overallConfidence: ConfidenceLevel;
  generation: IntelligenceGeneration;
  status: 'pending-review' | 'completed' | 'dismissed';
  createdAt: string;
  updatedAt: string;
  version: number;
}

// ------------------------------------------------------ assistant thread

export interface AssistantCitation {
  ref: string;
  refType: string;
  refId: string;
  label: string;
  date?: string;
  excerpt: string;
  sourceLocation?: string;
  approvalStatus?: string;
}

export interface AssistantAnswerBlock {
  text: string;
  basis: 'fact' | 'hypothesis' | 'general-knowledge' | 'insufficient-evidence';
  citedRefs: string[];
}

export interface AssistantAnswer {
  blocks: AssistantAnswerBlock[];
  clientEvidence: AssistantCitation[];
  knowledgeUsed: KnowledgeCitation[];
  confidence: ConfidenceLevel;
  contradictions: AssistantCitation[];
  followUpQuestions: string[];
  /** Navigation-only suggestions; the assistant has no write authority. */
  suggestedActions: Array<{ label: string; route: string }>;
  insufficientEvidence: boolean;
}

export interface AssistantMessage {
  id: string;
  clientId: string;
  role: 'clinician' | 'assistant';
  text: string;
  answer?: AssistantAnswer;
  retrievalDebug?: RetrievalDebug;
  generation?: IntelligenceGeneration;
  at: string;
}
