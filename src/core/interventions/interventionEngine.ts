/**
 * Intervention recommendation engine (§14).
 *
 * Rule-based core: each modality declares the documented client evidence
 * (fact categories) that indicates it, readiness indicators, cautions, and
 * measurement options. A modality is only recommended when the client's
 * APPROVED record actually contains matching evidence, and its tier is:
 *   established  — client evidence AND approved knowledge support
 *   tentative    — client evidence, no knowledge support retrieved
 *   exploratory  — weak client evidence (surfaced with that label)
 *
 * Knowledge support comes exclusively from the clinician-approved knowledge
 * base — no citation is ever invented, and no proprietary framework appears
 * unless the clinician supplied and approved the source material.
 *
 * Trauma-processing work carries a stabilization check: when trauma
 * evidence exists but documented stabilization resources are missing (or
 * risk is elevated), the concern is surfaced on the recommendation (§14).
 *
 * Recommendations are OPTIONS for the clinician — wording, storage, and UI
 * all treat them as proposals pending review, never directives.
 */
import { computeConfidence } from '../ai/aiSchema';
import type { ClinicalDatabase } from '../db/database';
import type { SegmentSource } from '../db/documentSchema';
import type {
  IntelligenceGeneration,
  InterventionRecommendation,
  InterventionSet,
  KnowledgeCitation,
} from '../db/intelligenceSchema';
import {
  APPROVED_STATUSES,
  factCategoryMeta,
  type ExtractedFact,
  type FactCategory,
} from '../db/structuredSchema';
import { retrieveKnowledge } from '../knowledge/knowledgeRetrieval';
import { newId } from '../db/schema';

export const DETERMINISTIC_INTERVENTIONS_DISCLOSURE =
  'These options were matched deterministically from documented, approved client evidence using fixed clinical indication rules. Knowledge support comes only from your approved knowledge library. No AI model was used.';

interface ModalityRule {
  name: string;
  clinicalTarget: string;
  /** Approved facts in these categories indicate the modality. */
  indications: FactCategory[];
  /** Categories that suggest readiness. */
  readinessCategories: FactCategory[];
  /** Query for the knowledge library. */
  knowledgeQuery: string;
  therapyModel?: string;
  cautions: string[];
  whatToAvoid: string[];
  suggestedPacing: string;
  signsOfBenefit: string[];
  signsOfOverwhelm: string[];
  howToMeasure: string[];
  alternatives: string[];
  /** Trauma-processing work requiring a stabilization check. */
  traumaProcessing?: boolean;
}

