/**
 * Client-specific clinical assistant (§16).
 *
 * Two honest modes:
 *  - Deterministic (default): retrieval-based answers assembled from the
 *    client's authorized record with citations, contradictions, and an
 *    explicit "no generative model" label. Known question intents (changes
 *    since last session, themes, goal progress, …) get purpose-built
 *    assembly; everything else gets ranked retrieval results.
 *  - AI (local/online provider): the model answers STRICTLY from the same
 *    retrieved evidence; the deterministic verifier then checks every
 *    block, and uncited/unsupported blocks are labeled.
 *
 * The assistant has NO write authority by construction: this service only
 * appends thread messages; "actions" are navigation routes rendered as
 * links from a fixed whitelist. Nothing in model output is ever parsed
 * into a database mutation.
 */
import { runAiTask } from '../ai/aiGateway';
import { activeAiProvider } from '../ai/providerRegistry';
import {
  computeConfidence,
  type AiSettings,
  type ConfidenceLevel,
} from '../ai/aiSchema';
import type { EvidenceBlock, KnowledgeBlock } from '../ai/types';
import { deterministicVerifier, type VerifiableClaim } from '../ai/verification';
import type { ClinicalDatabase } from '../db/database';
import type {
  AssistantAnswer,
  AssistantAnswerBlock,
  AssistantCitation,
  AssistantMessage,
  IntelligenceGeneration,
  KnowledgeCitation,
} from '../db/intelligenceSchema';
import { retrieveKnowledge } from '../knowledge/knowledgeRetrieval';
import {
  retrieveClientEvidence,
  type RetrievedSource,
} from '../rag/clientRetrieval';

export const DETERMINISTIC_ASSISTANT_DISCLOSURE =
  'Retrieval-based answer assembled from this client\'s record without a generative model. Citations link to the exact sources.';

function toCitation(source: RetrievedSource): AssistantCitation {
  return {
    ref: source.ref,
    refType: source.refType,
    refId: source.refId,
    label: source.label,
    date: source.date,
    excerpt: source.text.slice(0, 320),
    sourceLocation: source.sourceLocation,
    approvalStatus: source.approvalStatus,
  };
}

/** Fixed whitelist — assistant "actions" are only ever navigation links. */
function suggestedActionsFor(question: string, clientId: string): Array<{ label: string; route: string }> {
  const q = question.toLowerCase();
  const base = `/clients/${clientId}`;
  const actions: Array<{ label: string; route: string }> = [];
  if (/\bdap\b|\bnote\b/.test(q)) actions.push({ label: 'Open DAP notes (drafting happens there)', route: `${base}/dap` });
  if (/plan/.test(q)) actions.push({ label: 'Open Treatment plan', route: `${base}/plan` });
  if (/goal|progress/.test(q)) actions.push({ label: 'Open Goals & objectives', route: `${base}/goals` });
  if (/assess|score|trend/.test(q)) actions.push({ label: 'Open Assessments', route: `${base}/assessments` });
  if (/risk|safety/.test(q)) actions.push({ label: 'Open Review queue (risk items)', route: `${base}/review` });
  if (/formulation|pattern|theme/.test(q)) actions.push({ label: 'Open Case formulation', route: `${base}/formulation` });
  if (actions.length === 0) actions.push({ label: 'Open Structured profile', route: `${base}/profile` });
  return actions;
}

function confidenceFrom(sources: RetrievedSource[], contradictions: RetrievedSource[]): ConfidenceLevel {
  return computeConfidence({
    supportingSources: sources.length,
    approvedSources: sources.filter((s) => s.approvalStatus === 'approved' || s.approvalStatus === 'edited').length,
    distinctTimePeriods: new Set(sources.map((s) => s.date.slice(0, 7))).size,
    contradictingSources: contradictions.length,
    explicit: true,
  });
}

// ------------------------------------------------- deterministic answering

