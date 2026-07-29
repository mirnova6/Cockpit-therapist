/**
 * Longitudinal case-formulation engine (§10, §11).
 *
 * Deterministic synthesis: each framework section is assembled from
 * APPROVED facts (grouped by the framework's category mapping) plus
 * approved active hypotheses (always labeled as hypotheses), with
 * contradicting evidence attached, qualitative confidence computed from
 * §18 rules, and areas-needing-assessment drawn from open gaps. Nothing is
 * ever fabricated: a section without evidence says so.
 *
 * With a local/online provider configured, the engine can additionally ask
 * the model to draft section PROSE constrained to the same evidence; the
 * deterministic verifier then flags any unsupported sentence. Either way
 * the result is a PROPOSED formulation — the repository keeps it pending
 * until clinician review, and approving supersedes (never overwrites) the
 * prior version.
 */
import { computeConfidence, type ConfidenceLevel } from '../ai/aiSchema';
import type { ClinicalDatabase } from '../db/database';
import type { SegmentSource } from '../db/documentSchema';
import {
  frameworkMeta,
  GUIDING_QUESTION,
  type CaseFormulation,
  type FormulationFramework,
  type FormulationSection,
  type FormulationSectionChange,
  type IntelligenceGeneration,
} from '../db/intelligenceSchema';
import {
  APPROVED_STATUSES,
  factCategoryMeta,
  type ClinicalHypothesis,
  type Contradiction,
  type ExtractedFact,
} from '../db/structuredSchema';
import { tokenize } from '../rag/lexical';

export const DETERMINISTIC_FORMULATION_DISCLOSURE =
  'This formulation was assembled deterministically from approved facts and hypotheses in this client\'s record. No AI model was used. Sections without documented evidence are left empty rather than filled in.';

/** Maps hypothesis categories onto the section KEYS defined per framework. */
const HYPOTHESIS_CATEGORY_TO_SECTION_HINT: Record<string, string[]> = {
  'attachment-pattern': ['relational-patterns', 'attachment-history', 'internal-models', 'relational', 'patterns'],
  'core-belief': ['cognitions', 'internal-models', 'conflicts', 'psychological', 'explanatory'],
  'core-fear': ['conflicts', 'internal-models', 'psychological'],
  'trauma-adaptation': ['adaptations', 'defenses', 'trauma-history'],
  'defense-mechanism': ['defenses', 'adaptations', 'behaviors'],
  'substance-use-function': ['function', 'use-pattern', 'perpetuating'],
  'emotional-regulation-pattern': ['adaptations', 'behaviors', 'psychological'],
  'relational-pattern': ['relational-patterns', 'relational', 'patterns', 'social'],
  'shame-pattern': ['internal-models', 'conflicts', 'current-impact', 'psychological'],
  'maintaining-factor': ['perpetuating', 'maintenance'],
  'motivation-for-change': ['recovery-capital', 'protective'],
  'treatment-barrier': ['perpetuating', 'maintenance'],
  'protective-process': ['protective', 'stabilization', 'recovery-capital'],
};

function factSource(fact: ExtractedFact): SegmentSource {
  return {
    refType: 'fact',
    refId: fact.id,
    excerpt: fact.excerpt ?? fact.statement,
    date: fact.dateOccurred ?? fact.dateRecorded,
    label: `${factCategoryMeta(fact.category).label} · ${fact.reviewStatus}`,
  };
}

function hypothesisSource(hypothesis: ClinicalHypothesis): SegmentSource {
  return {
    refType: 'hypothesis',
    refId: hypothesis.id,
    excerpt: hypothesis.statement,
    date: hypothesis.updatedAt.slice(0, 10),
    label: `Hypothesis (${hypothesis.confidence})`,
  };
}

function quarterOf(date: string): string {
  const [year, month] = date.split('-').map(Number);
  if (!year || !month) return 'undated';
  return `${year}-Q${Math.ceil(month / 3)}`;
}

function overlaps(a: string, b: string): boolean {
  const tokensA = new Set(tokenize(a));
  let hits = 0;
  for (const token of tokenize(b)) if (tokensA.has(token)) hits++;
  return hits >= 2;
}

export interface FormulationBuildResult {
  sections: FormulationSection[];
  areasNeedingAssessment: string[];
}

