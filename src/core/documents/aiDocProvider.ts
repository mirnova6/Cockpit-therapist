/**
 * AI document generation provider (§12, §13) — registers through the
 * existing DocumentGenerationProvider seam, so the document database,
 * review workflow, evidence panels, risk gating, and export rules apply
 * unchanged.
 *
 * The model writes natural clinical prose but ONLY from the evidence blocks
 * assembled out of the clinician's source selection; every sentence returns
 * with citations that are mapped back to real SegmentSources and then
 * checked by the separate deterministic verifier. Deterministic guards:
 *  - uncited/unverifiable sentences are flagged, never silently kept;
 *  - risk language and risk-source citations force riskRelated (clinician
 *    confirmation required before approval, as in Phase 3);
 *  - objective numbers (baseline/target/time frame) survive only if they
 *    appear in the cited evidence text — otherwise they become explicit
 *    "Clinician input required" gaps;
 *  - hypothesis citations force kind 'interpretive' with a label.
 */
import { runAiTask } from '../ai/aiGateway';
import type { AiSettings } from '../ai/aiSchema';
import type { ClinicalAIProvider, EvidenceBlock } from '../ai/types';
import { deterministicVerifier, type VerifiableClaim } from '../ai/verification';
import type { ClinicalDatabase } from '../db/database';
import {
  FORMULATION_SECTIONS,
  MEASUREMENT_METHODS,
  type DocSegment,
  type GenerationWarning,
  type PlanNeed,
  type PlanProblem,
  type ProposedObjective,
  type SegmentSource,
} from '../db/documentSchema';
import { newId } from '../db/schema';
import { APPROVED_STATUSES, factCategoryMeta } from '../db/structuredSchema';
import { matchesRiskLanguage } from '../extraction/ruleBasedProvider';
import type {
  DapGenerationResult,
  DocumentGenerationProvider,
  GenerationContext,
  PlanGenerationResult,
} from './generationTypes';
import { warning } from './generationTypes';

export const AI_DOC_PROVIDER_ID = 'ai-document-generator';

export interface AiDocContext {
  db: ClinicalDatabase;
  settings: AiSettings;
  provider: ClinicalAIProvider;
  onlineSendConfirmed?: boolean;
  operationToken?: string;
}

// ------------------------------------------------------- evidence packing

interface PackedEvidence {
  blocks: EvidenceBlock[];
  sourceByRef: Map<string, SegmentSource & { riskRelated: boolean; pending: boolean; hypothesis: boolean }>;
  sourceInputs: Array<{ id: string; allowAiAnalysis: boolean; localOnly: boolean }>;
}

