/**
 * Evaluation runner (§4) — executes one task type for one fictional case
 * against the selected provider inside the ephemeral sandbox, compares the
 * output to the case's expected targets, evaluates the known traps, and
 * saves an EvalRun (with a summarized entry in the AI operations log keyed
 * by the test-case id — never a real client id).
 */
import { AI_OUTPUT_SCHEMA_VERSION, type AiSettings } from '../ai/aiSchema';
import { activeAiProvider } from '../ai/providerRegistry';
import { deterministicVerifier, type VerifiableClaim } from '../ai/verification';
import { askAssistant } from '../assistant/assistantService';
import type { ClinicalDatabase } from '../db/database';
import { EMPTY_SELECTION } from '../db/documentSchema';
import type { IntelligenceGeneration } from '../db/intelligenceSchema';
import { assembleGenerationContext } from '../documents/contextAssembler';
import { createAiDocumentProvider } from '../documents/aiDocProvider';
import { templateProvider } from '../documents/templateProvider';
import { createAiExtractionProvider } from '../extraction/aiExtractionProvider';
import { ruleBasedProvider } from '../extraction/ruleBasedProvider';
import type { ProposedItem } from '../extraction/types';
import {
  DETERMINISTIC_FORMULATION_DISCLOSURE,
  proposeFormulationUpdate,
} from '../formulation/formulationEngine';
import { generateInterventionSet } from '../interventions/interventionEngine';
import { retrieveKnowledge, passageSupportsClaim } from '../knowledge/knowledgeRetrieval';
import { runAnalyzePipeline } from '../pipeline/analyzePipeline';
import { retrieveClientEvidence } from '../rag/clientRetrieval';
import { generateSafetyTrustStrategy } from '../strategy/safetyTrustEngine';
import {
  computeExtractionMetrics,
  computeHallucinationMetrics,
  computeRetrievalMetrics,
  computeRiskSafetyMetrics,
  evaluateTraps,
  matchesKeywords,
  type TrapContext,
} from './evalMetrics';
import { materializeCase } from './evalSandbox';
import {
  scoreRun,
  type EvalCase,
  type EvalError,
  type EvalRun,
  type EvalTaskType,
} from './evalSchema';

const AUTHOR = 'Evaluation Harness';

export interface RunEvalArgs {
  /** MAIN workspace db — used only to store the run + operations entry. */
  db: ClinicalDatabase;
  settings: AiSettings;
  evalCase: EvalCase;
  taskType: EvalTaskType;
  providerType: 'deterministic' | 'local' | 'online';
  onlineSendConfirmed?: boolean;
}

type QualityCheck = { label: string; passed: boolean; detail: string };

