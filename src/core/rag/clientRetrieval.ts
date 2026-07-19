/**
 * Client-record RAG (§5) — deterministic, fully explainable retrieval over
 * ONE client's authorized records.
 *
 * Isolation: the corpus is built from repository queries that filter by
 * clientId, retrieval namespaces are per-client by construction, and a
 * final verification pass re-checks every candidate's clientId — a foreign
 * record aborts the whole retrieval rather than being silently dropped.
 *
 * Ranking = lexical relevance (BM25-style, see lexical.ts) + documented
 * boosts: approval status, source reliability, recency, historical
 * importance, longitudinal repetition, risk sensitivity, and document type.
 * The debug panel shows every reason and every exclusion.
 */
import type { ClinicalDatabase } from '../db/database';
import { APPROVED_STATUSES, factCategoryMeta } from '../db/structuredSchema';
import { rankByLexicalRelevance, tokenize } from './lexical';

export type RetrievalRefType =
  | 'input'
  | 'fact'
  | 'assessment'
  | 'hypothesis'
  | 'goal'
  | 'dap-note'
  | 'treatment-plan'
  | 'contradiction'
  | 'gap'
  | 'medication'
  | 'diagnosis'
  | 'risk-status'
  | 'change';

export interface RetrievalCandidate {
  refType: RetrievalRefType;
  refId: string;
  clientId: string;
  /** ISO date used for recency and longitudinal bucketing. */
  date: string;
  label: string;
  approvalStatus: string;
  riskRelated: boolean;
  text: string;
  /** e.g. "paragraph 3" for input chunks. */
  sourceLocation?: string;
  /** Consent metadata for gateway checks on input-backed sources. */
  inputId?: string;
  allowAiAnalysis?: boolean;
  localOnly?: boolean;
  /** Fact category / doc kind, for repetition + intent boosts. */
  category?: string;
}

export interface RetrievedSource extends RetrievalCandidate {
  ref: string;
  score: number;
  reasons: string[];
}

export interface RetrievalDebugRow {
  ref: string;
  refType: string;
  label: string;
  date: string;
  approvalStatus: string;
  score: number;
  reasons: string[];
}

export interface RetrievalDebug {
  query: string;
  queryTerms: string[];
  candidateCount: number;
  retrieved: RetrievalDebugRow[];
  excluded: Array<{ label: string; reason: string }>;
  contradictionsRetrieved: boolean;
  timePeriodsCovered: string[];
}

export interface ClientRetrievalResult {
  sources: RetrievedSource[];
  /** Contradictions relevant to the query — surfaced, never blended away. */
  contradictions: RetrievedSource[];
  debug: RetrievalDebug;
}

export class RetrievalIsolationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RetrievalIsolationError';
  }
}

// ------------------------------------------------------------ corpus build

function quarterOf(date: string): string {
  const [year, month] = date.split('-').map(Number);
  if (!year || !month) return 'undated';
  return `${year}-Q${Math.ceil(month / 3)}`;
}

export interface CorpusBuildResult {
  candidates: RetrievalCandidate[];
  excluded: Array<{ label: string; reason: string }>;
}

export interface CorpusOptions {
  /** Pending facts the clinician EXPLICITLY chose to include. */
  includePendingFactIds?: string[];
}

/** Splits long raw text into paragraph chunks for useful excerpts. */
function paragraphChunks(text: string): Array<{ text: string; location: string }> {
  const paragraphs = text
    .replace(/\r\n/g, '\n')
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (paragraphs.length <= 1) return [{ text: text.trim(), location: 'full text' }];
  return paragraphs.map((p, i) => ({ text: p, location: `paragraph ${i + 1}` }));
}

