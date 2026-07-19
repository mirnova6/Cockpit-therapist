/**
 * "Analyze and Update" — the structured clinical reasoning pipeline (§8).
 *
 * Runs the 20 steps in order over ONE new clinical input, producing a
 * Clinical Update Summary (§9) whose every item is a PROPOSAL awaiting an
 * individual clinician decision. No step writes to the clinical record;
 * decisions are applied later through the Phase 2/3 repositories so every
 * existing protection (bulk-approval policy, risk gating, evidence
 * validation, versioning) applies unchanged.
 *
 * The pipeline is cancellable between steps and its AI calls (when an AI
 * provider is active) run through the aiGateway with the same operation
 * token, so cancelling or locking aborts them.
 */
import { evaluateConsent } from '../ai/aiGateway';
import {
  computeConfidence,
  type AiSettings,
  type ConfidenceLevel,
} from '../ai/aiSchema';
import { activeAiProvider } from '../ai/providerRegistry';
import { deterministicVerifier, type VerifiableClaim } from '../ai/verification';
import type { ClinicalDatabase } from '../db/database';
import type { SegmentSource } from '../db/documentSchema';
import type {
  ClinicalUpdateSummary,
  IntelligenceGeneration,
  PipelineStepRecord,
  UpdateSummaryItem,
} from '../db/intelligenceSchema';
import { newId, type ClinicalInput } from '../db/schema';
import {
  APPROVED_STATUSES,
  bulkApprovalIneligibilityReason,
  factCategoryMeta,
} from '../db/structuredSchema';
import { createAiExtractionProvider } from '../extraction/aiExtractionProvider';
import { ruleBasedProvider } from '../extraction/ruleBasedProvider';
import type { ProposedFact, ProposedHypothesis } from '../extraction/types';
import { retrieveKnowledge } from '../knowledge/knowledgeRetrieval';
import { retrieveClientEvidence } from '../rag/clientRetrieval';
import { scoreChange } from '../assessments/definitions';
import { inputTypeLabel } from '../db/schema';

export const PIPELINE_STEPS: string[] = [
  'Validate the selected client and permissions',
  'Validate AI-processing consent and mode',
  'Classify the new input',
  'Extract explicit information',
  'Identify possible inferences separately',
  'Retrieve relevant historical client evidence',
  'Retrieve contradictory client evidence',
  'Retrieve approved clinical knowledge',
  'Identify changes over time',
  'Draft proposed facts',
  'Draft proposed hypotheses',
  'Draft formulation updates',
  'Draft treatment implications',
  'Draft risk-sensitive observations',
  'Identify missing information',
  'Create evidence links',
  'Run unsupported-claim verification',
  'Run cross-client isolation verification',
  'Generate a Clinical Update Summary',
  'Require clinician review',
];

export class PipelineCancelledError extends Error {
  constructor() {
    super('Analysis cancelled by the clinician.');
    this.name = 'PipelineCancelledError';
  }
}

export interface PipelineOptions {
  onlineSendConfirmed?: boolean;
  operationToken?: string;
  onProgress?: (step: number, name: string) => void;
  isCancelled?: () => boolean;
}

function inputSource(input: ClinicalInput, excerpt?: string): SegmentSource {
  return {
    refType: 'input',
    refId: input.id,
    excerpt: (excerpt ?? input.rawText).slice(0, 300),
    date: input.dateOfInformation,
    label: inputTypeLabel(input.inputType),
  };
}

