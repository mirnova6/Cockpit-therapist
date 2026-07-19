/**
 * Safety, trust, and therapeutic-alliance strategy engine (§15).
 *
 * Deterministic: every strategy item is derived from APPROVED facts or
 * approved active hypotheses in the relevant categories, carries its
 * evidence, and is labeled fact-based or hypothesis-based. Sections with
 * no supporting material state that plainly. Attachment-style language is
 * only ever surfaced as a labeled hypothesis, and the output is guidance
 * for building safety — never scripts for manipulation or coercion.
 */
import { computeConfidence } from '../ai/aiSchema';
import type { ClinicalDatabase } from '../db/database';
import type {
  IntelligenceGeneration,
  SafetyTrustStrategy,
  StrategyItem,
  StrategySection,
} from '../db/intelligenceSchema';
import {
  APPROVED_STATUSES,
  factCategoryMeta,
  type FactCategory,
  type HypothesisCategory,
} from '../db/structuredSchema';

export const DETERMINISTIC_STRATEGY_DISCLOSURE =
  'This strategy was assembled deterministically from approved facts and hypotheses in this client\'s record. Items resting on hypotheses are labeled as such. No AI model was used. It is guidance for building safety and trust — use it with your own clinical judgment.';

interface SectionRule {
  key: string;
  label: string;
  factCategories: FactCategory[];
  hypothesisCategories: HypothesisCategory[];
  /** Turns one evidence item into a strategy sentence. */
  advise: (statement: string, basis: 'fact' | 'hypothesis') => string;
  /** Shown when no evidence exists. */
  emptyNote: string;
}

const SECTION_RULES: SectionRule[] = [
  {
    key: 'communication',
    label: 'Helpful communication style',
    factCategories: ['therapeutic-relationship', 'cultural-factor', 'relationship-pattern'],
    hypothesisCategories: ['attachment-pattern', 'relational-pattern'],
    advise: (s, b) =>
      `${b === 'hypothesis' ? 'If this hypothesis holds, ' : ''}match communication to what is documented: ${s}`,
    emptyNote: 'No documented communication-relevant material yet. Ask the client directly what style of communication feels most helpful.',
  },
  {
    key: 'pacing',
    label: 'Helpful pacing',
    factCategories: ['trauma', 'dissociation', 'emotional-regulation'],
    hypothesisCategories: ['trauma-adaptation', 'emotional-regulation-pattern'],
    advise: (s, b) =>
      `${b === 'hypothesis' ? 'Hypothesis-based: ' : ''}pace to capacity given: ${s}. Slow down at signs of activation.`,
    emptyNote: 'No documented pacing indicators. Default to titrated pacing and check in about intensity.',
  },
  {
    key: 'validation',
    label: 'Validation needs',
    factCategories: ['shame-theme', 'core-fear', 'core-belief'],
    hypothesisCategories: ['shame-pattern', 'core-belief', 'core-fear'],
    advise: (s, b) =>
      `${b === 'hypothesis' ? 'Hypothesis-based: ' : ''}validate before problem-solving; relevant material: ${s}`,
    emptyNote: 'No documented validation-specific material. Validate effort and experience before change talk.',
  },
  {
    key: 'directness',
    label: 'Level of directness',
    factCategories: ['conflict-pattern', 'cultural-factor', 'therapeutic-relationship'],
    hypothesisCategories: ['relational-pattern', 'defense-mechanism'],
    advise: (s, b) =>
      `${b === 'hypothesis' ? 'Hypothesis-based: ' : ''}calibrate directness in light of: ${s}`,
    emptyNote: 'No documented directness indicators. Ask the client how direct they want you to be.',
  },
  {
    key: 'challenge',
    label: 'Introducing challenge or confrontation',
    factCategories: ['defense-adaptation', 'shame-theme', 'therapeutic-relationship'],
    hypothesisCategories: ['defense-mechanism', 'shame-pattern'],
    advise: (s, b) =>
      `${b === 'hypothesis' ? 'Hypothesis-based: ' : ''}introduce challenge only with safety established; consider: ${s}`,
    emptyNote: 'No documented material on responses to challenge. Introduce challenge gradually and watch the response.',
  },
  {
    key: 'unsafe',
    label: 'What may feel unsafe',
    factCategories: ['trauma', 'core-fear', 'shame-theme'],
    hypothesisCategories: ['trauma-adaptation', 'core-fear', 'attachment-pattern'],
    advise: (s, b) =>
      `${b === 'hypothesis' ? 'Hypothesis-based: ' : ''}may feel unsafe given: ${s}`,
    emptyNote: 'No documented safety-threat material yet.',
  },
  {
    key: 'rupture-triggers',
    label: 'Likely rupture triggers',
    factCategories: ['conflict-pattern', 'relationship-pattern', 'therapeutic-relationship'],
    hypothesisCategories: ['relational-pattern', 'attachment-pattern', 'shame-pattern'],
    advise: (s, b) =>
      `${b === 'hypothesis' ? 'Hypothesis-based: ' : ''}watch for ruptures around: ${s}`,
    emptyNote: 'No documented rupture patterns yet.',
  },
  {
    key: 'warning-signs',
    label: 'Signs of withdrawal, appeasement, testing, or defensiveness',
    factCategories: ['defense-adaptation', 'therapeutic-relationship', 'emotional-regulation'],
    hypothesisCategories: ['defense-mechanism', 'attachment-pattern', 'emotional-regulation-pattern'],
    advise: (s, b) =>
      `${b === 'hypothesis' ? 'Hypothesis-based: ' : ''}documented pattern to watch for in session: ${s}`,
    emptyNote: 'No documented in-session warning signs yet. Note shifts in engagement as data.',
  },
  {
    key: 'autonomy',
    label: 'Supporting autonomy',
    factCategories: ['strength', 'protective-factor', 'treatment-goal'],
    hypothesisCategories: ['motivation-for-change', 'protective-process'],
    advise: (s, b) =>
      `${b === 'hypothesis' ? 'Hypothesis-based: ' : ''}support autonomy by building on: ${s}`,
    emptyNote: 'No documented autonomy anchors yet. Offer explicit choices about session focus.',
  },
  {
    key: 'repair',
    label: 'Repairing ruptures',
    factCategories: ['therapeutic-relationship', 'relationship-pattern'],
    hypothesisCategories: ['attachment-pattern', 'relational-pattern'],
    advise: (s, b) =>
      `${b === 'hypothesis' ? 'Hypothesis-based: ' : ''}repair explicitly and non-defensively, mindful of: ${s}`,
    emptyNote: 'No documented repair history. Name ruptures directly and take your share of responsibility.',
  },
  {
    key: 'avoid',
    label: 'What to avoid saying',
    factCategories: ['shame-theme', 'core-fear', 'cultural-factor'],
    hypothesisCategories: ['shame-pattern', 'core-fear'],
    advise: (s, b) =>
      `${b === 'hypothesis' ? 'Hypothesis-based: ' : ''}avoid phrasing that could land as confirmation of: ${s}`,
    emptyNote: 'No documented language sensitivities yet.',
  },
  {
    key: 'trust-signs',
    label: 'Signs that trust is increasing',
    factCategories: ['therapeutic-relationship', 'treatment-progress'],
    hypothesisCategories: ['protective-process', 'motivation-for-change'],
    advise: (s, b) =>
      `${b === 'hypothesis' ? 'Hypothesis-based: ' : ''}growth marker to notice: ${s}`,
    emptyNote: 'No documented trust markers yet. Disclosure of new material and tolerance of silence often signal growing trust.',
  },
  {
    key: 'ask-client',
    label: 'Questions to ask the client directly',
    factCategories: [],
    hypothesisCategories: [],
    advise: (s) => s,
    emptyNote: '',
  },
];

