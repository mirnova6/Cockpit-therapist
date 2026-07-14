/**
 * Context assembler — the enforcement point for source selection.
 *
 * Rules enforced here, independent of the UI:
 *  - Every selected id must belong to the requested client (cross-client
 *    generation is impossible).
 *  - Rejected or superseded facts can NEVER be included.
 *  - Pending facts are excluded unless explicitly listed by the clinician,
 *    and are labeled as pending inside the generation context.
 *  - Risk-related items (facts, risk-flagged inputs/assessments, client risk
 *    status) require the selection's explicit risk confirmation.
 */
import type { ClinicalDatabase } from '../db/database';
import type { SourceSelection } from '../db/documentSchema';
import { APPROVED_STATUSES } from '../db/structuredSchema';
import type { GenerationContext } from './generationTypes';

export class SelectionError extends Error {
  constructor(
    public code:
      | 'cross-client'
      | 'rejected-source'
      | 'pending-not-explicit'
      | 'risk-not-confirmed'
      | 'not-found',
    message: string,
  ) {
    super(message);
  }
}

export async function assembleGenerationContext(
  db: ClinicalDatabase,
  clientId: string,
  docType: 'dap-note' | 'treatment-plan',
  selection: SourceSelection,
  opts: { sessionDate: string; sessionNumber?: number } = { sessionDate: new Date().toISOString().slice(0, 10) },
): Promise<GenerationContext> {
  const client = await db.getClient(clientId);
  if (!client) throw new SelectionError('not-found', 'Client not found');

  // ------------------------------------------------------------- inputs
  const inputs = [];
  for (const id of selection.inputIds) {
    const input = await db.getInput(id);
    if (!input) throw new SelectionError('not-found', `Clinical input ${id} not found`);
    if (input.clientId !== clientId) {
      throw new SelectionError('cross-client', 'Selected input belongs to another client');
    }
    if (input.containsRisk && !selection.riskConfirmed) {
      throw new SelectionError(
        'risk-not-confirmed',
        'A selected input is risk-flagged. Confirm inclusion of risk information before generating.',
      );
    }
    inputs.push(input);
  }

  // -------------------------------------------------------------- facts
  const allFacts = await db.structured.listFacts(clientId);
  const factById = new Map(allFacts.map((f) => [f.id, f]));
  const facts: GenerationContext['facts'] = [];
  for (const id of [...selection.factIds, ...selection.explicitlyIncludedPendingFactIds]) {
    const fact = factById.get(id);
    if (!fact) {
      // Look across ALL clients to distinguish cross-client from missing.
      const foreign = await db.structured.getFact(id);
      if (foreign && foreign.clientId !== clientId) {
        throw new SelectionError('cross-client', 'Selected fact belongs to another client');
      }
      throw new SelectionError('not-found', `Fact ${id} not found`);
    }
    if (fact.reviewStatus === 'rejected' || fact.reviewStatus === 'superseded') {
      throw new SelectionError(
        'rejected-source',
        'Rejected or superseded information cannot be included in documents.',
      );
    }
    const isApproved = APPROVED_STATUSES.includes(fact.reviewStatus);
    if (!isApproved && !selection.explicitlyIncludedPendingFactIds.includes(id)) {
      throw new SelectionError(
        'pending-not-explicit',
        'Pending information is excluded unless explicitly selected by the clinician.',
      );
    }
    if (fact.riskRelated && !selection.riskConfirmed) {
      throw new SelectionError(
        'risk-not-confirmed',
        'A selected fact is risk-related. Confirm inclusion of risk information before generating.',
      );
    }
    if (!facts.some((f) => f.id === fact.id)) {
      facts.push({ ...fact, pendingIncluded: !isApproved });
    }
  }

  // -------------------------------------------------------- assessments
  const allAssessments = await db.structured.listAssessments(clientId);
  const assessmentById = new Map(allAssessments.map((a) => [a.id, a]));
  const assessments = [];
  for (const id of selection.assessmentIds) {
    const record = assessmentById.get(id);
    if (!record) {
      const foreign = await db.structured.getAssessment(id);
      if (foreign && foreign.clientId !== clientId) {
        throw new SelectionError('cross-client', 'Selected assessment belongs to another client');
      }
      throw new SelectionError('not-found', `Assessment ${id} not found`);
    }
    if (record.reviewStatus === 'rejected') {
      throw new SelectionError('rejected-source', 'Rejected assessments cannot be included.');
    }
    if (record.riskFlags.length > 0 && !selection.riskConfirmed) {
      throw new SelectionError(
        'risk-not-confirmed',
        'A selected assessment is risk-flagged. Confirm inclusion of risk information before generating.',
      );
    }
    assessments.push(record);
  }

  // --------------------------------------------------------- hypotheses
  const allHypotheses = await db.structured.listHypotheses(clientId);
  const hypotheses = [];
  for (const id of selection.hypothesisIds) {
    const hypothesis = allHypotheses.find((h) => h.id === id);
    if (!hypothesis) {
      const foreign = await db.structured.getHypothesis(id);
      if (foreign && foreign.clientId !== clientId) {
        throw new SelectionError('cross-client', 'Selected hypothesis belongs to another client');
      }
      throw new SelectionError('not-found', `Hypothesis ${id} not found`);
    }
    if (hypothesis.lifecycleStatus !== 'active') {
      throw new SelectionError('rejected-source', 'Rejected or superseded hypotheses cannot be included.');
    }
    hypotheses.push(hypothesis);
  }

  // -------------------------------------------------------------- goals
  const allGoals = await db.documents.listGoals(clientId);
  const goals = [];
  for (const id of selection.goalIds) {
    const goal = allGoals.find((g) => g.id === id);
    if (!goal) {
      const foreign = await db.documents.getGoal(id);
      if (foreign && foreign.clientId !== clientId) {
        throw new SelectionError('cross-client', 'Selected goal belongs to another client');
      }
      throw new SelectionError('not-found', `Goal ${id} not found`);
    }
    goals.push(goal);
  }

  if (selection.includeRiskStatus && !selection.riskConfirmed) {
    throw new SelectionError(
      'risk-not-confirmed',
      'Including the client risk status requires explicit confirmation.',
    );
  }

  const openGaps = (await db.structured.listGaps(clientId)).filter(
    (g) => g.status === 'open' || g.status === 'in-progress',
  );

  return {
    docType,
    client,
    sessionDate: opts.sessionDate,
    sessionNumber: opts.sessionNumber,
    selection,
    inputs,
    facts,
    assessments,
    assessmentHistory: allAssessments,
    hypotheses,
    goals,
    openGaps,
  };
}
