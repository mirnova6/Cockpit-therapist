/**
 * Deterministic Template Generator.
 *
 * Assembles document drafts ONLY from the selected, validated sources.
 * Every content sentence is a segment carrying its evidence references.
 * It performs no semantic inference: no invented observations (no mental-
 * status boilerplate), no diagnoses from screening scores, no fabricated
 * baselines/targets/dates, and no advanced formulation reasoning — those
 * gaps become explicit warnings for the clinician instead.
 */
import { NOT_CONFIGURED_TEXT, scoreChange } from '../assessments/definitions';
import type {
  DapStyle,
  DocSegment,
  GenerationInfo,
  GenerationWarning,
  PlanNeed,
  PlanProblem,
  ProposedObjective,
  SegmentSource,
} from '../db/documentSchema';
import { DAP_STYLES } from '../db/documentSchema';
import { inputTypeLabel, newId, nowIso, riskLabel } from '../db/schema';
import { classificationLabel, factCategoryMeta } from '../db/structuredSchema';
import type {
  DapGenerationResult,
  GenerationContext,
  PlanGenerationResult,
  SyncDocumentGenerationProvider,
} from './generationTypes';
import { warning } from './generationTypes';

export const TEMPLATE_DISCLOSURE =
  'This draft was assembled from approved client information using deterministic templates. ' +
  'Advanced AI generation is not connected yet.';

type CtxFact = GenerationContext['facts'][number];

function factSource(fact: CtxFact): SegmentSource {
  return {
    refType: 'fact',
    refId: fact.id,
    excerpt: fact.excerpt,
    date: fact.dateOccurred ?? fact.dateRecorded,
    label: classificationLabel(fact.classification) + (fact.pendingIncluded ? ' — PENDING, explicitly included' : ''),
  };
}

function seg(
  section: string,
  text: string,
  kind: DocSegment['kind'],
  sources: SegmentSource[],
  extra: Partial<DocSegment> = {},
): DocSegment {
  return { id: newId(), section, text, kind, sources, riskRelated: false, ...extra };
}

function styleMeta(style: DapStyle) {
  return DAP_STYLES.find((s) => s.value === style) ?? DAP_STYLES[1];
}

/** Order facts so style-emphasized categories come first (facts unchanged). */
function orderByEmphasis<T extends { category: string }>(facts: T[], emphasis: string[]): T[] {
  if (emphasis.length === 0) return facts;
  return [...facts].sort(
    (a, b) =>
      (emphasis.includes(a.category) ? 0 : 1) - (emphasis.includes(b.category) ? 0 : 1),
  );
}

function pendingLabel(fact: CtxFact): string {
  return fact.pendingIncluded ? ' [PENDING — not yet clinician-approved]' : '';
}

// ================================================================= DAP