const DIRECT_QUESTIONS = [
  'What helps you feel safe enough to talk about hard things here?',
  'When I get something wrong, how would you like me to handle it?',
  'How direct do you want me to be with feedback?',
  'What has made past helping relationships feel unsafe or unhelpful?',
];

export async function generateSafetyTrustStrategy(
  db: ClinicalDatabase,
  clientId: string,
  author: string,
  generation: IntelligenceGeneration,
): Promise<SafetyTrustStrategy> {
  const [facts, hypotheses] = await Promise.all([
    db.structured.listFacts(clientId),
    db.structured.listHypotheses(clientId),
  ]);
  const approvedFacts = facts.filter(
    (f) => APPROVED_STATUSES.includes(f.reviewStatus) && f.clientId === clientId,
  );
  const activeHypotheses = hypotheses.filter(
    (h) =>
      h.lifecycleStatus === 'active' &&
      APPROVED_STATUSES.includes(h.reviewStatus) &&
      h.clientId === clientId,
  );

  const sections: StrategySection[] = SECTION_RULES.map((rule) => {
    if (rule.key === 'ask-client') {
      // Direct questions are template guidance, offered whenever gaps exist.
      const openQuestions = activeHypotheses.flatMap((h) => h.questionsToAssess).slice(0, 4);
      const items: StrategyItem[] = [...DIRECT_QUESTIONS, ...openQuestions].map((q) => ({
        text: q,
        sources: [],
        basis: 'fact',
        confidence: 'insufficient-evidence',
      }));
      return { key: rule.key, label: rule.label, items };
    }

    const matchedFacts = approvedFacts.filter((f) => rule.factCategories.includes(f.category));
    const matchedHypotheses = activeHypotheses.filter((h) =>
      rule.hypothesisCategories.includes(h.category),
    );

    const items: StrategyItem[] = [
      ...matchedFacts.slice(0, 3).map(
        (f): StrategyItem => ({
          text: rule.advise(f.statement, 'fact'),
          sources: [
            {
              refType: 'fact',
              refId: f.id,
              excerpt: f.excerpt ?? f.statement,
              date: f.dateOccurred ?? f.dateRecorded,
              label: factCategoryMeta(f.category).label,
            },
          ],
          basis: 'fact',
          confidence: computeConfidence({
            supportingSources: 1,
            approvedSources: 1,
            distinctTimePeriods: 1,
            contradictingSources: 0,
            explicit: true,
          }),
        }),
      ),
      ...matchedHypotheses.slice(0, 2).map(
        (h): StrategyItem => ({
          text: rule.advise(h.statement, 'hypothesis'),
          sources: [
            {
              refType: 'hypothesis',
              refId: h.id,
              excerpt: h.statement,
              date: h.updatedAt.slice(0, 10),
              label: `Hypothesis (${h.confidence.replace(/-/g, ' ')})`,
            },
          ],
          basis: 'hypothesis',
          confidence: h.confidence,
        }),
      ),
    ];

    if (items.length === 0 && rule.emptyNote) {
      items.push({
        text: rule.emptyNote,
        sources: [],
        basis: 'fact',
        confidence: 'insufficient-evidence',
      });
    }
    return { key: rule.key, label: rule.label, items };
  });

  return db.intelligence.createStrategy({ clientId, sections, generation }, author);
}