const MODALITY_RULES: ModalityRule[] = [
  {
    name: 'Motivational Interviewing',
    clinicalTarget: 'Ambivalence about change, engagement, substance-use decisions',
    indications: ['substance-use', 'craving', 'relapse-trigger', 'treatment-barrier'],
    readinessCategories: ['treatment-goal', 'strength'],
    knowledgeQuery: 'motivational interviewing ambivalence discrepancy change talk',
    therapyModel: 'MI',
    cautions: ['Avoid the righting reflex; arguments for change must come from the client.'],
    whatToAvoid: ['Confrontation about denial', 'Unsolicited advice-giving', 'Premature action planning'],
    suggestedPacing: 'Begin in the next session; follow the client\'s readiness rather than a fixed schedule.',
    signsOfBenefit: ['Increased change talk', 'Client voices discrepancy between values and behavior'],
    signsOfOverwhelm: ['Sustained sustain talk', 'Discord in the working relationship'],
    howToMeasure: ['Frequency of change talk in session', 'AUDIT / DAST-10 trend', 'Attendance record'],
    alternatives: ['CBT for substance use', 'Relapse prevention'],
  },
  {
    name: 'Cognitive Behavioral Therapy (CBT)',
    clinicalTarget: 'Unhelpful thoughts and beliefs maintaining low mood or anxiety',
    indications: ['cognition', 'core-belief', 'mood', 'anxiety'],
    readinessCategories: ['coping-strategy', 'strength'],
    knowledgeQuery: 'cognitive behavioral therapy thought record core belief restructuring',
    therapyModel: 'CBT',
    cautions: ['Cognitive work assumes enough regulation capacity to examine thoughts without flooding.'],
    whatToAvoid: ['Disputing beliefs before the alliance supports it'],
    suggestedPacing: 'Weekly skills focus with between-session practice.',
    signsOfBenefit: ['Client identifies and tests automatic thoughts', 'Symptom measure scores decrease'],
    signsOfOverwhelm: ['Homework consistently undone', 'Sessions feel like intellectual debate'],
    howToMeasure: ['PHQ-9 / GAD-7 trend', 'Thought-record completion'],
    alternatives: ['Behavioral activation', 'ACT'],
  },
  {
    name: 'Dialectical Behavior Therapy (DBT) skills',
    clinicalTarget: 'Emotion dysregulation and crisis-prone coping',
    indications: ['emotional-regulation', 'risk-factor', 'conflict-pattern'],
    readinessCategories: ['coping-strategy', 'treatment-goal'],
    knowledgeQuery: 'dialectical behavior therapy emotion regulation distress tolerance skills',
    therapyModel: 'DBT',
    cautions: ['Skills coaching requires clear crisis protocols the clinician has established.'],
    whatToAvoid: ['Skill teaching mid-crisis without validation first'],
    suggestedPacing: 'One skills module at a time; practice between sessions.',
    signsOfBenefit: ['Client uses a skill during distress and reports it'],
    signsOfOverwhelm: ['Skill practice experienced as invalidation'],
    howToMeasure: ['Diary card / frequency log', 'Incident frequency over time'],
    alternatives: ['Emotion-regulation focused work', 'Somatic grounding'],
  },
  {
    name: 'Acceptance and Commitment Therapy (ACT)',
    clinicalTarget: 'Experiential avoidance and values-behavior gaps',
    indications: ['coping-strategy', 'core-fear', 'treatment-barrier'],
    readinessCategories: ['strength', 'treatment-goal'],
    knowledgeQuery: 'acceptance commitment therapy values experiential avoidance defusion',
    therapyModel: 'ACT',
    cautions: ['Acceptance framing can be misheard as resignation; anchor it to chosen values.'],
    whatToAvoid: ['Using defusion to dismiss real problems'],
    suggestedPacing: 'Introduce values work early; build defusion gradually.',
    signsOfBenefit: ['Client acts on values despite discomfort'],
    signsOfOverwhelm: ['Increased avoidance framed in ACT language'],
    howToMeasure: ['Valued-action frequency log', 'Client self-report in session'],
    alternatives: ['CBT', 'Behavioral activation'],
  },
  {
    name: 'Psychodynamic exploration',
    clinicalTarget: 'Repeating relational patterns and defenses outside awareness',
    indications: ['relationship-pattern', 'defense-adaptation', 'core-fear', 'therapeutic-relationship'],
    readinessCategories: ['therapeutic-relationship', 'strength'],
    knowledgeQuery: 'psychodynamic therapy defense interpretation transference relational pattern',
    therapyModel: 'psychodynamic',
    cautions: ['Interpretation timing matters; premature depth work can raise shame.'],
    whatToAvoid: ['Interpreting defenses before safety is established'],
    suggestedPacing: 'Slow; follow material the client brings.',
    signsOfBenefit: ['Client links present reactions to earlier experiences'],
    signsOfOverwhelm: ['Marked post-session distress or withdrawal'],
    howToMeasure: ['Therapist observation of pattern recognition', 'Session engagement'],
    alternatives: ['Attachment-based work', 'Schema-informed CBT'],
  },
  {
    name: 'Attachment-based work',
    clinicalTarget: 'Attachment insecurity showing up in close relationships and in therapy',
    indications: ['relationship-pattern', 'family-factor', 'developmental-factor', 'therapeutic-relationship'],
    readinessCategories: ['therapeutic-relationship'],
    knowledgeQuery: 'attachment based therapy secure base internal working model rupture repair',
    therapyModel: 'attachment',
    cautions: ['The therapeutic relationship is the instrument; ruptures must be repaired explicitly.'],
    whatToAvoid: ['Labeling the client with an attachment style as if it were a diagnosis'],
    suggestedPacing: 'Consistency and predictability before depth.',
    signsOfBenefit: ['Client tolerates closeness/distance shifts with less distress'],
    signsOfOverwhelm: ['Escalating testing behavior', 'Abrupt disengagement'],
    howToMeasure: ['Therapist observation across sessions', 'Client self-report on relationships'],
    alternatives: ['Psychodynamic exploration', 'Family systems work'],
  },
  {
    name: 'Trauma-informed stabilization',
    clinicalTarget: 'Safety, grounding, and regulation before any trauma processing',
    indications: ['trauma', 'dissociation', 'emotional-regulation'],
    readinessCategories: ['coping-strategy', 'protective-factor'],
    knowledgeQuery: 'trauma stabilization phase grounding safety window of tolerance',
    therapyModel: 'trauma',
    cautions: ['Stabilization comes before processing; monitor dissociation in session.'],
    whatToAvoid: ['Detailed trauma narrative work during stabilization', 'Exposure without consent and readiness'],
    suggestedPacing: 'As long as needed; titrate activation carefully.',
    signsOfBenefit: ['Client grounds during activation', 'Wider tolerance of affect'],
    signsOfOverwhelm: ['Dissociation in session', 'Symptom spike between sessions'],
    howToMeasure: ['PCL-5 trend', 'Client-rated grounding-skill use'],
    alternatives: ['DBT skills', 'Somatic grounding'],
  },
  {
    name: 'EMDR preparation',
    clinicalTarget: 'Readiness building for reprocessing of documented trauma',
    indications: ['trauma'],
    readinessCategories: ['coping-strategy', 'protective-factor', 'emotional-regulation'],
    knowledgeQuery: 'EMDR preparation phase resourcing safe place readiness criteria',
    therapyModel: 'EMDR',
    cautions: ['Reprocessing itself requires specific training and demonstrated client stability.'],
    whatToAvoid: ['Starting reprocessing without stabilization and consent'],
    suggestedPacing: 'Preparation across multiple sessions; do not rush to reprocessing.',
    signsOfBenefit: ['Client can self-soothe using rehearsed resources'],
    signsOfOverwhelm: ['Flooding during resourcing exercises'],
    howToMeasure: ['PCL-5 trend', 'Stability of grounding skills across sessions'],
    alternatives: ['Trauma-informed stabilization', 'Phase-based trauma treatment'],
    traumaProcessing: true,
  },
  {
    name: 'Relapse prevention',
    clinicalTarget: 'Maintaining change and anticipating high-risk situations',
    indications: ['relapse-trigger', 'substance-use', 'craving'],
    readinessCategories: ['treatment-progress', 'protective-factor'],
    knowledgeQuery: 'relapse prevention high risk situations coping plan craving',
    therapyModel: 'relapse-prevention',
    cautions: ['Frame lapses as information, not failure, to avoid the abstinence-violation effect.'],
    whatToAvoid: ['Moralizing language about use'],
    suggestedPacing: 'Build the plan while stable; rehearse before known triggers.',
    signsOfBenefit: ['Client anticipates triggers and applies the plan'],
    signsOfOverwhelm: ['Plan reads as pressure; concealment of use'],
    howToMeasure: ['Use/craving log', 'AUDIT / DAST-10 trend'],
    alternatives: ['Motivational Interviewing', 'Contingency-management referral'],
  },
  {
    name: 'Behavioral activation',
    clinicalTarget: 'Withdrawal and inactivity maintaining low mood',
    indications: ['mood', 'energy', 'functional-impairment'],
    readinessCategories: ['strength', 'treatment-goal'],
    knowledgeQuery: 'behavioral activation activity scheduling avoidance depression',
    therapyModel: 'CBT',
    cautions: ['Start below the client\'s stated capacity to guarantee early wins.'],
    whatToAvoid: ['Overloading the first activity plan'],
    suggestedPacing: 'Small graded steps reviewed every session.',
    signsOfBenefit: ['Completed activities', 'Mood lift after activity documented'],
    signsOfOverwhelm: ['Repeated non-completion with self-criticism'],
    howToMeasure: ['Activity log', 'PHQ-9 trend'],
    alternatives: ['CBT', 'Values work'],
  },
  {
    name: 'Somatic grounding',
    clinicalTarget: 'Body-level activation, panic, and dissociative drift',
    indications: ['dissociation', 'anxiety', 'trauma'],
    readinessCategories: ['coping-strategy'],
    knowledgeQuery: 'somatic grounding techniques orienting body-based regulation',
    cautions: ['Body-focused attention can itself trigger trauma responses; offer choice and titration.'],
    whatToAvoid: ['Forced eye closure or stillness for activated clients'],
    suggestedPacing: 'Brief practices in session first, then between sessions.',
    signsOfBenefit: ['Faster return to baseline after activation'],
    signsOfOverwhelm: ['Increased dissociation during exercises'],
    howToMeasure: ['Client-rated distress before/after practice', 'Therapist observation'],
    alternatives: ['DBT distress tolerance', 'Trauma-informed stabilization'],
  },
  {
    name: 'Emotion-regulation skills',
    clinicalTarget: 'Identifying, tolerating, and modulating strong emotion',
    indications: ['emotional-regulation', 'mood', 'anxiety'],
    readinessCategories: ['coping-strategy', 'strength'],
    knowledgeQuery: 'emotion regulation skills labeling tolerance modulation',
    cautions: ['Skills work should validate the emotion before changing it.'],
    whatToAvoid: ['Framing emotions as problems to eliminate'],
    suggestedPacing: 'One skill at a time with in-session rehearsal.',
    signsOfBenefit: ['Client names emotions with more differentiation'],
    signsOfOverwhelm: ['Skills used to suppress rather than process'],
    howToMeasure: ['Client self-report in session', 'Frequency log'],
    alternatives: ['DBT skills', 'ACT'],
  },
  {
    name: 'Shame-focused interventions',
    clinicalTarget: 'Shame patterns driving concealment, avoidance, or self-attack',
    indications: ['shame-theme', 'core-belief', 'core-fear'],
    readinessCategories: ['therapeutic-relationship', 'strength'],
    knowledgeQuery: 'shame compassion focused therapy self-criticism concealment',
    cautions: ['Shame work is exposure-like; the relationship must feel safe first.'],
    whatToAvoid: ['Reassurance that bypasses the shame experience', 'Public-feeling exercises early on'],
    suggestedPacing: 'Slow, titrated, and explicitly permission-based.',
    signsOfBenefit: ['Client discloses previously hidden material', 'Softer self-talk'],
    signsOfOverwhelm: ['Withdrawal after disclosure', 'Increased self-attack'],
    howToMeasure: ['Therapist observation', 'Client self-report on self-criticism'],
    alternatives: ['Compassion-focused work', 'Psychodynamic exploration'],
  },
  {
    name: 'Grief work',
    clinicalTarget: 'Documented loss and its ongoing impact',
    indications: ['trauma', 'family-factor', 'mood'],
    readinessCategories: ['protective-factor', 'strength'],
    knowledgeQuery: 'grief therapy loss mourning meaning continuing bonds',
    cautions: ['Grief is not pathology; pace to the client\'s process.'],
    whatToAvoid: ['Stage models presented as required sequence'],
    suggestedPacing: 'Follow the client; revisit anniversaries deliberately.',
    signsOfBenefit: ['Client speaks of the loss with less avoidance'],
    signsOfOverwhelm: ['Functional decline after sessions'],
    howToMeasure: ['Client self-report', 'PHQ-9 trend'],
    alternatives: ['Meaning-centered work', 'Supportive therapy'],
  },
  {
    name: 'Family systems work',
    clinicalTarget: 'Family patterns maintaining the presenting problems',
    indications: ['family-factor', 'conflict-pattern', 'relationship-pattern'],
    readinessCategories: ['strength'],
    knowledgeQuery: 'family systems therapy roles boundaries triangulation',
    therapyModel: 'family-systems',
    cautions: ['Individual-session systems work changes one node; set expectations accordingly.'],
    whatToAvoid: ['Blaming individual family members'],
    suggestedPacing: 'Map the system before intervening in it.',
    signsOfBenefit: ['Client describes patterns instead of villains'],
    signsOfOverwhelm: ['Escalated family conflict without support'],
    howToMeasure: ['Client-reported family interactions', 'Therapist observation'],
    alternatives: ['Boundary work', 'Interpersonal effectiveness'],
  },
  {
    name: 'Boundary work',
    clinicalTarget: 'Difficulty setting or holding interpersonal limits',
    indications: ['relationship-pattern', 'conflict-pattern', 'defense-adaptation'],
    readinessCategories: ['strength', 'treatment-goal'],
    knowledgeQuery: 'boundary setting assertiveness interpersonal limits',
    cautions: ['New boundaries can destabilize relationships; prepare for pushback.'],
    whatToAvoid: ['Scripted confrontations the client has not chosen'],
    suggestedPacing: 'Rehearse low-stakes boundaries first.',
    signsOfBenefit: ['Client reports a held boundary'],
    signsOfOverwhelm: ['Guilt spirals after boundary setting'],
    howToMeasure: ['Frequency log', 'Client self-report'],
    alternatives: ['Interpersonal effectiveness', 'Assertiveness training'],
  },
  {
    name: 'Values work',
    clinicalTarget: 'Direction and motivation grounded in what matters to the client',
    indications: ['treatment-goal', 'strength', 'treatment-barrier'],
    readinessCategories: ['strength'],
    knowledgeQuery: 'values clarification committed action meaning',
    therapyModel: 'ACT',
    cautions: ['Values are chosen, not prescribed.'],
    whatToAvoid: ['Imposing culturally-assumed values'],
    suggestedPacing: 'Early and revisited throughout treatment.',
    signsOfBenefit: ['Goals reframed in the client\'s own value language'],
    signsOfOverwhelm: ['Values talk triggering shame about the past'],
    howToMeasure: ['Valued-action log', 'Goal progress'],
    alternatives: ['ACT', 'Motivational Interviewing'],
  },
  {
    name: 'Interpersonal effectiveness skills',
    clinicalTarget: 'Asking, refusing, and negotiating in relationships',
    indications: ['relationship-pattern', 'conflict-pattern', 'functional-impairment'],
    readinessCategories: ['coping-strategy', 'strength'],
    knowledgeQuery: 'interpersonal effectiveness DEAR MAN assertiveness skills',
    therapyModel: 'DBT',
    cautions: ['Skills must fit the client\'s cultural context for directness.'],
    whatToAvoid: ['One-size scripts across relationships with different power dynamics'],
    suggestedPacing: 'Teach, rehearse in session, then apply.',
    signsOfBenefit: ['Successful skill use reported'],
    signsOfOverwhelm: ['Skill attempts followed by relational blowups'],
    howToMeasure: ['Frequency log', 'Client self-report'],
    alternatives: ['Boundary work', 'Family systems work'],
  },
  {
    name: 'Safety planning',
    clinicalTarget: 'Concrete plan for periods of elevated risk',
    indications: ['risk-factor'],
    readinessCategories: ['protective-factor'],
    knowledgeQuery: 'safety planning intervention warning signs coping contacts lethal means',
    cautions: [
      'Safety planning supports — never replaces — the clinician\'s own risk assessment and disposition.',
    ],
    whatToAvoid: ['No-suicide contracts', 'Treating a completed plan as a completed risk assessment'],
    suggestedPacing: 'At the first indication of risk; review at every risk change.',
    signsOfBenefit: ['Client can state their warning signs and first steps'],
    signsOfOverwhelm: ['Plan completed pro forma without engagement'],
    howToMeasure: ['Plan reviewed and updated dates', 'C-SSRS screener trend'],
    alternatives: ['Crisis-resource linkage', 'Higher level of care evaluation'],
  },
  {
    name: 'Psychoeducation',
    clinicalTarget: 'Understanding of symptoms, diagnoses, and treatment rationale',
    indications: ['presenting-problem', 'symptom', 'diagnosis'],
    readinessCategories: ['strength'],
    knowledgeQuery: 'psychoeducation symptom explanation treatment rationale',
    cautions: ['Check understanding; information alone rarely changes behavior.'],
    whatToAvoid: ['Jargon-heavy explanation', 'Information as a substitute for processing'],
    suggestedPacing: 'Brief segments woven into sessions.',
    signsOfBenefit: ['Client explains their pattern in their own words'],
    signsOfOverwhelm: ['Intellectualizing that avoids feeling'],
    howToMeasure: ['Client teach-back in session'],
    alternatives: ['Bibliotherapy with approved materials'],
  },
];