function deterministicBlocks(sources: RetrievedSource[]): AssistantAnswerBlock[] {
  if (sources.length === 0) {
    return [
      {
        text: 'There is not enough documented information in this client\'s record to answer that. Nothing has been invented to fill the gap.',
        basis: 'insufficient-evidence',
        citedRefs: [],
      },
    ];
  }
  return sources.slice(0, 8).map((source) => ({
    text: `${source.label} (${source.date}): ${source.text.slice(0, 280)}${source.text.length > 280 ? '…' : ''}`,
    basis: source.refType === 'hypothesis' ? 'hypothesis' : 'fact',
    citedRefs: [source.ref],
  }));
}

// ---------------------------------------------------------- AI answering

interface AiAnswerJson {
  blocks?: Array<{ text?: string; basis?: string; refs?: string[] }>;
  followUpQuestions?: string[];
  insufficientEvidence?: boolean;
}

const ASSISTANT_INSTRUCTIONS = `Answer the clinician's question about THIS client using ONLY the supplied evidence blocks.
Return JSON: {"blocks":[{"text":"...","basis":"fact"|"hypothesis"|"general-knowledge"|"insufficient-evidence","refs":["E1"]}],"followUpQuestions":["..."],"insufficientEvidence":boolean}.
Each block must cite the evidence refs it rests on. Facts and hypotheses must be separated into different blocks with the correct basis. If the evidence cannot answer the question, return one insufficient-evidence block saying so. Never diagnose and never make a risk disposition.`;

// ------------------------------------------------------------ main entry

export interface AskAssistantResult {
  clinicianMessage: AssistantMessage;
  assistantMessage: AssistantMessage;
}