export async function runAnalyzePipeline(
  db: ClinicalDatabase,
  settings: AiSettings,
  clientId: string,
  inputId: string,
  author: string,
  options: PipelineOptions = {},
): Promise<ClinicalUpdateSummary> {
  const steps: PipelineStepRecord[] = [];
  let stepIndex = 0;
  const step = (status: 'done' | 'skipped' | 'failed', note?: string) => {
    const name = PIPELINE_STEPS[stepIndex];
    steps.push({ step: stepIndex + 1, name, status, note });
    options.onProgress?.(stepIndex + 1, name);
    stepIndex++;
    if (options.isCancelled?.()) throw new PipelineCancelledError();
  };

  const provider = activeAiProvider(settings);
  const aiMode = provider.providerType !== 'deterministic';

  // 1. Client + permissions.
  const client = await db.getClient(clientId);
  if (!client) throw new Error('Client not found');
  const input = await db.getInput(inputId);
  if (!input) throw new Error('Clinical input not found');
  if (input.clientId !== clientId) {
    await db.audit('security', 'ai.isolation-violation', `pipeline input ${inputId} not in client ${clientId}`);
    throw new Error('Cross-client isolation check failed: the input belongs to another client.');
  }
  step('done', `${client.displayName} · input ${input.dateOfInformation}`);

  // 2. Consent + mode.
  const consent = evaluateConsent(settings, provider, [
    { id: input.id, allowAiAnalysis: input.allowAiAnalysis, localOnly: input.localOnly },
  ]);
  if (aiMode && !consent.ok) {
    step('failed', consent.reason);
    throw new Error(consent.reason ?? 'AI processing consent check failed.');
  }
  step('done', aiMode ? `${provider.providerType} mode, consent ${consent.status}` : 'deterministic mode — nothing leaves the device');

  // 3. Classify.
  const classification = `${inputTypeLabel(input.inputType)} · ${input.reportedBy} · dated ${input.dateOfInformation}${input.containsRisk ? ' · flagged as containing risk information' : ''}`;
  step('done', classification);

  // 4-5. Extraction (explicit vs inference separated by item kind/label).
  const extractionProvider = aiMode
    ? createAiExtractionProvider(() => ({
        db,
        settings,
        provider,
        onlineSendConfirmed: options.onlineSendConfirmed,
        operationToken: options.operationToken,
      }))
    : ruleBasedProvider;
  const extraction = await extractionProvider.extract(input);
  const factItems = extraction.items.filter((i): i is ProposedFact => i.kind === 'fact');
  const explicitFacts = factItems.filter((f) => f.extractionLabel === undefined || f.explicit || f.extractionLabel === 'explicitly-stated');
  step('done', `${explicitFacts.length} explicit item(s) via ${extraction.providerLabel}`);
  const inferredFacts = factItems.filter((f) => !explicitFacts.includes(f));
  const hypothesisItems = extraction.items.filter((i): i is ProposedHypothesis => i.kind === 'hypothesis');
  step(
    aiMode ? 'done' : 'skipped',
    aiMode
      ? `${inferredFacts.length} possible inference(s), ${hypothesisItems.length} hypothesis draft(s)`
      : 'Deterministic mode does not infer — only explicit rule matches are proposed',
  );

  // 6. Historical retrieval.
  const query = `${input.inputType} ${input.rawText.slice(0, 400)}`;
  const retrieval = await retrieveClientEvidence(db, clientId, query, { limit: 10 });
  step('done', `${retrieval.sources.length} source(s) across ${retrieval.debug.timePeriodsCovered.length} time period(s)`);

  // 7. Contradictory evidence.
  const existingFactsAll = await db.structured.listFacts(clientId);
  const approvedExisting = existingFactsAll.filter((f) => APPROVED_STATUSES.includes(f.reviewStatus));
  // Deterministic contradiction scan: same-category approved facts whose
  // polarity conflicts with a new proposal (negation mismatch), plus
  // provider-flagged conflicts, plus retrieved contradiction records.
  const NEG = /\b(no|not|denies|denied|never|without|stopped|quit|abstinent|abstinence|clean|sober)\b/i;
  const detectedContradictions: Array<{ proposal: ProposedFact; existing: (typeof approvedExisting)[number] }> = [];
  for (const proposal of factItems) {
    for (const existing of approvedExisting.filter((f) => f.category === proposal.category)) {
      const polarityDiffers = NEG.test(proposal.statement) !== NEG.test(existing.statement);
      const sharedTopic = proposal.category !== 'other';
      if (polarityDiffers && sharedTopic) detectedContradictions.push({ proposal, existing });
    }
  }
  step('done', `${detectedContradictions.length} possible conflict(s) with the approved record; ${retrieval.contradictions.length} recorded contradiction(s) retrieved`);

  // 8. Approved knowledge.
  const knowledge = await retrieveKnowledge(db.knowledge, 'case-formulation', query, { limit: 3 });
  step(knowledge.length > 0 ? 'done' : 'skipped', knowledge.length > 0 ? `${knowledge.length} approved passage(s)` : 'No approved knowledge matched');

  // 9. Changes over time.
  const assessments = await db.structured.listAssessments(clientId);
  const assessmentChanges: string[] = [];
  const seenKeys = new Set<string>();
  for (const record of [...assessments].reverse()) {
    if (seenKeys.has(record.definitionKey)) continue;
    seenKeys.add(record.definitionKey);
    const change = scoreChange(record, assessments);
    if (change) {
      assessmentChanges.push(
        `${record.name}: ${change.previousScore} → ${record.totalScore} (${change.direction}${change.clinicallyMeaningful ? ', meets the published meaningful-change threshold' : ''})`,
      );
    }
  }
  // Repeated themes: categories present both in the new proposals and the
  // existing approved record.
  const existingCategories = new Set(approvedExisting.map((f) => f.category));
  const repeatedThemes = [...new Set(factItems.filter((f) => existingCategories.has(f.category)).map((f) => f.category))];
  const newThemes = [...new Set(factItems.filter((f) => !existingCategories.has(f.category) && f.category !== 'other').map((f) => f.category))];
  step('done', `${assessmentChanges.length} assessment change(s), ${repeatedThemes.length} repeated theme(s), ${newThemes.length} new theme(s)`);

  // 10-15. Build proposal items.
  const items: UpdateSummaryItem[] = [];
  const factToItem = (fact: ProposedFact, kind: 'explicit-information' | 'proposed-fact'): UpdateSummaryItem => {
    const individualReason = bulkApprovalIneligibilityReason({
      category: fact.category,
      riskRelated: fact.riskRelated,
      reviewStatus: 'pending',
    });
    return {
      id: newId(),
      kind,
      title: fact.statement,
      detail: `${factCategoryMeta(fact.category).label} · ${fact.extractionLabel ? fact.extractionLabel.replace(/-/g, ' ') : 'rule-based match'}${fact.possibleContradiction ? ` · possible contradiction: ${fact.possibleContradiction}` : ''}`,
      sources: [inputSource(input, fact.excerpt)],
      extractionLabel: fact.extractionLabel,
      confidence: fact.confidence === 'high' ? 'strong-support' : fact.confidence === 'moderate' ? 'moderate-support' : 'low-support',
      riskRelated: fact.riskRelated,
      requiresIndividualReview: individualReason !== null,
      factPayload: {
        category: fact.category,
        statement: fact.statement,
        excerpt: fact.excerpt,
        sourceLocation: fact.sourceLocation,
        classification: fact.classification,
        confidence: fact.confidence,
        riskRelated: fact.riskRelated,
        dateOccurred: fact.dateOccurred,
        temporalStatus: fact.temporalStatus ?? 'current',
      },
      suggestedQuestion: fact.suggestedQuestion,
    };
  };

  for (const fact of explicitFacts) items.push(factToItem(fact, 'explicit-information'));
  for (const fact of inferredFacts) items.push(factToItem(fact, 'proposed-fact'));
  step('done', `${explicitFacts.length + inferredFacts.length} proposed fact(s)`);

  for (const hypothesis of hypothesisItems) {
    items.push({
      id: newId(),
      kind: 'proposed-hypothesis',
      title: hypothesis.statement,
      detail: `Hypothesis (${hypothesis.category}) — interpretation, not fact. It can only be saved as a pending hypothesis.`,
      sources: [inputSource(input, hypothesis.excerpt)],
      confidence: 'insufficient-evidence',
      riskRelated: false,
      requiresIndividualReview: true,
      hypothesisPayload: {
        category: hypothesis.category,
        statement: hypothesis.statement,
        alternativeExplanations: hypothesis.alternativeExplanations,
        questionsToAssess: hypothesis.questionsToAssess,
        excerpt: hypothesis.excerpt,
      },
    });
  }
  step(hypothesisItems.length > 0 ? 'done' : 'skipped', `${hypothesisItems.length} hypothesis draft(s)`);

  // 12. Formulation implications (pointer item — actual proposals are
  // created from the Formulation tab where previous → proposed is shown).
  const affectedFrameworkHint = [...repeatedThemes, ...newThemes].slice(0, 3).map((c) => factCategoryMeta(c).label);
  if (affectedFrameworkHint.length > 0) {
    items.push({
      id: newId(),
      kind: 'formulation-change',
      title: 'New material may affect the case formulation',
      detail: `Content in ${affectedFrameworkHint.join(', ')} may change formulation sections. Open Case Formulation to generate a proposed update — the current approved formulation is never changed silently.`,
      sources: [inputSource(input)],
      riskRelated: false,
      requiresIndividualReview: false,
    });
    step('done', `formulation review suggested (${affectedFrameworkHint.join(', ')})`);
  } else {
    step('skipped', 'No formulation-relevant categories detected');
  }

  // 13. Treatment implications.
  const goals = await db.documents.listGoals(clientId);
  const goalRelevant = factItems.filter((f) => ['treatment-progress', 'treatment-barrier', 'treatment-goal', 'intervention-used'].includes(f.category));
  for (const fact of goalRelevant) {
    items.push({
      id: newId(),
      kind: 'treatment-implication',
      title: `Treatment-relevant: ${fact.statement}`,
      detail: goals.length > 0 ? `May relate to documented goals (${goals.map((g) => g.title).slice(0, 3).join('; ')}).` : 'No goals documented yet — consider whether this belongs in the goal plan.',
      sources: [inputSource(input, fact.excerpt)],
      riskRelated: fact.riskRelated,
      requiresIndividualReview: fact.riskRelated,
    });
  }
  step(goalRelevant.length > 0 ? 'done' : 'skipped', `${goalRelevant.length} treatment implication(s)`);

  // 14. Risk-sensitive observations.
  const riskItems = factItems.filter((f) => f.riskRelated);
  for (const fact of riskItems) {
    items.push({
      id: newId(),
      kind: 'risk-mention',
      title: fact.statement,
      detail: 'Risk-sensitive content. The exact evidence is shown; context qualifiers apply; individual clinician review is required and this can never be bulk-approved. The AI has not made — and cannot make — a risk determination.',
      sources: [inputSource(input, fact.excerpt)],
      extractionLabel: fact.extractionLabel,
      riskRelated: true,
      requiresIndividualReview: true,
      suggestedQuestion: fact.suggestedQuestion ?? 'Review organizational risk procedures and document a disposition.',
    });
  }
  step(riskItems.length > 0 ? 'done' : 'skipped', `${riskItems.length} risk-related mention(s) — individual review`);

  // 15. Missing information.
  const missingItems: string[] = [];
  for (const fact of factItems) {
    if (fact.suggestedQuestion && !fact.riskRelated) missingItems.push(fact.suggestedQuestion);
  }
  const openGaps = (await db.structured.listGaps(clientId)).filter((g) => g.status === 'open');
  for (const question of [...new Set(missingItems)].slice(0, 5)) {
    items.push({
      id: newId(),
      kind: 'missing-information',
      title: question,
      detail: 'Suggested clarification. "Mark Needs Further Assessment" adds it to the missing-information list.',
      sources: [inputSource(input)],
      riskRelated: false,
      requiresIndividualReview: false,
    });
  }
  step('done', `${missingItems.length} clarification question(s); ${openGaps.length} gap(s) already open`);

  // 16. Evidence links: every payload carries its exact excerpt; links are
  // created by the Phase 2 repository at approval time (same as manual review).
  step('done', 'Evidence excerpts attached to every proposal; links are created on approval through the existing evidence validation');

  // 17. Verification (separate from any generator).
  const verifiable: VerifiableClaim[] = items
    .filter((i) => i.kind === 'explicit-information' || i.kind === 'proposed-fact')
    .map((i) => ({
      id: i.id,
      text: i.title,
      citedRefs: ['E0'],
      kind: 'factual',
    }));
  const verdicts = await deterministicVerifier.verify(verifiable, {
    clientId,
    evidence: [
      {
        ref: 'E0',
        refType: 'input',
        refId: input.id,
        clientId: input.clientId,
        date: input.dateOfInformation,
        text: input.rawText,
      },
    ],
    knowledge: [],
    contradictions: retrieval.contradictions.map((c) => ({ ref: c.ref, text: c.text })),
  });
  let flagged = 0;
  for (const verdict of verdicts) {
    const item = items.find((i) => i.id === verdict.claimId);
    if (!item) continue;
    if (verdict.status === 'unsupported' || verdict.status === 'needs-clarification' || verdict.status === 'contradicted') {
      flagged++;
      item.detail = `${item.detail} · VERIFICATION: ${verdict.status.replace(/-/g, ' ')} — ${verdict.note}`;
      item.requiresIndividualReview = true;
    }
  }
  step('done', flagged > 0 ? `${flagged} item(s) flagged by verification` : 'All proposals trace to the source text');

  // 18. Cross-client isolation verification (final pre-save check).
  const foreignSources = items.flatMap((i) => i.sources).filter((s) => {
    // every source here must reference THIS input or this client's records
    return s.refType === 'input' && s.refId !== input.id;
  });
  if (foreignSources.length > 0 || retrieval.sources.some((s) => s.clientId !== clientId)) {
    await db.audit('security', 'ai.isolation-violation', `pipeline pre-save check failed for client ${clientId}`);
    throw new Error('Cross-client isolation check failed before saving the update summary.');
  }
  step('done', 'Every evidence reference belongs to the selected client');

  // Contradiction items (from step 7) — added after verification so they
  // carry their own review path.
  for (const { proposal, existing } of detectedContradictions.slice(0, 6)) {
    items.push({
      id: newId(),
      kind: 'contradiction',
      title: `Possible contradiction: ${factCategoryMeta(proposal.category).label}`,
      detail: `New: "${proposal.statement}" vs approved: "${existing.statement}". Neither source is auto-chosen — classify it as historical change, contextually different, source error, still unresolved, or clinician resolved.`,
      sources: [
        inputSource(input, proposal.excerpt),
        {
          refType: 'fact',
          refId: existing.id,
          excerpt: existing.excerpt ?? existing.statement,
          date: existing.dateOccurred ?? existing.dateRecorded,
          label: 'Approved fact',
        },
      ],
      riskRelated: proposal.riskRelated || existing.riskRelated,
      requiresIndividualReview: true,
    });
  }
  for (const change of assessmentChanges) {
    items.push({
      id: newId(),
      kind: 'assessment-change',
      title: change,
      detail: 'Change computed with published meaningful-change thresholds only.',
      sources: [inputSource(input)],
      riskRelated: false,
      requiresIndividualReview: false,
    });
  }
  for (const theme of repeatedThemes.slice(0, 5)) {
    items.push({
      id: newId(),
      kind: 'theme',
      title: `Repeated theme: ${factCategoryMeta(theme).label}`,
      detail: 'This theme appears in the new entry and in the existing approved record.',
      sources: [inputSource(input)],
      riskRelated: false,
      requiresIndividualReview: false,
    });
  }

  // 19. Summary.
  const overallConfidence: ConfidenceLevel = computeConfidence({
    supportingSources: explicitFacts.length + retrieval.sources.length,
    approvedSources: retrieval.sources.filter((s) => s.approvalStatus === 'approved').length,
    distinctTimePeriods: retrieval.debug.timePeriodsCovered.length,
    contradictingSources: detectedContradictions.length,
    explicit: explicitFacts.length > 0,
  });
  const generation: IntelligenceGeneration = {
    providerType: provider.providerType,
    providerId: aiMode ? provider.id : 'deterministic',
    modelId: aiMode ? (provider.providerType === 'online' ? settings.onlineModel : settings.localModel) : undefined,
    generatedAt: new Date().toISOString(),
    disclosure: aiMode
      ? `Proposals drafted with the ${provider.label} and filtered by deterministic guards. Nothing is saved without your review.`
      : 'Proposals produced by deterministic rules only — no AI model is connected. Nothing is saved without your review.',
  };
  step('done', `${items.length} item(s), overall ${overallConfidence.replace(/-/g, ' ')}`);

  // 20. Clinician review required — the summary is stored pending-review.
  steps.push({
    step: 20,
    name: PIPELINE_STEPS[19],
    status: 'done',
    note: 'Summary stored pending clinician review; every item needs an individual decision',
  });
  const summary = await db.intelligence.createUpdateSummary(
    {
      clientId,
      sourceInputId: input.id,
      steps,
      items,
      sourcesUsed: [
        inputSource(input),
        ...retrieval.sources.slice(0, 8).map(
          (s): SegmentSource => ({
            refType: 'client-record',
            refId: s.refId,
            excerpt: s.text.slice(0, 200),
            date: s.date,
            label: s.label,
          }),
        ),
      ],
      retrievalDebug: retrieval.debug,
      overallConfidence,
      generation,
    },
    author,
  );
  options.onProgress?.(20, PIPELINE_STEPS[19]);
  return summary;
}