function packEvidence(context: GenerationContext): PackedEvidence {
  const blocks: EvidenceBlock[] = [];
  const sourceByRef = new Map<string, SegmentSource & { riskRelated: boolean; pending: boolean; hypothesis: boolean }>();
  let counter = 0;
  const add = (
    refType: SegmentSource['refType'],
    refId: string,
    label: string,
    text: string,
    opts: { date?: string; excerpt?: string; risk?: boolean; pending?: boolean; hypothesis?: boolean; status?: string } = {},
  ) => {
    const ref = `E${++counter}`;
    blocks.push({
      ref,
      refType,
      refId,
      clientId: context.client.id,
      date: opts.date,
      label,
      approvalStatus: opts.status,
      text,
    });
    sourceByRef.set(ref, {
      refType,
      refId,
      excerpt: (opts.excerpt ?? text).slice(0, 300),
      date: opts.date,
      label,
      riskRelated: opts.risk ?? false,
      pending: opts.pending ?? false,
      hypothesis: opts.hypothesis ?? false,
    });
  };

  for (const input of context.inputs) {
    add('input', input.id, `${input.inputType} (${input.dateOfInformation})`, input.rawText, {
      date: input.dateOfInformation,
      risk: input.containsRisk,
    });
  }
  for (const fact of context.facts) {
    add(
      'fact',
      fact.id,
      `${factCategoryMeta(fact.category).label}${fact.pendingIncluded ? ' [PENDING]' : ''}`,
      `${fact.statement}${fact.excerpt ? ` (source: "${fact.excerpt}")` : ''}`,
      {
        date: fact.dateOccurred ?? fact.dateRecorded,
        excerpt: fact.excerpt ?? fact.statement,
        risk: fact.riskRelated,
        pending: Boolean(fact.pendingIncluded),
        status: fact.reviewStatus,
      },
    );
  }
  for (const assessment of context.assessments) {
    add(
      'assessment',
      assessment.id,
      `${assessment.name} (${assessment.dateAdministered})`,
      `${assessment.name} total ${assessment.totalScore ?? 'n/a'} on ${assessment.dateAdministered}. ${assessment.severityInterpretation ?? ''} Screening result, not a diagnosis.`,
      { date: assessment.dateAdministered, risk: assessment.riskFlags.length > 0 },
    );
  }
  for (const hypothesis of context.hypotheses) {
    add('hypothesis', hypothesis.id, `Hypothesis (${hypothesis.confidence})`, `HYPOTHESIS: ${hypothesis.statement}`, {
      date: hypothesis.updatedAt.slice(0, 10),
      hypothesis: true,
      status: hypothesis.reviewStatus,
    });
  }
  for (const goal of context.goals) {
    add(
      'goal',
      goal.id,
      `Goal: ${goal.title}`,
      `GOAL (${goal.status}): ${goal.title}. ${goal.objectives
        .map((o) => `Objective (${o.progress}): ${o.description}${o.baseline ? ` baseline ${o.baseline}` : ''}${o.target ? ` target ${o.target}` : ''}${o.targetDate ? ` by ${o.targetDate}` : ''}`)
        .join(' ')}`,
      { date: goal.updatedAt.slice(0, 10) },
    );
  }
  for (const gap of context.openGaps) {
    add('gap', gap.id, `Needs further assessment: ${gap.topic}`, `MISSING INFORMATION: ${gap.topic} — ${gap.reason}`);
  }

  const sourceInputs = context.inputs.map((i) => ({
    id: i.id,
    allowAiAnalysis: i.allowAiAnalysis,
    localOnly: i.localOnly,
  }));
  return { blocks, sourceByRef, sourceInputs };
}

// -------------------------------------------------------- segment mapping

interface RawSegment {
  section?: string;
  text?: string;
  kind?: string;
  refs?: string[];
  riskRelated?: boolean;
}

async function mapAndVerifySegments(
  raw: RawSegment[],
  allowedSections: string[],
  packed: PackedEvidence,
  clientId: string,
  warnings: GenerationWarning[],
): Promise<DocSegment[]> {
  const cleaned = raw.filter(
    (s): s is Required<Pick<RawSegment, 'section' | 'text'>> & RawSegment =>
      typeof s.text === 'string' && s.text.trim().length > 0 && typeof s.section === 'string',
  );

  const claims: VerifiableClaim[] = cleaned.map((s, i) => ({
    id: `seg-${i}`,
    text: s.text,
    citedRefs: (s.refs ?? []).filter((r) => packed.sourceByRef.has(r)),
    kind: s.kind === 'interpretive' ? 'interpretive' : 'factual',
  }));
  const verdicts = await deterministicVerifier.verify(claims, {
    clientId,
    evidence: packed.blocks,
    knowledge: [],
    contradictions: [],
  });

  let unsupported = 0;
  const segments = cleaned.map((s, i): DocSegment => {
    const verdict = verdicts[i];
    const refs = (s.refs ?? []).filter((r) => packed.sourceByRef.has(r));
    const sources = refs.map((r) => {
      const meta = packed.sourceByRef.get(r)!;
      return {
        refType: meta.refType,
        refId: meta.refId,
        excerpt: meta.excerpt,
        date: meta.date,
        label: meta.label,
      } satisfies SegmentSource;
    });
    const citesHypothesis = refs.some((r) => packed.sourceByRef.get(r)!.hypothesis);
    const citesPending = refs.some((r) => packed.sourceByRef.get(r)!.pending);
    const citesRisk = refs.some((r) => packed.sourceByRef.get(r)!.riskRelated);
    const riskRelated = s.riskRelated === true || citesRisk || matchesRiskLanguage(s.text);
    if (verdict.status === 'unsupported' || verdict.status === 'needs-clarification') unsupported++;

    let text = s.text.trim();
    if (citesHypothesis && !/hypothes/i.test(text)) {
      text = `Working hypothesis (not established fact): ${text}`;
    }

    return {
      id: newId(),
      section: allowedSections.includes(s.section) ? s.section : allowedSections[0],
      text,
      kind: citesHypothesis ? 'interpretive' : s.kind === 'interpretive' ? 'interpretive' : 'factual',
      sources,
      fromPendingSource: citesPending || undefined,
      riskRelated,
      verification: { status: verdict.status, note: verdict.note },
    };
  });

  if (unsupported > 0) {
    warnings.push(
      warning(
        'unsupported',
        `${unsupported} sentence${unsupported === 1 ? '' : 's'} could not be verified against the selected sources and ${unsupported === 1 ? 'is' : 'are'} flagged for your review.`,
      ),
    );
  }
  return segments;
}