function generateDap(context: GenerationContext): DapGenerationResult {
  const { selection } = context;
  const style = styleMeta(selection.style);
  const warnings: GenerationWarning[] = [];
  const segments: DocSegment[] = [];
  const brief = style.length === 'brief';
  const detailed = style.length === 'detailed';

  // ------------------------------------------------------------- DATA
  const facts = orderByEmphasis(context.facts, style.emphasis);
  const clientReported = facts.filter((f) => f.classification === 'client-report');
  const observed = facts.filter((f) => f.classification === 'therapist-observation');
  const otherFacts = facts.filter(
    (f) => f.classification !== 'client-report' && f.classification !== 'therapist-observation',
  );

  for (const input of context.inputs) {
    const text = input.rawText.trim();
    if (!text) continue;
    const summaryLimit = brief ? 220 : detailed ? 900 : 450;
    segments.push(
      seg(
        'data',
        `${inputTypeLabel(input.inputType)} (${input.dateOfInformation}): ${text.replace(/\s+/g, ' ').slice(0, summaryLimit)}${text.length > summaryLimit ? '…' : ''}`,
        'factual',
        [{ refType: 'input', refId: input.id, date: input.dateOfInformation, label: inputTypeLabel(input.inputType), excerpt: text.slice(0, 300) }],
        { riskRelated: input.containsRisk },
      ),
    );
  }

  const factLimit = brief ? 4 : detailed ? Infinity : 8;
  clientReported.slice(0, factLimit).forEach((fact) => {
    segments.push(
      seg('data', `Client-reported: ${fact.statement}${pendingLabel(fact)}`, 'factual', [factSource(fact)], {
        riskRelated: fact.riskRelated,
        fromPendingSource: fact.pendingIncluded,
      }),
    );
  });
  observed.slice(0, factLimit).forEach((fact) => {
    segments.push(
      seg('data', `Therapist-observed: ${fact.statement}${pendingLabel(fact)}`, 'factual', [factSource(fact)], {
        riskRelated: fact.riskRelated,
        fromPendingSource: fact.pendingIncluded,
      }),
    );
  });
  otherFacts.slice(0, factLimit).forEach((fact) => {
    segments.push(
      seg(
        'data',
        `${classificationLabel(fact.classification)}: ${fact.statement}${pendingLabel(fact)}`,
        'factual',
        [factSource(fact)],
        { riskRelated: fact.riskRelated, fromPendingSource: fact.pendingIncluded },
      ),
    );
  });

  for (const record of context.assessments) {
    const change = scoreChange(record, context.assessmentHistory);
    const interpretation = record.severityInterpretation ?? NOT_CONFIGURED_TEXT;
    segments.push(
      seg(
        'data',
        `${record.name} administered ${record.dateAdministered}: ` +
          `${record.totalScore !== undefined ? `total ${record.totalScore}. ` : ''}${interpretation}` +
          (change
            ? ` Change from previous (${change.previousScore}): ${change.delta > 0 ? '+' : ''}${change.delta} (${change.direction}).`
            : ''),
        'factual',
        [{ refType: 'assessment', refId: record.id, date: record.dateAdministered, label: record.name }],
        { riskRelated: record.riskFlags.length > 0 },
      ),
    );
  }

  if (segments.filter((s) => s.section === 'data').length === 0) {
    segments.push(
      seg('data', 'Insufficient information: no sources were selected for the Data section.', 'template', []),
    );
    warnings.push(warning('missing-info', 'No sources selected for the Data section.'));
  }
  // Never invent mental-status observations — say so explicitly in detailed mode.
  if (detailed) {
    segments.push(
      seg(
        'data',
        'Mental-status observations (appearance, orientation, speech, affect) are documented only when recorded by the clinician — none were found in the selected sources.',
        'template',
        [],
      ),
    );
  }

  // -------------------------------------------------------- ASSESSMENT
  let hasInterpretation = false;
  for (const record of context.assessments) {
    const change = scoreChange(record, context.assessmentHistory);
    if (change) {
      hasInterpretation = true;
      segments.push(
        seg(
          'assessment',
          `Interpretive (from encoded scoring rules): ${record.name} ${change.direction} by ${Math.abs(change.delta)} point(s) since the prior administration` +
            (change.clinicallyMeaningful !== undefined
              ? change.clinicallyMeaningful
                ? ', a clinically meaningful change per the published threshold.'
                : ', below the published meaningful-change threshold.'
              : '.'),
          'interpretive',
          [{ refType: 'assessment', refId: record.id, date: record.dateAdministered, label: record.name }],
        ),
      );
    }
  }

  const goalSelected = context.goals.filter((g) => g.status === 'active');
  for (const goal of goalSelected) {
    const inProgress = goal.objectives.filter((o) => o.progress === 'in-progress' || o.progress === 'achieved');
    if (inProgress.length > 0) {
      hasInterpretation = true;
      segments.push(
        seg(
          'assessment',
          `Progress toward goal “${goal.title}”: ${inProgress
            .map((o) => `${o.description.slice(0, 90)} — ${o.progress}`)
            .join('; ')}.`,
          'interpretive',
          [{ refType: 'goal', refId: goal.id, label: 'Treatment goal' }],
        ),
      );
    }
  }

  const barrierFacts = context.facts.filter((f) => f.category === 'treatment-barrier');
  for (const fact of barrierFacts.slice(0, brief ? 2 : 5)) {
    hasInterpretation = true;
    segments.push(
      seg('assessment', `Documented barrier: ${fact.statement}${pendingLabel(fact)}`, 'factual', [factSource(fact)], {
        fromPendingSource: fact.pendingIncluded,
      }),
    );
  }

  for (const hypothesis of context.hypotheses) {
    hasInterpretation = true;
    segments.push(
      seg(
        'assessment',
        `Clinical hypothesis (clinician-approved, ${hypothesis.confidence.replace(/-/g, ' ')}): ${hypothesis.statement}`,
        'interpretive',
        [{ refType: 'hypothesis', refId: hypothesis.id, label: 'Approved clinical hypothesis' }],
      ),
    );
  }

  if (context.openGaps.length > 0 && !brief) {
    segments.push(
      seg(
        'assessment',
        `Areas needing further assessment: ${context.openGaps.map((g) => g.topic).join('; ')}.`,
        'factual',
        context.openGaps.map((g) => ({ refType: 'gap' as const, refId: g.id, label: 'Needs further assessment' })),
      ),
    );
  }

  if (!hasInterpretation) {
    segments.push(
      seg(
        'assessment',
        'Insufficient information for clinical interpretation — clinician input required. The deterministic generator does not infer clinical meaning beyond encoded scoring rules.',
        'template',
        [],
      ),
    );
    warnings.push(warning('clinician-input-required', 'Assessment section needs clinician interpretation.'));
  }

  // --------------------------------------------------------------- PLAN
  let hasPlan = false;
  for (const goal of goalSelected) {
    for (const objective of goal.objectives.filter((o) => o.progress !== 'achieved' && o.progress !== 'discontinued')) {
      hasPlan = true;
      segments.push(
        seg(
          'plan',
          `Continue objective: ${objective.description}` +
            (objective.therapistPlan.action ? ` Therapist plan: ${objective.therapistPlan.action}${objective.therapistPlan.modality ? ` (${objective.therapistPlan.modality})` : ''}.` : ''),
          'factual',
          [{ refType: 'goal', refId: goal.id, label: `Goal: ${goal.title}` }],
        ),
      );
    }
  }
  for (const record of context.assessments) {
    hasPlan = true;
    segments.push(
      seg(
        'plan',
        `Assessment follow-up: re-administer ${record.name} per monitoring schedule — clinician to confirm interval.`,
        'template',
        [{ refType: 'assessment', refId: record.id, label: record.name }],
      ),
    );
  }
  if (context.openGaps.length > 0) {
    hasPlan = true;
    segments.push(
      seg(
        'plan',
        `Explore in upcoming sessions: ${context.openGaps
          .map((g) => g.suggestedQuestions[0] ?? g.topic)
          .slice(0, brief ? 2 : 5)
          .join('; ')}.`,
        'factual',
        context.openGaps.map((g) => ({ refType: 'gap' as const, refId: g.id, label: 'Needs further assessment' })),
      ),
    );
  }
  const riskSelected =
    selection.includeRiskStatus ||
    context.facts.some((f) => f.riskRelated) ||
    context.inputs.some((i) => i.containsRisk);
  if (riskSelected && selection.riskConfirmed) {
    hasPlan = true;
    segments.push(
      seg(
        'plan',
        'Safety follow-up: review safety planning consistent with the risk information documented above. Final risk determination and any emergency action remain the clinician’s decision.',
        'template',
        context.selection.includeRiskStatus
          ? [{ refType: 'client-record', refId: context.client.id, label: `Client risk status: ${riskLabel(context.client.risk.level)}` }]
          : [],
        { riskRelated: true },
      ),
    );
  }
  if (!hasPlan) {
    segments.push(
      seg('plan', 'Clinician input required: no goals, assessments, or open items were selected to draft the Plan section from.', 'template', []),
    );
    warnings.push(warning('clinician-input-required', 'Plan section needs clinician input.'));
  }

  if (selection.therapistInstructions?.trim()) {
    segments.push(
      seg('plan', selection.therapistInstructions.trim(), 'therapist-authored', [], {}),
    );
  }

  const pendingCount = context.facts.filter((f) => f.pendingIncluded).length;
  if (pendingCount > 0) {
    warnings.push(
      warning('pending-source', `${pendingCount} explicitly-included PENDING item(s) are labeled inside the draft.`),
    );
  }
  const riskCount = segments.filter((s) => s.riskRelated).length;
  if (riskCount > 0) {
    warnings.push(
      warning('risk', `${riskCount} risk-related segment(s) require individual clinician confirmation before approval.`),
    );
  }

  return {
    segments,
    generation: buildInfo(warnings),
  };
}