// ---------------------------------------------------- decision application

/**
 * Applies one clinician decision to one update item. All record creation
 * goes through the Phase 2 repositories, so category/risk policies,
 * evidence validation, and versioning apply exactly as in manual review.
 */
export async function applyUpdateItemDecision(
  db: ClinicalDatabase,
  summaryId: string,
  itemId: string,
  decision: 'approve' | 'edit-approve' | 'reject' | 'save-as-hypothesis' | 'needs-further-assessment' | 'do-not-save',
  author: string,
  opts: { editedStatement?: string; comment?: string; riskNote?: string } = {},
): Promise<void> {
  const summary = await db.intelligence.getUpdateSummary(summaryId);
  if (!summary) throw new Error('Update summary not found');
  const item = summary.items.find((i) => i.id === itemId);
  if (!item) throw new Error('Update item not found');

  let resultingRecordId: string | undefined;

  if (decision === 'approve' || decision === 'edit-approve') {
    if (item.hypothesisPayload) {
      // A hypothesis proposal can only ever become a hypothesis (§4).
      const payload = item.hypothesisPayload as Record<string, string & string[]>;
      const hypothesis = await db.structured.createHypothesis(
        {
          clientId: summary.clientId,
          category: (payload.category as never) ?? 'other',
          statement: opts.editedStatement ?? (payload.statement as unknown as string),
          confidence: 'insufficient-evidence',
          alternativeExplanations: (payload.alternativeExplanations as unknown as string[]) ?? [],
          missingInformation: [],
          questionsToAssess: (payload.questionsToAssess as unknown as string[]) ?? [],
        },
        author,
        { reviewStatus: 'pending' },
      );
      resultingRecordId = hypothesis.id;
    } else if (item.factPayload) {
      const payload = item.factPayload as Record<string, unknown>;
      const fact = await db.structured.createFact(
        {
          clientId: summary.clientId,
          sourceInputId: summary.sourceInputId,
          sourceInputVersion: 1,
          category: (payload.category as never) ?? 'other',
          statement: opts.editedStatement ?? (payload.statement as string),
          excerpt: payload.excerpt as string | undefined,
          sourceLocation: payload.sourceLocation as string | undefined,
          dateOccurred: payload.dateOccurred as string | undefined,
          dateRecorded: new Date().toISOString().slice(0, 10),
          classification: (payload.classification as never) ?? 'needs-source-clarification',
          extractionMethod: 'ai-provider',
          extractionConfidence: (payload.confidence as never) ?? 'low',
          temporalStatus: (payload.temporalStatus as never) ?? 'current',
          riskRelated: Boolean(payload.riskRelated) || item.riskRelated,
        },
        author,
      );
      await db.structured.decideFact(fact.id, 'approve', author, {
        asEdited: decision === 'edit-approve' || Boolean(opts.editedStatement),
        note: item.riskRelated ? (opts.riskNote ?? 'Reviewed individually in Clinical Update Summary') : undefined,
      });
      resultingRecordId = fact.id;
    }
  } else if (decision === 'save-as-hypothesis') {
    const statement = opts.editedStatement ?? item.title;
    const hypothesis = await db.structured.createHypothesis(
      {
        clientId: summary.clientId,
        category: 'other',
        statement,
        confidence: 'insufficient-evidence',
        alternativeExplanations: [],
        missingInformation: [],
        questionsToAssess: item.suggestedQuestion ? [item.suggestedQuestion] : [],
      },
      author,
      { reviewStatus: 'pending' },
    );
    resultingRecordId = hypothesis.id;
  } else if (decision === 'needs-further-assessment') {
    const gap = await db.structured.createGap(
      {
        clientId: summary.clientId,
        topic: item.title.slice(0, 120),
        reason: item.detail,
        suggestedQuestions: item.suggestedQuestion ? [item.suggestedQuestion] : [],
        priority: item.riskRelated ? 'high' : 'medium',
      },
      author,
    );
    resultingRecordId = gap.id;
  }
  // 'reject' and 'do-not-save' create nothing.

  const decisionMap = {
    'approve': 'approved',
    'edit-approve': 'edited-approved',
    'reject': 'rejected',
    'save-as-hypothesis': 'saved-as-hypothesis',
    'needs-further-assessment': 'needs-further-assessment',
    'do-not-save': 'not-saved',
  } as const;
  await db.intelligence.decideUpdateItem(summaryId, itemId, decisionMap[decision], author, {
    comment: opts.comment,
    resultingRecordId,
    editedDetail: opts.editedStatement ? `${item.detail} · edited by clinician` : undefined,
  });
}
