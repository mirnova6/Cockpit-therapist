/**
 * AI extraction provider (§4) — registers through the existing
 * ExtractionProvider seam and produces PROPOSALS for the Phase 2 review
 * workflow. It can never write approved facts: every item flows through
 * the same clinician review as rule-based extraction.
 *
 * Hallucination guards applied to every returned item:
 *  - the cited excerpt must appear VERBATIM in the source text, or the
 *    item is downgraded to 'ambiguous' with a note (facts) / dropped
 *    (assessment scores);
 *  - risk labeling is deterministic-first: the rule-based risk scan runs
 *    over every statement and excerpt, and its positive result can never
 *    be overridden by the model;
 *  - hypotheses arrive as ProposedHypothesis items, which the review UI
 *    can only save as pending hypotheses — never as facts.
 */
import { runAiTask } from '../ai/aiGateway';
import type { AiSettings, ExtractionLabel } from '../ai/aiSchema';
import { INFERENTIAL_LABELS } from '../ai/aiSchema';
import type { ClinicalAIProvider } from '../ai/types';
import type { ClinicalDatabase } from '../db/database';
import type { ClinicalInput } from '../db/schema';
import {
  FACT_CATEGORIES,
  HYPOTHESIS_CATEGORIES,
  SOURCE_CLASSIFICATIONS,
  type ExtractionConfidence,
  type FactCategory,
  type HypothesisCategory,
  type SourceClassification,
} from '../db/structuredSchema';
import { getDefinition } from '../assessments/definitions';
import { matchesRiskLanguage } from './ruleBasedProvider';
import { AI_EXTRACTION_PROVIDER_ID } from './registry';
import type {
  ExtractionProvider,
  ExtractionResult,
  ProposedFact,
  ProposedHypothesis,
  ProposedItem,
} from './types';

const EXTRACTION_LABEL_VALUES: ExtractionLabel[] = [
  'explicitly-stated',
  'strongly-supported',
  'possible-inference',
  'ambiguous',
  'conflicting-information',
  'needs-further-assessment',
];

const LABEL_TO_CONFIDENCE: Record<ExtractionLabel, ExtractionConfidence> = {
  'explicitly-stated': 'high',
  'strongly-supported': 'high',
  'possible-inference': 'moderate',
  'ambiguous': 'low',
  'conflicting-information': 'low',
  'needs-further-assessment': 'low',
};

const INSTRUCTIONS = `Extract structured clinical information from the single client document supplied as evidence.
Return JSON:
{
 "facts":[{"statement":"...","category":"<one of: ${FACT_CATEGORIES.map((c) => c.value).join('|')}>","classification":"<one of: ${SOURCE_CLASSIFICATIONS.map((c) => c.value).join('|')}>","excerpt":"<EXACT verbatim substring of the source>","label":"<one of: ${EXTRACTION_LABEL_VALUES.join('|')}>","explicit":true|false,"temporalStatus":"current"|"historical","riskSensitive":true|false,"dateOccurred":"YYYY-MM-DD or omit","possibleContradiction":"omit unless the document itself conflicts with something","suggestedQuestion":"omit unless clarification is needed"}],
 "assessmentScores":[{"definitionKey":"phq9|gad7|pcl5|audit|dast10","name":"...","totalScore":number,"excerpt":"<exact verbatim substring>"}],
 "hypotheses":[{"statement":"...","category":"<one of: ${HYPOTHESIS_CATEGORIES.map((c) => c.value).join('|')}>","excerpt":"<exact verbatim substring that prompted the hypothesis>","alternativeExplanations":["..."],"questionsToAssess":["..."]}]
}
Rules: a fact must restate only what the document supports — interpretation belongs in hypotheses, never in facts. "explicit" is true only when the document states the fact outright. Excerpts must be copied character-for-character from the source. Do not extract diagnoses that are not documented, do not compute scores that are not written, and do not decide whether risk content reflects actual current risk — mark it riskSensitive and leave judgment to the clinician.`;