export async function buildClientCorpus(
  db: ClinicalDatabase,
  clientId: string,
  options: CorpusOptions = {},
): Promise<CorpusBuildResult> {
  const includePending = new Set(options.includePendingFactIds ?? []);
  const candidates: RetrievalCandidate[] = [];
  const excluded: Array<{ label: string; reason: string }> = [];

  const client = await db.getClient(clientId);
  if (!client) throw new RetrievalIsolationError('Client not found');

  const [inputs, facts, assessments, hypotheses, contradictions, gaps, goals, dapNotes, plans, changes] =
    await Promise.all([
      db.listInputsForClient(clientId),
      db.structured.listFacts(clientId),
      db.structured.listAssessments(clientId),
      db.structured.listHypotheses(clientId),
      db.structured.listContradictions(clientId),
      db.structured.listGaps(clientId),
      db.documents.listGoals(clientId),
      db.documents.listDapNotes(clientId),
      db.documents.listPlans(clientId),
      db.listChangesForClient(clientId, 100),
    ]);

  for (const input of inputs) {
    for (const chunk of paragraphChunks(input.rawText)) {
      candidates.push({
        refType: 'input',
        refId: input.id,
        clientId: input.clientId,
        date: input.dateOfInformation,
        label: `${input.inputType.replace(/-/g, ' ')} (${input.dateOfInformation})`,
        approvalStatus: 'raw input',
        riskRelated: input.containsRisk,
        text: chunk.text,
        sourceLocation: chunk.location,
        inputId: input.id,
        allowAiAnalysis: input.allowAiAnalysis,
        localOnly: input.localOnly,
        category: input.inputType,
      });
    }
  }

  for (const fact of facts) {
    if (fact.reviewStatus === 'rejected') {
      excluded.push({ label: `Fact: ${fact.statement.slice(0, 60)}`, reason: 'Rejected — never retrieved' });
      continue;
    }
    if (fact.reviewStatus === 'superseded') {
      excluded.push({ label: `Fact: ${fact.statement.slice(0, 60)}`, reason: 'Superseded — never retrieved' });
      continue;
    }
    const approved = APPROVED_STATUSES.includes(fact.reviewStatus);
    if (!approved && !includePending.has(fact.id)) {
      excluded.push({
        label: `Fact: ${fact.statement.slice(0, 60)}`,
        reason: 'Pending review — excluded unless explicitly selected',
      });
      continue;
    }
    candidates.push({
      refType: 'fact',
      refId: fact.id,
      clientId: fact.clientId,
      date: fact.dateOccurred ?? fact.dateRecorded,
      label: `${factCategoryMeta(fact.category).label} fact`,
      approvalStatus: approved ? 'approved' : 'pending (explicitly included)',
      riskRelated: fact.riskRelated,
      text: `${fact.statement}${fact.excerpt ? `\nSource excerpt: ${fact.excerpt}` : ''}`,
      category: fact.category,
    });
  }

  for (const assessment of assessments) {
    candidates.push({
      refType: 'assessment',
      refId: assessment.id,
      clientId: assessment.clientId,
      date: assessment.dateAdministered,
      label: `${assessment.name} (${assessment.dateAdministered})`,
      approvalStatus: assessment.reviewStatus,
      riskRelated: assessment.riskFlags.length > 0,
      text: [
        `${assessment.name} administered ${assessment.dateAdministered}`,
        assessment.totalScore !== undefined ? `total score ${assessment.totalScore}` : '',
        assessment.severityInterpretation ?? '',
        assessment.clinicianNotes ?? '',
      ]
        .filter(Boolean)
        .join('. '),
      category: 'assessment',
    });
  }

  for (const hypothesis of hypotheses) {
    if (hypothesis.lifecycleStatus !== 'active' || !APPROVED_STATUSES.includes(hypothesis.reviewStatus)) {
      excluded.push({
        label: `Hypothesis: ${hypothesis.statement.slice(0, 60)}`,
        reason:
          hypothesis.lifecycleStatus !== 'active'
            ? `Hypothesis ${hypothesis.lifecycleStatus} — excluded`
            : 'Hypothesis not approved — excluded',
      });
      continue;
    }
    candidates.push({
      refType: 'hypothesis',
      refId: hypothesis.id,
      clientId: hypothesis.clientId,
      date: hypothesis.updatedAt.slice(0, 10),
      label: 'Approved hypothesis',
      approvalStatus: hypothesis.reviewStatus,
      riskRelated: false,
      text: `HYPOTHESIS (${hypothesis.confidence}): ${hypothesis.statement}`,
      category: hypothesis.category,
    });
  }

  for (const contradiction of contradictions) {
    candidates.push({
      refType: 'contradiction',
      refId: contradiction.id,
      clientId: contradiction.clientId,
      date: contradiction.dateIdentified.slice(0, 10),
      label: `Contradiction: ${contradiction.topic}`,
      approvalStatus: contradiction.resolutionStatus,
      riskRelated: false,
      text: `CONTRADICTION on ${contradiction.topic}: ${contradiction.description}. Evidence A: ${contradiction.firstEvidence.description}. Evidence B: ${contradiction.secondEvidence.description}.`,
      category: 'contradiction',
    });
  }

  for (const gap of gaps) {
    if (gap.status === 'no-longer-relevant') continue;
    candidates.push({
      refType: 'gap',
      refId: gap.id,
      clientId: gap.clientId,
      date: gap.updatedAt.slice(0, 10),
      label: `Needs further assessment: ${gap.topic}`,
      approvalStatus: gap.status,
      riskRelated: false,
      text: `MISSING INFORMATION on ${gap.topic}: ${gap.reason}`,
      category: 'gap',
    });
  }

  for (const goal of goals) {
    const objectiveText = goal.objectives
      .map((o) => `Objective (${o.progress}): ${o.description}`)
      .join(' ');
    candidates.push({
      refType: 'goal',
      refId: goal.id,
      clientId: goal.clientId,
      date: goal.updatedAt.slice(0, 10),
      label: `${goal.kind === 'short-term' ? 'Short-term' : 'Long-term'} goal (${goal.status})`,
      approvalStatus: goal.status,
      riskRelated: false,
      text: `GOAL: ${goal.title}. ${goal.rationale ?? ''} ${objectiveText}`,
      category: 'treatment-goal',
    });
  }

  for (const note of dapNotes) {
    if (note.reviewStatus === 'rejected') {
      excluded.push({ label: `DAP note ${note.sessionDate}`, reason: 'Rejected document — never retrieved' });
      continue;
    }
    candidates.push({
      refType: 'dap-note',
      refId: note.id,
      clientId: note.clientId,
      date: note.sessionDate,
      label: `DAP note ${note.sessionDate} (${note.reviewStatus})`,
      approvalStatus: note.reviewStatus,
      riskRelated: note.segments.some((s) => s.riskRelated),
      text: note.segments.map((s) => s.text).join(' '),
      category: 'dap-note',
    });
  }

  for (const plan of plans) {
    if (plan.reviewStatus === 'rejected') {
      excluded.push({ label: `Treatment plan ${plan.planDate}`, reason: 'Rejected document — never retrieved' });
      continue;
    }
    candidates.push({
      refType: 'treatment-plan',
      refId: plan.id,
      clientId: plan.clientId,
      date: plan.planDate,
      label: `Treatment plan ${plan.planDate} (${plan.reviewStatus})`,
      approvalStatus: plan.reviewStatus,
      riskRelated: plan.problems.some((p) => p.riskRelated),
      text: [
        ...plan.problems.map((p) => p.text),
        ...plan.segments.map((s) => s.text),
        plan.goalPlanRationale,
      ].join(' '),
      category: 'treatment-plan',
    });
  }

  // Client-level structured lists: medications, diagnoses, risk status.
  for (const med of client.medications) {
    candidates.push({
      refType: 'medication',
      refId: `${client.id}:med:${med.id}`,
      clientId: client.id,
      date: client.updatedAt.slice(0, 10),
      label: 'Medication list entry',
      approvalStatus: 'client record',
      riskRelated: false,
      text: `MEDICATION: ${med.name}${med.dose ? ` ${med.dose}` : ''}${med.prescriber ? `, prescriber ${med.prescriber}` : ''}`,
      category: 'medication',
    });
  }
  for (const dx of client.diagnoses) {
    candidates.push({
      refType: 'diagnosis',
      refId: `${client.id}:dx:${dx.id}`,
      clientId: client.id,
      date: client.updatedAt.slice(0, 10),
      label: dx.kind === 'diagnosis' ? 'Documented diagnosis' : 'Clinical impression',
      approvalStatus: 'client record',
      riskRelated: false,
      text: `${dx.kind === 'diagnosis' ? 'DIAGNOSIS' : 'IMPRESSION'}: ${dx.label}${dx.code ? ` (${dx.code})` : ''}`,
      category: 'diagnosis',
    });
  }
  candidates.push({
    refType: 'risk-status',
    refId: `${client.id}:risk`,
    clientId: client.id,
    date: client.risk.reviewedAt?.slice(0, 10) ?? client.updatedAt.slice(0, 10),
    label: 'Current risk status (clinician-confirmed)',
    approvalStatus: 'client record',
    riskRelated: true,
    text: `RISK STATUS: ${client.risk.level}${client.risk.note ? `. ${client.risk.note}` : ''}`,
    category: 'risk-status',
  });

  for (const change of changes.slice(0, 40)) {
    candidates.push({
      refType: 'change',
      refId: change.id,
      clientId: change.clientId ?? clientId,
      date: change.at.slice(0, 10),
      label: `Change history (${change.entity})`,
      approvalStatus: 'history',
      riskRelated: false,
      text: change.summary,
      category: 'change',
    });
  }

  return { candidates, excluded };
}