// ====================================================== TREATMENT PLAN

const SEVERE_HINTS = ['Severe', 'Moderately severe', 'Zone IV', 'Zone III', 'Substantial'];

function isSevereAssessment(interpretation?: string): boolean {
  return Boolean(interpretation && SEVERE_HINTS.some((h) => interpretation.includes(h)));
}

function generatePlanDoc(context: GenerationContext): PlanGenerationResult {
  const warnings: GenerationWarning[] = [];
  const segments: DocSegment[] = [];
  const problems: PlanProblem[] = [];
  const facts = context.facts;

  const byCat = (categories: string[]): CtxFact[] => facts.filter((f) => categories.includes(f.category));

  // ------------------------------------------------- problem statements
  const presenting = byCat(['presenting-problem']);
  for (const fact of presenting) {
    problems.push({
      id: newId(),
      text: fact.statement,
      sources: [factSource(fact)],
      riskRelated: fact.riskRelated,
      fromPendingSource: fact.pendingIncluded,
    });
  }
  const symptomFacts = byCat(['symptom', 'mood', 'anxiety', 'sleep', 'appetite', 'energy', 'cognition', 'dissociation', 'trauma']);
  if (symptomFacts.length > 0) {
    problems.push({
      id: newId(),
      text: `Documented symptoms affecting daily functioning: ${symptomFacts
        .slice(0, 6)
        .map((f) => factCategoryMeta(f.category).label.toLowerCase())
        .filter((v, i, a) => a.indexOf(v) === i)
        .join(', ')} (see evidence).`,
      sources: symptomFacts.slice(0, 6).map(factSource),
      riskRelated: false,
    });
  }
  const substanceFacts = byCat(['substance-use', 'craving', 'withdrawal', 'relapse-trigger']);
  if (substanceFacts.length > 0) {
    problems.push({
      id: newId(),
      text: 'Documented substance-use-related concerns (see evidence).',
      sources: substanceFacts.slice(0, 6).map(factSource),
      riskRelated: substanceFacts.some((f) => f.riskRelated),
    });
  }
  for (const record of context.assessments) {
    if (record.totalScore !== undefined && record.severityInterpretation) {
      problems.push({
        id: newId(),
        text: `Elevated ${record.name} screening score (${record.totalScore} — ${record.severityInterpretation}). Screening result, not a diagnosis.`,
        sources: [{ refType: 'assessment', refId: record.id, date: record.dateAdministered, label: record.name }],
        riskRelated: record.riskFlags.length > 0,
      });
    }
  }
  const riskFacts = facts.filter((f) => f.riskRelated);
  for (const fact of riskFacts) {
    problems.push({
      id: newId(),
      text: `Risk-related documentation requiring clinician confirmation: ${fact.statement}`,
      sources: [factSource(fact)],
      riskRelated: true,
      fromPendingSource: fact.pendingIncluded,
    });
  }
  if (problems.length === 0) {
    warnings.push(warning('missing-info', 'No problem statements could be drafted from the selected sources.'));
  }

  // ----------------------------------------------------- evidenced by
  const evidenceClauses: Array<{ text: string; sources: SegmentSource[] }> = [];
  if (context.selection.includeDiagnoses && context.client.diagnoses.length > 0) {
    evidenceClauses.push({
      text: `documented diagnoses/impressions of ${context.client.diagnoses.map((d) => d.label).join(', ')}`,
      sources: [{ refType: 'client-record', refId: context.client.id, label: 'Client record — diagnoses' }],
    });
  }
  for (const record of context.assessments) {
    evidenceClauses.push({
      text: `a ${record.name} score of ${record.totalScore ?? '—'} on ${record.dateAdministered}${record.severityInterpretation ? ` (${record.severityInterpretation})` : ''}`,
      sources: [{ refType: 'assessment', refId: record.id, date: record.dateAdministered, label: record.name }],
    });
  }
  const functional = byCat(['functional-impairment']);
  if (functional.length > 0) {
    evidenceClauses.push({
      text: `documented functional impairment (${functional[0].statement.slice(0, 120)})`,
      sources: functional.map(factSource),
    });
  }
  const reported = facts.filter((f) => f.classification === 'client-report').slice(0, 3);
  if (reported.length > 0) {
    evidenceClauses.push({
      text: `client-reported difficulties including ${reported.map((f) => `“${f.statement.slice(0, 80)}”`).join('; ')}`,
      sources: reported.map(factSource),
    });
  }
  if (evidenceClauses.length > 0) {
    segments.push(
      seg(
        'evidenced-by',
        `The need for treatment is evidenced by ${evidenceClauses.map((c) => c.text).join('; ')}.`,
        'factual',
        evidenceClauses.flatMap((c) => c.sources),
      ),
    );
  } else {
    segments.push(
      seg('evidenced-by', 'Insufficient information: select diagnoses, assessments, or approved facts to draft this section.', 'template', []),
    );
    warnings.push(warning('missing-info', 'Evidenced By section has no selected sources.'));
  }

  // ------------------------------------------------------- formulation
  const formulationMap: Array<{ section: string; categories: string[]; label: string }> = [
    { section: 'formulation:current', categories: ['presenting-problem', 'symptom', 'mood', 'anxiety', 'sleep', 'appetite', 'energy', 'cognition', 'dissociation', 'substance-use', 'craving'], label: 'current difficulties' },
    { section: 'formulation:history', categories: ['trauma', 'developmental-factor', 'family-factor'], label: 'relevant history' },
    { section: 'formulation:maintaining', categories: ['treatment-barrier', 'relapse-trigger', 'conflict-pattern'], label: 'maintaining factors' },
    { section: 'formulation:protective', categories: ['protective-factor'], label: 'protective factors' },
    { section: 'formulation:strengths', categories: ['strength'], label: 'strengths' },
    { section: 'formulation:barriers', categories: ['treatment-barrier'], label: 'treatment barriers' },
  ];
  for (const { section, categories } of formulationMap) {
    const sectionFacts = byCat(categories);
    const historical = section === 'formulation:history'
      ? facts.filter((f) => f.temporalStatus === 'historical' && !sectionFacts.includes(f))
      : [];
    const all = [...sectionFacts, ...historical];
    if (all.length === 0) {
      segments.push(seg(section, 'Not yet documented in approved information.', 'template', []));
      continue;
    }
    for (const fact of all.slice(0, 5)) {
      segments.push(
        seg(section, `${fact.statement}${pendingLabel(fact)}`, 'factual', [factSource(fact)], {
          riskRelated: fact.riskRelated,
          fromPendingSource: fact.pendingIncluded,
        }),
      );
    }
  }
  for (const hypothesis of context.hypotheses) {
    segments.push(
      seg(
        'formulation:maintaining',
        `Clinical hypothesis (clinician-approved, ${hypothesis.confidence.replace(/-/g, ' ')}): ${hypothesis.statement}`,
        'interpretive',
        [{ refType: 'hypothesis', refId: hypothesis.id, label: 'Approved clinical hypothesis' }],
      ),
    );
  }
  if (context.openGaps.length > 0) {
    for (const gap of context.openGaps.slice(0, 5)) {
      segments.push(
        seg('formulation:needs-assessment', `${gap.topic}: ${gap.reason}`, 'factual', [
          { refType: 'gap', refId: gap.id, label: `Needs further assessment (${gap.priority} priority)` },
        ]),
      );
    }
  } else {
    segments.push(seg('formulation:needs-assessment', 'No open items recorded.', 'template', []));
  }

  // ---------------------------------------------------------- hierarchy
  const hierarchy: PlanNeed[] = [];
  let rank = 1;
  const push = (need: string, rationale: string, sources: SegmentSource[], riskRelated = false) => {
    hierarchy.push({ id: newId(), rank: rank++, need, rationale, sources, riskRelated });
  };
  if ((context.selection.includeRiskStatus && ['moderate', 'high', 'acute'].includes(context.client.risk.level)) || riskFacts.length > 0) {
    push(
      'Immediate safety',
      context.selection.includeRiskStatus
        ? `Clinician-confirmed risk status: ${riskLabel(context.client.risk.level)}.`
        : 'Risk-related documentation is present (see evidence).',
      [
        ...(context.selection.includeRiskStatus
          ? [{ refType: 'client-record' as const, refId: context.client.id, label: `Risk status: ${riskLabel(context.client.risk.level)}` }]
          : []),
        ...riskFacts.slice(0, 3).map(factSource),
      ],
      true,
    );
  }
  const medical = byCat(['medical-factor', 'withdrawal']);
  if (medical.length > 0) {
    push('Medical or withdrawal concerns', 'Documented medical/withdrawal factors.', medical.slice(0, 3).map(factSource), medical.some((f) => f.category === 'withdrawal'));
  }
  if (substanceFacts.length > 0) {
    push('Substance-use risk', 'Documented substance-use-related content.', substanceFacts.slice(0, 3).map(factSource));
  }
  const severeAssessments = context.assessments.filter((a) => isSevereAssessment(a.severityInterpretation));
  if (severeAssessments.length > 0) {
    push(
      'Severe symptoms',
      `Screening in severe range: ${severeAssessments.map((a) => `${a.name} ${a.totalScore}`).join(', ')} (screening, not diagnosis).`,
      severeAssessments.map((a) => ({ refType: 'assessment' as const, refId: a.id, label: a.name })),
    );
  }
  const regulation = byCat(['emotional-regulation', 'coping-strategy']);
  if (regulation.length > 0) {
    push('Emotional regulation', 'Documented regulation/coping content.', regulation.slice(0, 3).map(factSource));
  }
  if (functional.length > 0) {
    push('Functional recovery', 'Documented functional impairment.', functional.slice(0, 3).map(factSource));
  }
  const relational = byCat(['family-factor', 'relationship-pattern', 'conflict-pattern']);
  if (relational.length > 0) {
    push('Relational difficulties', 'Documented relational content.', relational.slice(0, 3).map(factSource));
  }
  const trauma = byCat(['trauma']);
  if (trauma.length > 0) {
    push('Trauma preparation', 'Trauma history documented; stabilization before processing.', trauma.slice(0, 3).map(factSource));
  }
  if (hierarchy.length === 0) {
    warnings.push(warning('missing-info', 'No documented needs available to rank.'));
  }

  // ------------------------------------------------ goal plan & skeletons
  const goalPlanRationale =
    context.goals.length > 0
      ? `Treatment goals target the documented problems above. Rationale: address ${problems
          .slice(0, 3)
          .map((p) => p.text.split(':')[0].toLowerCase())
          .join('; ')}.`
      : 'Clinician input required: no treatment goals are linked yet. Create goals in the Goals & Objectives editor.';
  if (context.goals.length === 0) {
    warnings.push(warning('clinician-input-required', 'No treatment goals linked. Create goals in the Goals & Objectives editor.'));
  }
  const expectedImprovement =
    context.assessments.length > 0
      ? `Expected areas of change will be tracked via ${[...new Set(context.assessments.map((a) => a.name))].join(', ')} trends and progress toward documented objectives.`
      : 'Clinician input required: select assessments or define measurable objectives to specify expected areas of change.';

  const proposedObjectives: ProposedObjective[] = [];
  for (const record of context.assessments.slice(0, 2)) {
    proposedObjectives.push({
      id: newId(),
      description: `${record.name} score will be reviewed at a clinician-defined interval, with treatment adjusted based on symptom trend and clinical presentation.`,
      targetProblem: `Elevated ${record.name} screening score`,
      measurementMethod: 'Standardized assessment score',
      linkedAssessmentKey: record.definitionKey,
      sources: [{ refType: 'assessment', refId: record.id, label: record.name }],
      missing: ['Review interval not selected', 'Target not set'],
    });
  }
  if (substanceFacts.length > 0) {
    proposedObjectives.push({
      id: newId(),
      description: 'Client will identify personal relapse triggers and alternative coping responses (clinician to set the number and time frame).',
      targetProblem: 'Documented substance-use-related concerns',
      measurementMethod: 'Client self-report in session',
      sources: substanceFacts.slice(0, 2).map(factSource),
      missing: ['Baseline not documented', 'Target not set', 'Target date or time frame not selected'],
    });
  }
  const symptomForSkeleton = symptomFacts[0];
  if (symptomForSkeleton) {
    proposedObjectives.push({
      id: newId(),
      description: `Client will track ${factCategoryMeta(symptomForSkeleton.category).label.toLowerCase()}-related symptoms using a method agreed with the clinician.`,
      targetProblem: 'Documented symptoms',
      sources: [factSource(symptomForSkeleton)],
      missing: ['Measurement method not established', 'Baseline not documented', 'Target not set', 'Target date or time frame not selected'],
    });
  }
  if (regulation.length > 0) {
    proposedObjectives.push({
      id: newId(),
      description: 'Client will practice a selected regulation/grounding strategy at a clinician-defined weekly frequency and report effectiveness in session.',
      targetProblem: 'Emotional regulation',
      measurementMethod: 'Frequency log / diary card',
      sources: regulation.slice(0, 2).map(factSource),
      missing: ['Baseline not documented', 'Target not set', 'Target date or time frame not selected'],
    });
  }
  for (const objective of proposedObjectives) {
    warnings.push(
      warning(
        'clinician-input-required',
        `Proposed objective “${objective.description.slice(0, 60)}…” needs: ${objective.missing.join('; ')}.`,
      ),
    );
  }

  const pendingCount = facts.filter((f) => f.pendingIncluded).length;
  if (pendingCount > 0) {
    warnings.push(warning('pending-source', `${pendingCount} explicitly-included PENDING item(s) are labeled inside the draft.`));
  }
  const riskItems = problems.filter((p) => p.riskRelated).length + hierarchy.filter((h) => h.riskRelated).length + segments.filter((s) => s.riskRelated).length;
  if (riskItems > 0) {
    warnings.push(warning('risk', `${riskItems} risk-related item(s) require individual clinician confirmation before approval.`));
  }

  return {
    problems,
    segments,
    hierarchy,
    goalPlanRationale,
    expectedImprovement,
    proposedObjectives,
    generation: buildInfo(warnings),
  };
}

function buildInfo(warnings: GenerationWarning[]): GenerationInfo {
  return {
    method: 'deterministic-template',
    providerId: templateProvider.id,
    providerLabel: templateProvider.label,
    generatedAt: nowIso(),
    disclosure: TEMPLATE_DISCLOSURE,
    warnings,
  };
}

export const templateProvider: SyncDocumentGenerationProvider = {
  id: 'deterministic-template',
  label: 'Deterministic Template Generator',
  disclosure: TEMPLATE_DISCLOSURE,
  generateDapNote: generateDap,
  generateTreatmentPlan: generatePlanDoc,
};