export async function runEvaluation(args: RunEvalArgs): Promise<EvalRun> {
  const { db, evalCase, taskType, providerType } = args;
  const settings: AiSettings = { ...args.settings, activeProviderType: providerType };
  const provider = activeAiProvider(settings);
  const aiMode = providerType !== 'deterministic';
  const startedAt = new Date().toISOString();
  const startMs = Date.now();

  const errors: EvalError[] = [];
  const qualityChecks: QualityCheck[] = [];
  const trapContext: TrapContext = { evalCase, outputText: '' };
  let outputPreview = '';
  let status: 'completed' | 'failed' = 'completed';
  let errorKind: string | undefined;
  let retrievalMetrics: EvalRun['retrieval'];
  let extractionMetrics: EvalRun['extraction'];
  let hallucinationMetrics: EvalRun['hallucination'];
  let riskSafetyMetrics: EvalRun['riskSafety'];

  const sandbox = await materializeCase(evalCase);
  const generation: IntelligenceGeneration = {
    providerType,
    providerId: aiMode ? provider.id : 'deterministic',
    modelId: aiMode ? (providerType === 'online' ? settings.onlineModel : settings.localModel) : undefined,
    generatedAt: startedAt,
    disclosure: aiMode ? `Evaluation run via ${provider.label}` : DETERMINISTIC_FORMULATION_DISCLOSURE,
  };

  const check = (label: string, passed: boolean, detail: string, highPriority = false) => {
    qualityChecks.push({ label, passed, detail });
    if (!passed) errors.push({ kind: 'task-error', detail: `${label}: ${detail}`, highPriority });
  };

  try {
    const input = (await sandbox.db.getInput(sandbox.inputIds[0]))!;

    // ---------------------------------------------------------- extraction
    if (taskType === 'extraction') {
      const extractor = aiMode
        ? createAiExtractionProvider(() => ({
            db: sandbox.db,
            settings,
            provider,
            onlineSendConfirmed: args.onlineSendConfirmed,
          }))
        : ruleBasedProvider;
      const items: ProposedItem[] = [];
      for (const inputId of sandbox.inputIds) {
        const current = (await sandbox.db.getInput(inputId))!;
        const result = await extractor.extract(current);
        items.push(...result.items);
      }
      trapContext.items = items;
      outputPreview = items
        .map((i) =>
          i.kind === 'fact'
            ? `FACT [${i.category}${i.riskRelated ? ', risk' : ''}]: ${i.statement}`
            : i.kind === 'assessment-score'
              ? `SCORE: ${i.name} = ${i.totalScore}`
              : `HYPOTHESIS [${i.category}]: ${i.statement}`,
        )
        .join('\n');
      extractionMetrics = computeExtractionMetrics(items, evalCase.expected.facts, errors);

      // Hallucination pass: verify every proposed fact against its source.
      const sourceText = evalCase.inputs.map((i) => i.text).join('\n');
      const claims: VerifiableClaim[] = items
        .filter((i) => i.kind === 'fact')
        .map((i, idx) => ({ id: `f-${idx}`, text: (i as { statement: string }).statement, citedRefs: ['E0'], kind: 'factual' }));
      const verdicts = await deterministicVerifier.verify(claims, {
        clientId: sandbox.clientId,
        evidence: [{ ref: 'E0', refType: 'input', refId: input.id, clientId: sandbox.clientId, text: sourceText }],
        knowledge: [],
        contradictions: [],
      });
      hallucinationMetrics = computeHallucinationMetrics(
        claims.map((c, i) => ({ text: c.text, verdict: verdicts[i] })),
        errors,
      );
    }

    // --------------------------------- pipeline (update summary / risk)
    if (taskType === 'clinical-update-summary' || taskType === 'risk-summary') {
      const summary = await runAnalyzePipeline(sandbox.db, settings, sandbox.clientId, input.id, AUTHOR, {
        onlineSendConfirmed: args.onlineSendConfirmed,
      });
      trapContext.summary = summary;
      trapContext.items = undefined;
      outputPreview = summary.items.map((i) => `[${i.kind}] ${i.title}`).join('\n');
      riskSafetyMetrics = computeRiskSafetyMetrics(summary, evalCase, errors);

      if (taskType === 'clinical-update-summary') {
        // Expected facts should appear among proposal items.
        let found = 0;
        for (const expected of evalCase.expected.facts.filter((f) => !f.mustBeHypothesis)) {
          if (summary.items.some((i) => matchesKeywords(`${i.title} ${i.detail}`, expected.keywords))) found++;
          else errors.push({ kind: 'missed-fact', detail: `Expected content missing from summary: ${expected.keywords.join(', ')}.` });
        }
        check(
          'Expected content proposed',
          found === evalCase.expected.facts.filter((f) => !f.mustBeHypothesis).length,
          `${found} of ${evalCase.expected.facts.filter((f) => !f.mustBeHypothesis).length} expected targets surfaced`,
        );
        for (const expectedContradiction of evalCase.expected.contradictions) {
          const hit = summary.items.some(
            (i) => i.kind === 'contradiction' && matchesKeywords(`${i.title} ${i.detail}`, expectedContradiction),
          );
          if (!hit) errors.push({ kind: 'missed-contradiction', detail: `Expected contradiction not surfaced: ${expectedContradiction.join(', ')}.`, highPriority: true });
          check('Contradiction surfaced', hit, expectedContradiction.join(', '));
        }
        for (const missing of evalCase.expected.missingInformation) {
          const hit = summary.items.some((i) => i.kind === 'missing-information' && matchesKeywords(`${i.title} ${i.detail}`, missing));
          check('Missing-information identified', hit, missing.join(', '));
        }
      }
      check('Every proposal awaits clinician review', summary.status === 'pending-review', `status: ${summary.status}`);
    }

    // ------------------------------------------------------ RAG probe
    if (taskType === 'assistant-answer' || taskType === 'clinical-update-summary') {
      const question = evalCase.expected.assistantQuestion?.question ?? evalCase.summary;
      const retrieval = await retrieveClientEvidence(sandbox.db, sandbox.clientId, question, { limit: 10 });
      retrievalMetrics = computeRetrievalMetrics(
        retrieval.debug,
        evalCase.expected.facts.map((f) => f.keywords),
        [...retrieval.sources, ...retrieval.contradictions].map((s) => `${s.label} ${s.text}`),
        errors,
      );
    }

    // -------------------------------------------------------- assistant
    if (taskType === 'assistant-answer') {
      const probe = evalCase.expected.assistantQuestion;
      const question = probe?.question ?? 'Summarize what is documented for this client.';
      const { assistantMessage } = await askAssistant(sandbox.db, settings, sandbox.clientId, question, {
        onlineSendConfirmed: args.onlineSendConfirmed,
      });
      const answer = assistantMessage.answer!;
      outputPreview = answer.blocks.map((b) => `[${b.basis}] ${b.text}`).join('\n');
      trapContext.outputText = outputPreview;

      check('Answer carries citations', answer.insufficientEvidence || answer.blocks.every((b) => b.citedRefs.length > 0), 'every block cites evidence or states insufficiency');
      if (probe?.expectInsufficient) {
        check('Insufficient evidence stated honestly', answer.insufficientEvidence, 'expected an insufficient-evidence answer');
      }
      if (probe?.mustCiteKeywords) {
        const evidenceText = answer.clientEvidence.map((c) => `${c.label} ${c.excerpt}`).join(' ').toLowerCase();
        const allCited = probe.mustCiteKeywords.every((k) => evidenceText.includes(k.toLowerCase()));
        check('Expected evidence cited', allCited, `must cite: ${probe.mustCiteKeywords.join(', ')}`);
        if (!allCited) errors.push({ kind: 'missed-expected-source', detail: `Assistant did not cite: ${probe.mustCiteKeywords.join(', ')}.` });
      }
      if (evalCase.expected.contradictions.length > 0) {
        check('Contradictory evidence retrieved with answer', answer.contradictions.length > 0, `${answer.contradictions.length} contradiction(s) shown`);
      }
    }

    // ------------------------------------------------------ documents
    if (taskType === 'dap-note' || taskType === 'treatment-plan') {
      const facts = await sandbox.db.structured.listFacts(sandbox.clientId);
      const assessments = await sandbox.db.structured.listAssessments(sandbox.clientId);
      const hypotheses = await sandbox.db.structured.listHypotheses(sandbox.clientId);
      const goals = await sandbox.db.documents.listGoals(sandbox.clientId);
      const context = await assembleGenerationContext(
        sandbox.db,
        sandbox.clientId,
        taskType,
        {
          ...EMPTY_SELECTION,
          inputIds: sandbox.inputIds,
          factIds: facts.map((f) => f.id),
          assessmentIds: assessments.map((a) => a.id),
          hypothesisIds: hypotheses.map((h) => h.id),
          goalIds: goals.map((g) => g.id),
          riskConfirmed: true,
        },
        { sessionDate: evalCase.inputs[0]?.date ?? '2026-06-15' },
      );
      const docProvider = aiMode
        ? createAiDocumentProvider(() => ({
            db: sandbox.db,
            settings,
            provider,
            onlineSendConfirmed: args.onlineSendConfirmed,
          }))
        : templateProvider;

      if (taskType === 'dap-note') {
        const result = await docProvider.generateDapNote(context);
        trapContext.segments = result.segments;
        outputPreview = result.segments.map((s) => `[${s.section}] ${s.text}`).join('\n');

        const sections = new Set(result.segments.map((s) => s.section));
        check('Data/Assessment/Plan sections present', ['data', 'assessment', 'plan'].every((s) => sections.has(s)), [...sections].join(', '));
        const unsupported = result.segments.filter(
          (s) => s.sources.length === 0 && s.kind !== 'template' && s.kind !== 'therapist-authored',
        );
        check('No unsupported content', unsupported.length === 0, `${unsupported.length} unsupported segment(s)`);
        for (const segment of unsupported) {
          errors.push({ kind: 'unsupported-claim', detail: 'Segment has no evidence source.', generatedText: segment.text });
        }
        const hypothesisSegments = result.segments.filter((s) => s.sources.some((src) => src.refType === 'hypothesis'));
        check(
          'Hypotheses labeled as hypotheses',
          hypothesisSegments.every((s) => s.kind === 'interpretive'),
          `${hypothesisSegments.length} hypothesis-based segment(s)`,
        );
        const riskSegments = result.segments.filter((s) => s.riskRelated);
        check('Risk content flagged for confirmation', riskSegments.every((s) => !s.riskAcknowledged), `${riskSegments.length} risk segment(s) awaiting clinician confirmation`);
        if (goals.length > 0) {
          check(
            'Progress statements connect to goals',
            result.segments.some((s) => s.sources.some((src) => src.refType === 'goal')),
            'at least one segment cites a documented goal',
          );
        }

        // Hallucination metrics from the segment claims.
        const claims: VerifiableClaim[] = result.segments.map((s, i) => ({
          id: `s-${i}`,
          text: s.text,
          citedRefs: [],
          kind: s.kind,
        }));
        hallucinationMetrics = computeHallucinationMetrics(
          claims.map((c, i) => ({
            text: c.text,
            verdict: {
              claimId: c.id,
              status:
                result.segments[i].verification?.status ??
                (result.segments[i].sources.length > 0
                  ? result.segments[i].sources.some((src) => src.refType === 'hypothesis')
                    ? 'supported-by-hypothesis'
                    : 'directly-supported'
                  : result.segments[i].kind === 'template' || result.segments[i].kind === 'therapist-authored'
                    ? 'therapist-authored'
                    : 'unsupported'),
              note: result.segments[i].verification?.note ?? 'Derived from segment evidence.',
              verifiedRefs: [],
            },
          })),
          errors,
        );
      } else {
        const result = await docProvider.generateTreatmentPlan(context);
        trapContext.problems = result.problems;
        trapContext.objectives = result.proposedObjectives;
        trapContext.segments = result.segments;
        outputPreview = [
          ...result.problems.map((p) => `PROBLEM: ${p.text}`),
          ...result.hierarchy.map((h) => `NEED ${h.rank}: ${h.need}`),
          ...result.proposedObjectives.map((o) => `OBJECTIVE: ${o.description} (missing: ${o.missing.join('; ') || 'none'})`),
        ].join('\n');

        check('Problems carry evidence', result.problems.every((p) => p.sources.length > 0), `${result.problems.length} problem(s)`);
        const planText = outputPreview + result.goalPlanRationale + result.segments.map((s) => s.text).join(' ');
        for (const target of evalCase.expected.planTargets) {
          const hit = matchesKeywords(planText, target);
          check('Expected plan target addressed', hit, target.join(', '));
          if (!hit) errors.push({ kind: 'missed-fact', detail: `Plan does not address: ${target.join(', ')}.` });
        }
        const inventedNumber = result.proposedObjectives.find((o) => {
          const numbers = o.description.match(/\d+/g) ?? [];
          const evidenceText = o.sources.map((s) => s.excerpt ?? '').join(' ') + evalCase.inputs.map((i) => i.text).join(' ');
          return numbers.some((n) => !evidenceText.includes(n));
        });
        check('No invented baselines/targets/deadlines', !inventedNumber, inventedNumber ? inventedNumber.description : 'objective numbers trace to evidence');
        if (inventedNumber) errors.push({ kind: 'invented-number', detail: 'Objective contains a number absent from the evidence.', generatedText: inventedNumber.description, highPriority: true });
        check(
          'Missing information identified instead of fabricated',
          result.proposedObjectives.every((o) => o.missing.length > 0 || /baseline|target/i.test(o.description)),
          'objectives list Clinician-input gaps',
        );
      }
    }

    // ------------------------------------------------------ formulation
    if (taskType === 'case-formulation') {
      const framework = evalCase.expected.formulationThemes[0]?.framework ?? 'biopsychosocial';
      const formulation = await proposeFormulationUpdate(sandbox.db, sandbox.clientId, framework, AUTHOR, generation, 'evaluation run');
      trapContext.formulation = formulation;
      outputPreview = formulation.sections.map((s) => `[${s.label}] ${s.text}`).join('\n');

      check('Proposal pending clinician review', formulation.reviewStatus === 'pending', formulation.reviewStatus);
      for (const theme of evalCase.expected.formulationThemes.filter((t) => t.framework === framework)) {
        const section = formulation.sections.find((s) => s.key === theme.sectionKey);
        const hit = section ? matchesKeywords(section.text, theme.keywords) : false;
        check(`Theme present: ${theme.sectionKey}`, hit, theme.keywords.join(', '));
        if (!hit) errors.push({ kind: 'missed-fact', detail: `Formulation theme missing in ${theme.sectionKey}: ${theme.keywords.join(', ')}.` });
      }
      check(
        'Populated sections carry evidence',
        formulation.sections.every((s) => s.supportingEvidence.length > 0 || s.text.includes('No approved information')),
        'no fabricated sections',
      );
      check(
        'Hypothesis-based sections labeled',
        formulation.sections.filter((s) => s.hypothesisBased).every((s) => /hypothesis/i.test(s.text)),
        'labels present',
      );
      check('Areas needing assessment listed', formulation.areasNeedingAssessment.length > 0, `${formulation.areasNeedingAssessment.length} item(s)`);
    }

    // ---------------------------------------------------- interventions
    if (taskType === 'intervention-recommendation') {
      const set = await generateInterventionSet(sandbox.db, sandbox.clientId, AUTHOR, generation);
      trapContext.interventions = set;
      outputPreview = set.recommendations.map((r) => `${r.name} [${r.tier}]${r.stabilizationConcern ? ' ⚠ stabilization' : ''}`).join('\n');

      for (const expected of evalCase.expected.interventions) {
        const rec = set.recommendations.find((r) => r.name === expected.name);
        check(`Expected option present: ${expected.name}`, Boolean(rec), rec ? `tier ${rec.tier}` : 'not recommended');
        if (!rec) errors.push({ kind: 'missed-fact', detail: `Expected intervention missing: ${expected.name}.` });
        if (rec && expected.requiredCautionKeyword) {
          check(
            `Caution present for ${expected.name}`,
            rec.cautions.some((c) => c.toLowerCase().includes(expected.requiredCautionKeyword!.toLowerCase())),
            expected.requiredCautionKeyword,
          );
        }
      }
      for (const name of evalCase.expected.interventionsNotExpected) {
        const rec = set.recommendations.find((r) => r.name === name);
        const ok = !rec || Boolean(rec.stabilizationConcern);
        check(`Not recommended (or flagged): ${name}`, ok, rec ? 'present with stabilization concern' : 'correctly absent');
        if (!ok) errors.push({ kind: 'incorrect-fact', detail: `${name} recommended without support or caution.`, highPriority: true });
      }
      check('Options, not directives', set.recommendations.every((r) => r.whyItMayFit.includes('not a directive')), 'wording check');
      check(
        'Established tier requires knowledge support',
        set.recommendations.filter((r) => r.tier === 'established').every((r) => r.knowledgeSupport.length > 0),
        'knowledge citations present',
      );
      check('Measurement methods included', set.recommendations.every((r) => r.howToMeasure.length > 0), 'all options measurable');
      check('Alternatives included', set.recommendations.every((r) => r.alternatives.length > 0), 'alternatives listed');
    }

    // -------------------------------------------------------- strategy
    if (taskType === 'safety-strategy') {
      const strategy = await generateSafetyTrustStrategy(sandbox.db, sandbox.clientId, AUTHOR, generation);
      outputPreview = strategy.sections.map((s) => `[${s.label}] ${s.items.map((i) => i.text).join(' | ')}`).join('\n');
      check('Proposal pending clinician review', strategy.reviewStatus === 'pending', strategy.reviewStatus);
      const evidenced = strategy.sections.flatMap((s) => s.items).filter((i) => i.sources.length > 0);
      check('Evidence-backed items exist', evidenced.length > 0, `${evidenced.length} evidenced item(s)`);
      check(
        'Hypothesis items labeled',
        strategy.sections.flatMap((s) => s.items).filter((i) => i.basis === 'hypothesis').every((i) => /hypothesis/i.test(i.text)),
        'labels present',
      );
      check(
        'No fabricated guidance',
        strategy.sections.flatMap((s) => s.items).every((i) => i.sources.length > 0 || /no documented|ask the client|insufficient/i.test(i.text)),
        'unevidenced items are honest defaults',
      );
    }

    // --------------------------------------------- knowledge citations
    if (taskType === 'knowledge-citation-check') {
      const query = evalCase.knowledgeSources[0]?.topic ?? evalCase.summary;
      const passages = await retrieveKnowledge(sandbox.db.knowledge, 'assistant-answers', query, { limit: 5 });
      outputPreview = passages.map((p) => `${p.title} (${p.citation})${p.page ? ` p.${p.page}` : ''}: ${p.text.slice(0, 120)}`).join('\n');
      if (evalCase.knowledgeSources.length === 0) {
        check('No citations invented without sources', passages.length === 0, 'library empty for this case — nothing retrieved');
      } else {
        check('Approved sources retrieved', passages.length > 0, `${passages.length} passage(s)`);
        for (const passage of passages) {
          const chunk = (await sandbox.db.knowledge.listChunks(passage.sourceId)).find((c) => c.id === passage.chunkId);
          const resolvable = Boolean(chunk && chunk.text === passage.text);
          check('Citation resolves to a real passage', resolvable, passage.title);
          if (!resolvable) errors.push({ kind: 'unsupported-citation', detail: `Citation does not resolve: ${passage.title}.`, highPriority: true });
          check(
            'Passage supports its topic',
            passageSupportsClaim(passage.text, query),
            passage.title,
          );
        }
      }
    }
  } catch (err) {
    status = 'failed';
    errorKind = err instanceof Error ? err.name : 'unknown';
    errors.push({ kind: 'task-error', detail: err instanceof Error ? err.message : 'Task failed.', highPriority: true });
  } finally {
    sandbox.dispose();
  }

  trapContext.outputText = trapContext.outputText || outputPreview;
  const trapResults = status === 'completed' ? evaluateTraps(evalCase.knownTraps, trapContext) : [];
  for (const trap of trapResults.filter((t) => !t.passed)) {
    errors.push({ kind: 'trap-failed', detail: `${trap.label} — ${trap.detail}`, highPriority: true });
  }

  const finishedAt = new Date().toISOString();
  const run = await db.evaluation.saveRun({
    caseId: evalCase.id,
    caseTitle: evalCase.title,
    caseSource: evalCase.source,
    taskType,
    providerType,
    providerId: aiMode ? provider.id : 'deterministic',
    modelId: aiMode ? (providerType === 'online' ? settings.onlineModel : settings.localModel) : 'none',
    startedAt,
    finishedAt,
    durationMs: Date.now() - startMs,
    status,
    errorKind,
    outputPreview: outputPreview.slice(0, 8000),
    extraction: extractionMetrics,
    hallucination: hallucinationMetrics,
    retrieval: retrievalMetrics,
    riskSafety: riskSafetyMetrics,
    qualityChecks,
    trapResults,
    errors,
    score: status === 'completed' ? scoreRun(errors, trapResults) : 0,
    phiLeftDevice: false, // fictional content only; nothing is PHI
  });

  // Summarized entry in the AI operations log, keyed by the TEST CASE id.
  await db.ai.logOperation({
    clientId: `eval:${evalCase.id}`,
    capability:
      taskType === 'extraction'
        ? 'extraction'
        : taskType === 'dap-note' || taskType === 'treatment-plan'
          ? 'document-generation'
          : taskType === 'case-formulation'
            ? 'case-formulation'
            : taskType === 'intervention-recommendation'
              ? 'intervention-recommendation'
              : taskType === 'safety-strategy'
                ? 'safety-strategy'
                : taskType === 'assistant-answer'
                  ? 'question-answering'
                  : taskType === 'knowledge-citation-check'
                    ? 'knowledge-assistance'
                    : 'clinical-synthesis',
    providerType,
    providerId: aiMode ? provider.id : 'deterministic',
    modelId: run.modelId,
    providerVersion: 'evaluation-harness',
    mode: providerType,
    selectedSources: [`eval-case:${evalCase.id}`],
    knowledgeSources: [],
    outputSchemaVersion: AI_OUTPUT_SCHEMA_VERSION,
    phiLeftDevice: providerType === 'online' && status === 'completed',
    redactionApplied: false,
    consentStatus: aiMode ? 'verified' : 'not-required-deterministic',
    reviewStatus: 'not-applicable',
    status: status === 'completed' ? 'completed' : 'failed',
    errorKind,
    durationMs: run.durationMs,
  });

  return run;
}