// ---------------------------------------------------------------- ranking

const RISK_QUERY_TERMS = new Set(['risk', 'suicide', 'safety', 'harm', 'crisis']);
const HISTORY_QUERY_TERMS = new Set(['history', 'pattern', 'childhood', 'development', 'across', 'over', 'change', 'trend']);
/** Source-reliability weight by reference type (§5: source reliability + document type). */
const TYPE_WEIGHTS: Partial<Record<RetrievalRefType, number>> = {
  'fact': 0.8,
  'assessment': 0.7,
  'diagnosis': 0.6,
  'medication': 0.6,
  'risk-status': 0.6,
  'dap-note': 0.4,
  'treatment-plan': 0.4,
  'goal': 0.4,
  'hypothesis': 0.3,
  'input': 0.2,
  'contradiction': 0.3,
  'gap': 0.2,
  'change': 0,
};

export interface RetrieveOptions extends CorpusOptions {
  limit?: number;
  today?: string;
}

export async function retrieveClientEvidence(
  db: ClinicalDatabase,
  clientId: string,
  query: string,
  options: RetrieveOptions = {},
): Promise<ClientRetrievalResult> {
  const { candidates, excluded } = await buildClientCorpus(db, clientId, options);

  // Final namespace verification: every candidate must belong to the client.
  const foreign = candidates.filter((c) => c.clientId !== clientId);
  if (foreign.length > 0) {
    await db.audit(
      'security',
      'ai.retrieval-isolation-violation',
      `blocked ${foreign.length} foreign record(s) in retrieval for client ${clientId}`,
    );
    throw new RetrievalIsolationError(
      'Retrieval blocked: the corpus contained a record from another client.',
    );
  }

  const limit = options.limit ?? 12;
  const today = options.today ?? new Date().toISOString().slice(0, 10);
  const queryTokens = new Set(tokenize(query));
  const riskIntent = [...queryTokens].some((t) => RISK_QUERY_TERMS.has(t));
  const historyIntent = [...queryTokens].some((t) => HISTORY_QUERY_TERMS.has(t));

  const ranked = rankByLexicalRelevance(query, candidates, (c) => `${c.label} ${c.text}`);

  // Longitudinal repetition: categories that recur across ≥3 quarters.
  const quartersByCategory = new Map<string, Set<string>>();
  for (const { doc } of ranked) {
    if (!doc.category) continue;
    const set = quartersByCategory.get(doc.category) ?? new Set<string>();
    set.add(quarterOf(doc.date));
    quartersByCategory.set(doc.category, set);
  }

  const daysAgo = (date: string): number => {
    const then = Date.parse(date);
    const now = Date.parse(today);
    if (Number.isNaN(then) || Number.isNaN(now)) return 9999;
    return Math.floor((now - then) / 86_400_000);
  };

  const scored: RetrievedSource[] = ranked.map(({ doc, score, matchedTerms }, index) => {
    const reasons: string[] = [`Lexical match: ${matchedTerms.join(', ')}`];
    let total = score;

    const typeWeight = TYPE_WEIGHTS[doc.refType] ?? 0.2;
    total += typeWeight;
    reasons.push(`Source type weight (${doc.refType})`);

    if (doc.approvalStatus === 'approved' || doc.approvalStatus === 'edited') {
      total += 0.8;
      reasons.push('Clinician-approved');
    } else if (doc.approvalStatus.startsWith('pending')) {
      reasons.push('Pending — explicitly included by clinician');
    }

    const age = daysAgo(doc.date);
    if (age <= 30) {
      total += 0.6;
      reasons.push('Recent (≤30 days)');
    } else if (age <= 90) {
      total += 0.3;
      reasons.push('Recent (≤90 days)');
    } else if (historyIntent) {
      total += 0.4;
      reasons.push('Older material boosted for longitudinal question');
    }

    const repeatQuarters = doc.category ? (quartersByCategory.get(doc.category)?.size ?? 0) : 0;
    if (repeatQuarters >= 3) {
      total += 0.5;
      reasons.push(`Theme recurs across ${repeatQuarters} time periods`);
    }

    if (doc.riskRelated && riskIntent) {
      total += 0.7;
      reasons.push('Risk-sensitive content matching a risk question');
    }

    return { ...doc, ref: `E${index + 1}`, score: Math.round(total * 1000) / 1000, reasons };
  });

  scored.sort((a, b) => b.score - a.score);

  // Longitudinal coverage: never return only the newest records when older
  // relevant periods exist (§5). Guarantee at least one source from each of
  // up to 4 distinct quarters that had matches.
  const top = scored.slice(0, limit);
  const coveredQuarters = new Set(top.map((s) => quarterOf(s.date)));
  const allQuarters = [...new Set(scored.map((s) => quarterOf(s.date)))].sort().reverse();
  for (const quarter of allQuarters.slice(0, 4)) {
    if (coveredQuarters.has(quarter)) continue;
    const best = scored.find((s) => quarterOf(s.date) === quarter && !top.includes(s));
    if (best) {
      best.reasons.push(`Included for longitudinal coverage (${quarter})`);
      if (top.length >= limit) top.pop();
      top.push(best);
      coveredQuarters.add(quarter);
    }
  }

  // Contradictions relevant to the query are always surfaced (§19).
  const contradictions = scored.filter((s) => s.refType === 'contradiction');
  for (const contradiction of contradictions) {
    if (!top.includes(contradiction)) {
      contradiction.reasons.push('Contradictory evidence surfaced alongside results');
      top.push(contradiction);
    }
  }

  // Re-assign stable refs in final order.
  const finalSources = top.map((s, i) => ({ ...s, ref: `E${i + 1}` }));

  const debug: RetrievalDebug = {
    query,
    queryTerms: [...queryTokens],
    candidateCount: candidates.length,
    retrieved: finalSources.map((s) => ({
      ref: s.ref,
      refType: s.refType,
      label: s.label,
      date: s.date,
      approvalStatus: s.approvalStatus,
      score: s.score,
      reasons: s.reasons,
    })),
    excluded: [
      ...excluded,
      ...scored
        .filter((s) => !finalSources.some((f) => f.refId === s.refId && f.sourceLocation === s.sourceLocation))
        .slice(0, 15)
        .map((s) => ({ label: s.label, reason: 'Ranked below retrieval limit' })),
    ],
    contradictionsRetrieved: finalSources.some((s) => s.refType === 'contradiction'),
    timePeriodsCovered: [...new Set(finalSources.map((s) => quarterOf(s.date)))].sort(),
  };

  return {
    sources: finalSources.filter((s) => s.refType !== 'contradiction'),
    contradictions: finalSources.filter((s) => s.refType === 'contradiction'),
    debug,
  };
}