interface AiExtractionJson {
  facts?: Array<Record<string, unknown>>;
  assessmentScores?: Array<Record<string, unknown>>;
  hypotheses?: Array<Record<string, unknown>>;
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

const FACT_CATEGORY_SET = new Set(FACT_CATEGORIES.map((c) => c.value));
const CLASSIFICATION_SET = new Set(SOURCE_CLASSIFICATIONS.map((c) => c.value));
const HYPOTHESIS_CATEGORY_SET = new Set(HYPOTHESIS_CATEGORIES.map((c) => c.value));

export interface AiExtractionContext {
  db: ClinicalDatabase;
  settings: AiSettings;
  provider: ClinicalAIProvider;
  /** Set once the clinician confirmed the outbound preview (online only). */
  onlineSendConfirmed?: boolean;
  operationToken?: string;
}

export function createAiExtractionProvider(getContext: () => AiExtractionContext): ExtractionProvider {
  return {
    id: AI_EXTRACTION_PROVIDER_ID,
    label: 'AI Extraction Provider',
    capabilityNote:
      'Proposals are drafted by the configured AI model from this entry only, then filtered by deterministic guards (verbatim-excerpt check, rule-based risk scan). The model can miss content and can mislabel nuance — nothing is saved without your review, and interpretations are only ever offered as hypotheses.',

    async extract(input: ClinicalInput): Promise<ExtractionResult> {
      const { db, settings, provider, onlineSendConfirmed, operationToken } = getContext();
      const { response, operationId } = await runAiTask({
        db,
        settings,
        provider,
        clientId: input.clientId,
        capability: 'extraction',
        instructions: INSTRUCTIONS,
        clientEvidence: [
          {
            ref: 'E1',
            refType: 'input',
            refId: input.id,
            clientId: input.clientId,
            date: input.dateOfInformation,
            label: input.inputType,
            text: input.rawText,
          },
        ],
        knowledgePassages: [],
        expectJson: true,
        sourceInputs: [
          { id: input.id, allowAiAnalysis: input.allowAiAnalysis, localOnly: input.localOnly },
        ],
        onlineSendConfirmed,
        operationToken,
      });

      const parsed = (response.json ?? {}) as AiExtractionJson;
      const items: ProposedItem[] = [];
      const source = input.rawText;

      for (const raw of parsed.facts ?? []) {
        const statement = str(raw.statement);
        let excerpt = str(raw.excerpt);
        if (!statement) continue;
        const category = FACT_CATEGORY_SET.has(raw.category as FactCategory)
          ? (raw.category as FactCategory)
          : 'other';
        const classification = CLASSIFICATION_SET.has(raw.classification as SourceClassification)
          ? (raw.classification as SourceClassification)
          : 'needs-source-clarification';
        let label: ExtractionLabel = EXTRACTION_LABEL_VALUES.includes(raw.label as ExtractionLabel)
          ? (raw.label as ExtractionLabel)
          : 'ambiguous';
        let suggestedQuestion = str(raw.suggestedQuestion);

        // Verbatim-excerpt guard: an excerpt the source does not contain is
        // treated as unverified and the item is downgraded.
        if (!excerpt || !source.includes(excerpt)) {
          label = 'ambiguous';
          suggestedQuestion =
            suggestedQuestion ??
            'The model could not point to an exact source passage — verify against the original entry.';
          excerpt = excerpt && source.includes(excerpt.slice(0, 40)) ? excerpt : (excerpt ?? statement);
        }

        // Deterministic risk scan can only ADD risk sensitivity.
        const riskRelated =
          raw.riskSensitive === true ||
          category === 'risk-factor' ||
          matchesRiskLanguage(statement) ||
          matchesRiskLanguage(excerpt);

        const fact: ProposedFact = {
          kind: 'fact',
          category,
          statement,
          excerpt,
          sourceLocation: source.includes(excerpt)
            ? `character ${source.indexOf(excerpt)}`
            : 'not located in source',
          classification,
          confidence: LABEL_TO_CONFIDENCE[label],
          riskRelated,
          dateOccurred: str(raw.dateOccurred),
          extractionLabel: label,
          explicit: raw.explicit === true && label === 'explicitly-stated',
          temporalStatus: raw.temporalStatus === 'historical' ? 'historical' : 'current',
          possibleContradiction: str(raw.possibleContradiction),
          suggestedQuestion,
        };
        // Inferential labels must never present as explicit statements.
        if (INFERENTIAL_LABELS.includes(label)) fact.explicit = false;
        items.push(fact);
      }

      for (const raw of parsed.assessmentScores ?? []) {
        const definitionKey = str(raw.definitionKey);
        const excerpt = str(raw.excerpt);
        const totalScore = typeof raw.totalScore === 'number' ? raw.totalScore : undefined;
        // Scores must exist verbatim in the source and use a known instrument.
        if (!definitionKey || !excerpt || totalScore === undefined) continue;
        if (!source.includes(excerpt) || !excerpt.includes(String(totalScore))) continue;
        if (!getDefinition(definitionKey)) continue;
        items.push({
          kind: 'assessment-score',
          definitionKey,
          name: str(raw.name) ?? definitionKey.toUpperCase(),
          totalScore,
          excerpt,
          sourceLocation: `character ${source.indexOf(excerpt)}`,
          confidence: 'high',
        });
      }

      for (const raw of parsed.hypotheses ?? []) {
        const statement = str(raw.statement);
        const excerpt = str(raw.excerpt);
        if (!statement || !excerpt || !source.includes(excerpt)) continue;
        const hypothesis: ProposedHypothesis = {
          kind: 'hypothesis',
          category: HYPOTHESIS_CATEGORY_SET.has(raw.category as HypothesisCategory)
            ? (raw.category as HypothesisCategory)
            : 'other',
          statement,
          excerpt,
          sourceLocation: `character ${source.indexOf(excerpt)}`,
          confidence: 'insufficient-evidence',
          alternativeExplanations: Array.isArray(raw.alternativeExplanations)
            ? raw.alternativeExplanations.filter((a): a is string => typeof a === 'string').slice(0, 4)
            : [],
          questionsToAssess: Array.isArray(raw.questionsToAssess)
            ? raw.questionsToAssess.filter((q): q is string => typeof q === 'string').slice(0, 4)
            : [],
        };
        items.push(hypothesis);
      }

      return {
        providerId: AI_EXTRACTION_PROVIDER_ID,
        providerLabel: `AI Extraction (${response.modelId})`,
        capabilityNote: this.capabilityNote,
        items,
        operationId,
      };
    },
  };
}