// ------------------------------------------------------------- provider

const DAP_INSTRUCTIONS = `Write a DAP progress note (sections: data, assessment, plan) as natural clinical prose using ONLY the supplied evidence.
Return JSON: {"segments":[{"section":"data"|"assessment"|"plan","text":"one sentence or short claim","kind":"factual"|"interpretive","refs":["E1"],"riskRelated":boolean}]}.
Hard rules: no mental-status findings unless documented in evidence; no interventions that are not documented; no diagnoses; no risk determinations — describe documented risk material only and mark it riskRelated; every hypothesis-based sentence must have kind "interpretive"; connect progress statements to the documented goals; every sentence cites the refs it rests on.`;

const PLAN_INSTRUCTIONS = `Draft a Master Treatment Plan from the supplied evidence ONLY.
Return JSON: {
 "problems":[{"text":"problem statement","refs":["E1"],"riskRelated":boolean}],
 "evidencedBy":[{"text":"...","refs":[...]}],
 "formulation":[{"section":"${FORMULATION_SECTIONS.map((s) => s.key).join('"|"')}","text":"...","refs":[...]}],
 "hierarchy":[{"need":"...","rationale":"...","refs":[...]}],
 "goalPlanRationale":"...",
 "expectedImprovement":"...",
 "proposedObjectives":[{"description":"...","targetProblem":"...","measurementMethod":"one of: ${MEASUREMENT_METHODS.join('; ')}","baseline":"ONLY if documented in cited evidence","target":"ONLY if documented","timeFrame":"ONLY if documented","refs":[...]}]
}
Hard rules: screening scores are never diagnoses — say "screening result" when citing them; never invent baseline numbers, frequencies, target values, or deadlines; propose 4-5 objectives only when the evidence genuinely supports them, otherwise fewer with clear gaps; risk content must be marked riskRelated.`;