function quarterOf(date: string): string {
  const [year, month] = date.split('-').map(Number);
  if (!year || !month) return 'undated';
  return `${year}-Q${Math.ceil(month / 3)}`;
}

const STABILIZATION_CATEGORIES: FactCategory[] = ['coping-strategy', 'protective-factor', 'strength'];

export async function generateInterventionSet(
  db: ClinicalDatabase,
  clientId: string,
  author: string,
  generation: IntelligenceGeneration,
): Promise<InterventionSet> {
  const client = await db.getClient(clientId);
  if (!client) throw new Error('Client not found');
  const facts = (await db.structured.listFacts(clientId)).filter(
    (f) => APPROVED_STATUSES.includes(f.reviewStatus) && f.clientId === clientId,
  );

  const factsByCategory = new Map<FactCategory, ExtractedFact[]>();
  for (const fact of facts) {
    const list = factsByCategory.get(fact.category) ?? [];
    list.push(fact);
    factsByCategory.set(fact.category, list);
  }

  const stabilizationEvidence = STABILIZATION_CATEGORIES.flatMap((c) => factsByCategory.get(c) ?? []);
  const elevatedRisk = client.risk.level === 'high' || client.risk.level === 'acute';

  const recommendations: InterventionRecommendation[] = [];
  const notRecommended: Array<{ name: string; reason: string }> = [];

  for (const rule of MODALITY_RULES) {
    const matched = rule.indications.flatMap((c) => factsByCategory.get(c) ?? []);
    if (matched.length === 0) {
      notRecommended.push({
        name: rule.name,
        reason: 'No approved client evidence in the indicating categories.',
      });
      continue;
    }

    const clientEvidence: SegmentSource[] = matched.slice(0, 6).map((f) => ({
      refType: 'fact',
      refId: f.id,
      excerpt: f.excerpt ?? f.statement,
      date: f.dateOccurred ?? f.dateRecorded,
      label: factCategoryMeta(f.category).label,
    }));

    const knowledgePassages = await retrieveKnowledge(
      db.knowledge,
      'intervention-recommendations',
      rule.knowledgeQuery,
      { therapyModel: rule.therapyModel, limit: 3 },
    );
    const knowledgeSupport: KnowledgeCitation[] = knowledgePassages.map((p) => ({
      sourceId: p.sourceId,
      chunkId: p.chunkId,
      title: p.title,
      citation: p.citation,
      section: p.section,
      page: p.page,
      passage: p.text,
    }));

    const readiness = rule.readinessCategories
      .flatMap((c) => factsByCategory.get(c) ?? [])
      .map((f) => f.statement);

    const confidence = computeConfidence({
      supportingSources: matched.length,
      approvedSources: matched.length,
      distinctTimePeriods: new Set(matched.map((f) => quarterOf(f.dateOccurred ?? f.dateRecorded))).size,
      contradictingSources: 0,
      explicit: true,
    });

    const tier =
      knowledgeSupport.length > 0 && matched.length >= 2
        ? 'established'
        : matched.length >= 2
          ? 'tentative'
          : 'exploratory';

    let stabilizationConcern: string | undefined;
    const cautions = [...rule.cautions];
    if (rule.traumaProcessing && (stabilizationEvidence.length === 0 || elevatedRisk)) {
      stabilizationConcern = elevatedRisk
        ? 'Current risk status is elevated. Trauma processing is generally contraindicated until risk and stabilization are addressed — clinician judgment required before proceeding.'
        : 'No approved evidence of stabilization resources (coping strategies, protective factors, or strengths) is documented. Available evidence may be insufficient to support trauma processing; assess and document stabilization first.';
      cautions.unshift(stabilizationConcern);
    }

    recommendations.push({
      id: newId(),
      name: rule.name,
      clinicalTarget: rule.clinicalTarget,
      whyItMayFit: `Documented, approved evidence in ${[...new Set(matched.map((f) => factCategoryMeta(f.category).label))].join(', ')} suggests this option may fit. Presented for clinician review — not a directive.`,
      clientEvidence,
      knowledgeSupport,
      tier,
      readinessIndicators: readiness.length > 0 ? readiness.slice(0, 4) : ['No documented readiness indicators yet.'],
      cautions,
      whatToAvoid: rule.whatToAvoid,
      suggestedPacing: rule.suggestedPacing,
      signsOfBenefit: rule.signsOfBenefit,
      signsOfOverwhelm: rule.signsOfOverwhelm,
      howToMeasure: rule.howToMeasure,
      confidence,
      alternatives: rule.alternatives,
      stabilizationConcern,
    });
  }

  recommendations.sort((a, b) => {
    const tierOrder = { established: 0, tentative: 1, exploratory: 2 } as const;
    return tierOrder[a.tier] - tierOrder[b.tier] || b.clientEvidence.length - a.clientEvidence.length;
  });

  return db.intelligence.createInterventionSet(
    { clientId, recommendations, notRecommended, generation },
    author,
  );
}