/** Deterministic section synthesis from approved material only. */
export function buildFormulationSections(
  framework: FormulationFramework,
  facts: ExtractedFact[],
  hypotheses: ClinicalHypothesis[],
  contradictions: Contradiction[],
  openGapTopics: string[],
  now: string,
): FormulationBuildResult {
  const meta = frameworkMeta(framework);
  const approvedFacts = facts.filter((f) => APPROVED_STATUSES.includes(f.reviewStatus));
  const activeHypotheses = hypotheses.filter(
    (h) => h.lifecycleStatus === 'active' && APPROVED_STATUSES.includes(h.reviewStatus),
  );
  const unresolvedContradictions = contradictions.filter((c) => c.resolutionStatus === 'unresolved');

  const sections: FormulationSection[] = meta.sections.map((sectionMeta) => {
    const sectionFacts = approvedFacts.filter((f) => sectionMeta.categories.includes(f.category));
    const sectionHypotheses = activeHypotheses.filter((h) =>
      (HYPOTHESIS_CATEGORY_TO_SECTION_HINT[h.category] ?? []).includes(sectionMeta.key),
    );

    const supportingEvidence = [
      ...sectionFacts.map(factSource),
      ...sectionHypotheses.map(hypothesisSource),
    ];

    // Contradicting evidence: unresolved contradictions whose text overlaps
    // this section's facts.
    const contradictingEvidence: SegmentSource[] = unresolvedContradictions
      .filter((c) =>
        sectionFacts.some((f) => overlaps(`${c.topic} ${c.description}`, `${f.statement} ${f.excerpt ?? ''}`)),
      )
      .map((c) => ({
        refType: 'client-record',
        refId: c.id,
        excerpt: `${c.topic}: ${c.description}`,
        date: c.dateIdentified.slice(0, 10),
        label: 'Unresolved contradiction',
      }));

    const factLines = sectionFacts.map(
      (f) =>
        `${f.statement}${f.temporalStatus === 'historical' ? ' (historical)' : ''} [documented ${f.dateOccurred ?? f.dateRecorded}]`,
    );
    const hypothesisLines = sectionHypotheses.map(
      (h) => `Hypothesis (${h.confidence.replace(/-/g, ' ')}): ${h.statement}`,
    );

    const text =
      factLines.length === 0 && hypothesisLines.length === 0
        ? 'No approved information documented for this area yet.'
        : [...factLines, ...hypothesisLines].join('\n');

    const confidence: ConfidenceLevel = computeConfidence({
      supportingSources: sectionFacts.length + sectionHypotheses.length,
      approvedSources: sectionFacts.length,
      distinctTimePeriods: new Set(sectionFacts.map((f) => quarterOf(f.dateOccurred ?? f.dateRecorded))).size,
      contradictingSources: contradictingEvidence.length,
      explicit: sectionFacts.length > 0,
    });

    return {
      key: sectionMeta.key,
      label: sectionMeta.label,
      text,
      supportingEvidence,
      contradictingEvidence,
      alternativeExplanations: sectionHypotheses.flatMap((h) => h.alternativeExplanations),
      confidence,
      hypothesisBased: sectionFacts.length === 0 && sectionHypotheses.length > 0,
      lastUpdated: now,
    };
  });

  const emptySections = sections.filter((s) => s.supportingEvidence.length === 0).map((s) => s.label);
  const areasNeedingAssessment = [
    ...openGapTopics,
    ...emptySections.map((label) => `${label}: no approved information documented yet`),
  ];

  return { sections, areasNeedingAssessment };
}

/**
 * Builds and stores a PROPOSED formulation for a framework. The guiding
 * question (§10) guides which material is surfaced — it never forces a
 * trauma explanation: trauma-related sections appear only in frameworks
 * that define them and only with documented evidence.
 */
export async function proposeFormulationUpdate(
  db: ClinicalDatabase,
  clientId: string,
  framework: FormulationFramework,
  author: string,
  generation: IntelligenceGeneration,
  updateReason: string,
): Promise<CaseFormulation> {
  const [facts, hypotheses, contradictions, gaps] = await Promise.all([
    db.structured.listFacts(clientId),
    db.structured.listHypotheses(clientId),
    db.structured.listContradictions(clientId),
    db.structured.listGaps(clientId),
  ]);
  const foreign = [...facts, ...hypotheses].filter((r) => r.clientId !== clientId);
  if (foreign.length > 0) throw new Error('Cross-client record detected while building formulation');

  const { sections, areasNeedingAssessment } = buildFormulationSections(
    framework,
    facts,
    hypotheses,
    contradictions,
    gaps.filter((g) => g.status === 'open').map((g) => g.topic),
    new Date().toISOString().slice(0, 10),
  );

  const prior = await db.intelligence.currentApprovedFormulation(clientId, framework);

  return db.intelligence.proposeFormulation(
    {
      clientId,
      framework,
      sections,
      areasNeedingAssessment,
      updateReason,
      previousFormulationId: prior?.id,
      generation,
    },
    author,
  );
}

/** Previous → Proposed diff for the change-tracking view (§11). */
export function diffFormulations(
  previous: CaseFormulation | undefined,
  proposed: CaseFormulation,
): FormulationSectionChange[] {
  const previousByKey = new Map((previous?.sections ?? []).map((s) => [s.key, s]));
  const changes: FormulationSectionChange[] = proposed.sections.map((section) => {
    const before = previousByKey.get(section.key);
    previousByKey.delete(section.key);
    const beforeRefs = new Set((before?.supportingEvidence ?? []).map((s) => `${s.refType}:${s.refId}`));
    const evidenceAdded = section.supportingEvidence.filter(
      (s) => !beforeRefs.has(`${s.refType}:${s.refId}`),
    );
    return {
      key: section.key,
      label: section.label,
      changeType: !before ? 'added' : before.text === section.text ? 'unchanged' : 'modified',
      previousText: before?.text,
      proposedText: section.text,
      evidenceAdded,
      evidenceContradicted: section.contradictingEvidence,
      previousConfidence: before?.confidence,
      proposedConfidence: section.confidence,
    };
  });
  for (const [, removed] of previousByKey) {
    changes.push({
      key: removed.key,
      label: removed.label,
      changeType: 'removed',
      previousText: removed.text,
      evidenceAdded: [],
      evidenceContradicted: [],
      previousConfidence: removed.confidence,
    });
  }
  return changes;
}

export { GUIDING_QUESTION };