export async function askAssistant(
  db: ClinicalDatabase,
  settings: AiSettings,
  clientId: string,
  question: string,
  opts: { onlineSendConfirmed?: boolean; operationToken?: string } = {},
): Promise<AskAssistantResult> {
  const clinicianMessage = await db.intelligence.appendAssistantMessage({
    clientId,
    role: 'clinician',
    text: question,
  });

  const retrieval = await retrieveClientEvidence(db, clientId, question, { limit: 10 });
  const knowledgePassages = await retrieveKnowledge(db.knowledge, 'assistant-answers', question, { limit: 3 });
  const knowledgeUsed: KnowledgeCitation[] = knowledgePassages.map((p) => ({
    sourceId: p.sourceId,
    chunkId: p.chunkId,
    title: p.title,
    citation: p.citation,
    section: p.section,
    page: p.page,
    passage: p.text,
  }));

  const provider = activeAiProvider(settings);
  let blocks: AssistantAnswerBlock[];
  let followUps: string[] = [];
  let generation: IntelligenceGeneration;
  let operationId: string | undefined;

  if (provider.providerType === 'deterministic') {
    blocks = deterministicBlocks(retrieval.sources);
    followUps = retrieval.debug.contradictionsRetrieved
      ? ['How should the retrieved contradiction be resolved — historical change, context, or source error?']
      : [];
    generation = {
      providerType: 'deterministic',
      providerId: 'deterministic',
      generatedAt: new Date().toISOString(),
      disclosure: DETERMINISTIC_ASSISTANT_DISCLOSURE,
    };
  } else {
    const evidence: EvidenceBlock[] = [...retrieval.sources, ...retrieval.contradictions].map((s) => ({
      ref: s.ref,
      refType: s.refType,
      refId: s.refId,
      clientId: s.clientId,
      date: s.date,
      label: s.label,
      approvalStatus: s.approvalStatus,
      text: s.text,
    }));
    const knowledge: KnowledgeBlock[] = knowledgePassages.map((p, i) => ({
      ref: `K${i + 1}`,
      sourceId: p.sourceId,
      chunkId: p.chunkId,
      title: p.title,
      citation: p.citation,
      section: p.section,
      page: p.page,
      text: p.text,
    }));
    const sourceInputs = retrieval.sources
      .filter((s) => s.inputId)
      .map((s) => ({
        id: s.inputId!,
        allowAiAnalysis: s.allowAiAnalysis ?? true,
        localOnly: s.localOnly ?? false,
      }));

    const { response, operationId: opId } = await runAiTask({
      db,
      settings,
      provider,
      clientId,
      capability: 'question-answering',
      instructions: ASSISTANT_INSTRUCTIONS,
      clinicianCommand: question,
      clientEvidence: evidence,
      knowledgePassages: knowledge,
      expectJson: true,
      sourceInputs,
      onlineSendConfirmed: opts.onlineSendConfirmed,
      operationToken: opts.operationToken,
    });
    operationId = opId;

    const parsed = (response.json ?? {}) as AiAnswerJson;
    const validRefs = new Set([...evidence.map((e) => e.ref), ...knowledge.map((k) => k.ref)]);
    const rawBlocks = (parsed.blocks ?? []).filter((b) => typeof b.text === 'string' && b.text.trim());

    // Separate verification pass — the generator never verifies itself.
    const claims: VerifiableClaim[] = rawBlocks.map((b, i) => ({
      id: `block-${i}`,
      text: b.text!,
      citedRefs: (b.refs ?? []).filter((r) => validRefs.has(r)),
      kind: 'factual',
    }));
    const verdicts = await deterministicVerifier.verify(claims, {
      clientId,
      evidence,
      knowledge,
      contradictions: retrieval.contradictions.map((c) => ({ ref: c.ref, text: c.text })),
    });

    blocks = rawBlocks.map((b, i) => {
      const verdict = verdicts[i];
      const basis =
        b.basis === 'hypothesis' || verdict.status === 'supported-by-hypothesis'
          ? 'hypothesis'
          : b.basis === 'general-knowledge' || verdict.status === 'general-clinical-guidance'
            ? 'general-knowledge'
            : b.basis === 'insufficient-evidence'
              ? 'insufficient-evidence'
              : 'fact';
      const flagged =
        verdict.status === 'unsupported' || verdict.status === 'contradicted' || verdict.status === 'needs-clarification';
      return {
        text: flagged ? `${b.text} [Verification: ${verdict.status.replace(/-/g, ' ')} — ${verdict.note}]` : b.text!,
        basis,
        citedRefs: verdict.verifiedRefs.length > 0 ? verdict.verifiedRefs : (b.refs ?? []).filter((r) => validRefs.has(r)),
      };
    });
    if (blocks.length === 0) blocks = deterministicBlocks(retrieval.sources);
    followUps = (parsed.followUpQuestions ?? []).filter((q) => typeof q === 'string').slice(0, 4);
    generation = {
      providerType: provider.providerType,
      providerId: provider.id,
      modelId: response.modelId,
      generatedAt: new Date().toISOString(),
      disclosure:
        provider.providerType === 'online'
          ? 'Answer generated by the configured online AI provider from the cited evidence only, then checked by the deterministic verifier. Consented content left this device for processing.'
          : 'Answer generated by the configured local AI model from the cited evidence only, then checked by the deterministic verifier. Processing stayed local.',
      operationId,
    };
  }

  const insufficientEvidence = blocks.every((b) => b.basis === 'insufficient-evidence');
  const answer: AssistantAnswer = {
    blocks,
    clientEvidence: retrieval.sources.map(toCitation),
    knowledgeUsed,
    confidence: insufficientEvidence
      ? 'insufficient-evidence'
      : confidenceFrom(retrieval.sources, retrieval.contradictions),
    contradictions: retrieval.contradictions.map(toCitation),
    followUpQuestions: followUps,
    suggestedActions: suggestedActionsFor(question, clientId),
    insufficientEvidence,
  };

  const assistantMessage = await db.intelligence.appendAssistantMessage({
    clientId,
    role: 'assistant',
    text: blocks.map((b) => b.text).join('\n\n'),
    answer,
    retrievalDebug: retrieval.debug,
    generation,
  });

  return { clinicianMessage, assistantMessage };
}