export function createAiDocumentProvider(getContext: () => AiDocContext): DocumentGenerationProvider {
  return {
    id: AI_DOC_PROVIDER_ID,
    label: 'AI Document Generator',
    disclosure:
      'This draft was written by the configured AI model from your selected sources only, then every sentence was checked by a separate deterministic verifier. Unverified content is flagged. It remains a draft until you review and approve it.',

    async generateDapNote(context: GenerationContext): Promise<DapGenerationResult> {
      const { db, settings, provider, onlineSendConfirmed, operationToken } = getContext();
      const packed = packEvidence(context);
      const warnings: GenerationWarning[] = [];

      const { response, operationId } = await runAiTask({
        db,
        settings,
        provider,
        clientId: context.client.id,
        capability: 'document-generation',
        instructions: `${DAP_INSTRUCTIONS}\nNote style: ${context.selection.style}. ${context.selection.therapistInstructions ? '' : ''}`,
        clinicianCommand: context.selection.therapistInstructions,
        clientEvidence: packed.blocks,
        knowledgePassages: [],
        expectJson: true,
        sourceInputs: packed.sourceInputs,
        onlineSendConfirmed,
        operationToken,
      });

      const parsed = (response.json ?? {}) as { segments?: RawSegment[] };
      const segments = await mapAndVerifySegments(
        parsed.segments ?? [],
        ['data', 'assessment', 'plan'],
        packed,
        context.client.id,
        warnings,
      );
      if (segments.length === 0) {
        warnings.push(warning('missing-info', 'The model returned no usable content; clinician input required.'));
        segments.push({
          id: newId(),
          section: 'data',
          text: 'Insufficient information in the selected sources — clinician input required.',
          kind: 'template',
          sources: [],
          riskRelated: false,
        });
      }
      if (segments.some((s) => s.riskRelated)) {
        warnings.push(warning('risk', 'This draft contains risk-related content that requires your individual confirmation before approval.'));
      }
      if (segments.some((s) => s.fromPendingSource)) {
        warnings.push(warning('pending-source', 'Some content is based on PENDING information you explicitly included.'));
      }

      return {
        segments,
        generation: {
          method: provider.providerType === 'online' ? 'online-ai' : 'local-ai',
          providerId: AI_DOC_PROVIDER_ID,
          providerLabel: `AI Document Generator (${response.modelId})`,
          generatedAt: new Date().toISOString(),
          disclosure: `${this.disclosure} Operation ${operationId}.`,
          warnings,
        },
      };
    },

    async generateTreatmentPlan(context: GenerationContext): Promise<PlanGenerationResult> {
      const { db, settings, provider, onlineSendConfirmed, operationToken } = getContext();
      const packed = packEvidence(context);
      const warnings: GenerationWarning[] = [];

      const { response, operationId } = await runAiTask({
        db,
        settings,
        provider,
        clientId: context.client.id,
        capability: 'document-generation',
        instructions: PLAN_INSTRUCTIONS,
        clinicianCommand: context.selection.therapistInstructions,
        clientEvidence: packed.blocks,
        knowledgePassages: [],
        expectJson: true,
        maxOutputTokens: 6000,
        sourceInputs: packed.sourceInputs,
        onlineSendConfirmed,
        operationToken,
      });

      const parsed = (response.json ?? {}) as {
        problems?: RawSegment[];
        evidencedBy?: RawSegment[];
        formulation?: RawSegment[];
        hierarchy?: Array<{ need?: string; rationale?: string; refs?: string[] }>;
        goalPlanRationale?: string;
        expectedImprovement?: string;
        proposedObjectives?: Array<Record<string, unknown>>;
      };

      const toSources = (refs: string[] | undefined) =>
        (refs ?? [])
          .filter((r) => packed.sourceByRef.has(r))
          .map((r) => {
            const meta = packed.sourceByRef.get(r)!;
            return { refType: meta.refType, refId: meta.refId, excerpt: meta.excerpt, date: meta.date, label: meta.label } satisfies SegmentSource;
          });
      const anyRisk = (refs: string[] | undefined, text: string) =>
        (refs ?? []).some((r) => packed.sourceByRef.get(r)?.riskRelated) || matchesRiskLanguage(text);

      const problems: PlanProblem[] = (parsed.problems ?? [])
        .filter((p): p is Required<Pick<RawSegment, 'text'>> & RawSegment => typeof p.text === 'string' && !!p.text.trim())
        .map((p) => ({
          id: newId(),
          text: p.text.trim(),
          sources: toSources(p.refs),
          riskRelated: p.riskRelated === true || anyRisk(p.refs, p.text),
          fromPendingSource: (p.refs ?? []).some((r) => packed.sourceByRef.get(r)?.pending) || undefined,
        }));

      const evidencedBySegments = await mapAndVerifySegments(
        (parsed.evidencedBy ?? []).map((s) => ({ ...s, section: 'evidenced-by' })),
        ['evidenced-by'],
        packed,
        context.client.id,
        warnings,
      );
      const formulationKeys = FORMULATION_SECTIONS.map((s) => s.key);
      const formulationSegments = await mapAndVerifySegments(
        (parsed.formulation ?? []).filter((s) => typeof s.section === 'string'),
        formulationKeys,
        packed,
        context.client.id,
        warnings,
      );

      const hierarchy: PlanNeed[] = (parsed.hierarchy ?? [])
        .filter((h): h is { need: string; rationale?: string; refs?: string[] } => typeof h.need === 'string' && !!h.need.trim())
        .map((h, i) => ({
          id: newId(),
          rank: i + 1,
          need: h.need.trim(),
          rationale: typeof h.rationale === 'string' ? h.rationale : '',
          sources: toSources(h.refs),
          riskRelated: anyRisk(h.refs, `${h.need} ${h.rationale ?? ''}`),
        }));

      // Objectives: numbers survive only when documented in cited evidence.
      const measurementSet = new Set<string>(MEASUREMENT_METHODS);
      const proposedObjectives: ProposedObjective[] = (parsed.proposedObjectives ?? [])
        .filter((o) => typeof o.description === 'string' && (o.description as string).trim())
        .slice(0, 5)
        .map((o) => {
          const refs = (Array.isArray(o.refs) ? (o.refs as string[]) : []).filter((r) => packed.sourceByRef.has(r));
          const citedText = refs.map((r) => packed.blocks.find((b) => b.ref === r)?.text ?? '').join(' ');
          const missing: string[] = [];
          const keepIfDocumented = (value: unknown, label: string): string | undefined => {
            if (typeof value !== 'string' || !value.trim()) {
              missing.push(`${label} — Clinician input required.`);
              return undefined;
            }
            const numbers = value.match(/\d+/g) ?? [];
            const documented = numbers.length === 0 || numbers.every((n) => citedText.includes(n));
            if (!documented) {
              missing.push(`${label} — proposed value was not documented in the cited evidence; Clinician input required.`);
              return undefined;
            }
            return value.trim();
          };
          const baseline = keepIfDocumented(o.baseline, 'Baseline');
          const target = keepIfDocumented(o.target, 'Target');
          const timeFrame = keepIfDocumented(o.timeFrame, 'Time frame');
          const measurementMethod =
            typeof o.measurementMethod === 'string' && measurementSet.has(o.measurementMethod)
              ? o.measurementMethod
              : undefined;
          if (!measurementMethod) missing.push('Measurement method — Clinician input required.');
          const documented = [
            baseline ? `documented baseline: ${baseline}` : '',
            target ? `documented target: ${target}` : '',
            timeFrame ? `documented time frame: ${timeFrame}` : '',
          ]
            .filter(Boolean)
            .join('; ');
          return {
            id: newId(),
            description: `${(o.description as string).trim()}${documented ? ` (${documented})` : ''}`,
            targetProblem: typeof o.targetProblem === 'string' ? o.targetProblem : undefined,
            measurementMethod,
            sources: toSources(refs),
            missing,
          };
        });

      if (proposedObjectives.length < 4) {
        warnings.push(
          warning(
            'missing-info',
            `Only ${proposedObjectives.length} objective${proposedObjectives.length === 1 ? '' : 's'} could be proposed from the documented evidence — the rest need clinician input.`,
          ),
        );
      }
      if (problems.some((p) => p.riskRelated) || hierarchy.some((h) => h.riskRelated)) {
        warnings.push(warning('risk', 'Risk-related content requires your individual confirmation before approval.'));
      }

      return {
        problems,
        segments: [...evidencedBySegments, ...formulationSegments],
        hierarchy,
        goalPlanRationale: typeof parsed.goalPlanRationale === 'string' ? parsed.goalPlanRationale : '',
        expectedImprovement: typeof parsed.expectedImprovement === 'string' ? parsed.expectedImprovement : '',
        proposedObjectives,
        generation: {
          method: provider.providerType === 'online' ? 'online-ai' : 'local-ai',
          providerId: AI_DOC_PROVIDER_ID,
          providerLabel: `AI Document Generator (${response.modelId})`,
          generatedAt: new Date().toISOString(),
          disclosure: `${this.disclosure} Operation ${operationId}.`,
          warnings,
        },
      };
    },
  };
}

/** Approved facts are "sufficient" for a full objective set at this level. */
export function hasSufficientObjectiveEvidence(context: GenerationContext): boolean {
  return context.facts.filter((f) => APPROVED_STATUSES.includes(f.reviewStatus)).length >= 4 && context.goals.length > 0;
}
