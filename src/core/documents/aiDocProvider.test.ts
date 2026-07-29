import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AuthService } from '../auth/authService';
import type { ClinicalDatabase } from '../db/database';
import {
  FakeAIProvider,
  approvedFact,
  localSettings,
  makeClient,
  makeInput,
  makeTestDb,
} from '../ai/phase4TestUtils';
import { EMPTY_SELECTION, isUnsupportedSegment } from '../db/documentSchema';
import { assembleGenerationContext } from './contextAssembler';
import { createAiDocumentProvider } from './aiDocProvider';

let auth: AuthService;
let db: ClinicalDatabase;
let fake: FakeAIProvider;

beforeEach(async () => {
  ({ auth, db } = await makeTestDb('test-aidoc'));
  fake = new FakeAIProvider('local');
});

afterEach(async () => {
  await auth.close();
});

function provider() {
  return createAiDocumentProvider(() => ({ db, settings: localSettings(), provider: fake }));
}

async function setupClient() {
  const client = await makeClient(db, 'A');
  const input = await makeInput(db, client.id, 'Client reported using the breathing skill during a work conflict. PHQ-9 completed.');
  const fact = await approvedFact(db, client.id, input.id, 'coping-strategy', 'Used breathing skill during a work conflict');
  const goal = await db.documents.createGoal(
    {
      clientId: client.id,
      kind: 'short-term',
      title: 'Increase use of regulation skills',
      status: 'active',
      objectives: [],
    },
    'Dr. Kim',
  );
  return { client, input, fact, goal };
}

describe('AI DAP generation through the existing provider seam', () => {
  it('maps cited refs to real evidence sources and keeps DAP sections', async () => {
    const { client, input, fact, goal } = await setupClient();
    const context = await assembleGenerationContext(
      db,
      client.id,
      'dap-note',
      { ...EMPTY_SELECTION, inputIds: [input.id], factIds: [fact.id], goalIds: [goal.id] },
      { sessionDate: '2026-07-10' },
    );
    fake.queue({
      segments: [
        { section: 'data', text: 'Client reported using the breathing skill during a work conflict.', kind: 'factual', refs: ['E1'] },
        { section: 'assessment', text: 'Skill use in a real conflict suggests progress toward the regulation goal.', kind: 'interpretive', refs: ['E2', 'E3'] },
        { section: 'plan', text: 'Continue rehearsing regulation skills between sessions.', kind: 'factual', refs: ['E3'] },
      ],
    });
    const result = await provider().generateDapNote(context);
    expect(result.segments).toHaveLength(3);
    expect(new Set(result.segments.map((s) => s.section))).toEqual(new Set(['data', 'assessment', 'plan']));
    expect(result.segments[0].sources[0].refType).toBe('input');
    expect(result.segments[0].verification?.status).toBe('directly-supported');
    expect(result.generation.method).toBe('local-ai');
    expect(result.generation.providerLabel).toContain('fake-model');
  });

  it('flags invented mental-status observations as unsupported instead of keeping them silently', async () => {
    const { client, input } = await setupClient();
    const context = await assembleGenerationContext(
      db,
      client.id,
      'dap-note',
      { ...EMPTY_SELECTION, inputIds: [input.id] },
      { sessionDate: '2026-07-10' },
    );
    fake.queue({
      segments: [
        { section: 'data', text: 'Client appeared disheveled with flat affect and psychomotor retardation.', kind: 'factual', refs: [] },
      ],
    });
    const result = await provider().generateDapNote(context);
    expect(isUnsupportedSegment(result.segments[0])).toBe(true);
    expect(result.segments[0].verification?.status).toBe('unsupported');
    expect(result.generation.warnings.some((w) => w.kind === 'unsupported')).toBe(true);
  });

  it('hypothesis citations force interpretive kind with an explicit label', async () => {
    const { client, input } = await setupClient();
    await db.structured.createHypothesis(
      {
        clientId: client.id,
        category: 'defense-mechanism',
        statement: 'Client may use humor to deflect from painful topics',
        confidence: 'moderate-support',
        alternativeExplanations: [],
        missingInformation: [],
        questionsToAssess: [],
      },
      'Dr. Kim',
    );
    const hypotheses = await db.structured.listHypotheses(client.id);
    const context = await assembleGenerationContext(
      db,
      client.id,
      'dap-note',
      { ...EMPTY_SELECTION, inputIds: [input.id], hypothesisIds: [hypotheses[0].id] },
      { sessionDate: '2026-07-10' },
    );
    fake.queue({
      segments: [
        { section: 'assessment', text: 'The client uses humor to deflect from painful topics.', kind: 'factual', refs: ['E2'] },
      ],
    });
    const result = await provider().generateDapNote(context);
    expect(result.segments[0].kind).toBe('interpretive');
    expect(result.segments[0].text).toContain('Working hypothesis (not established fact)');
  });

  it('risk language forces riskRelated so Phase 3 approval gating applies unchanged', async () => {
    const { client, input } = await setupClient();
    const context = await assembleGenerationContext(
      db,
      client.id,
      'dap-note',
      { ...EMPTY_SELECTION, inputIds: [input.id] },
      { sessionDate: '2026-07-10' },
    );
    fake.queue({
      segments: [
        { section: 'data', text: 'Client denied suicidal ideation this week.', kind: 'factual', refs: ['E1'], riskRelated: false },
      ],
    });
    const result = await provider().generateDapNote(context);
    expect(result.segments[0].riskRelated).toBe(true);
    const note = await db.documents.createDapNote(
      {
        clientId: client.id,
        sessionDate: '2026-07-10',
        levelOfCare: 'outpatient',
        style: 'standard',
        segments: result.segments,
        sourceSelection: { ...EMPTY_SELECTION, inputIds: [input.id] },
        generation: result.generation,
      },
      'Dr. Kim',
    );
    await expect(db.documents.decideDapNote(note.id, 'approve', 'Dr. Kim')).rejects.toThrow(/risk/i);
  });
});

describe('AI treatment-plan generation', () => {
  it('never keeps invented numbers: undocumented baselines/targets become clinician-input gaps', async () => {
    const { client, input, fact, goal } = await setupClient();
    const context = await assembleGenerationContext(
      db,
      client.id,
      'treatment-plan',
      { ...EMPTY_SELECTION, inputIds: [input.id], factIds: [fact.id], goalIds: [goal.id] },
      { sessionDate: '2026-07-10' },
    );
    fake.queue({
      problems: [{ text: 'Difficulty regulating emotion in interpersonal conflict.', refs: ['E2'] }],
      evidencedBy: [{ text: 'Client used the breathing skill during a work conflict.', refs: ['E1'] }],
      formulation: [{ section: 'formulation:current', text: 'Regulation skills are emerging.', refs: ['E2'] }],
      hierarchy: [{ need: 'Emotion-regulation skill consolidation', rationale: 'Documented skill use', refs: ['E2'] }],
      goalPlanRationale: 'Build on documented skill use.',
      expectedImprovement: 'More frequent skill use in conflicts.',
      proposedObjectives: [
        {
          description: 'Use a regulation skill during conflict situations',
          targetProblem: 'Emotion regulation',
          measurementMethod: 'Frequency log / diary card',
          baseline: '2 times per week', // NOT documented anywhere in evidence
          target: '5 times per week', // NOT documented
          timeFrame: '90 days', // NOT documented
          refs: ['E2'],
        },
      ],
    });
    const result = await provider().generateTreatmentPlan(context);
    const objective = result.proposedObjectives[0];
    expect(objective.description).not.toContain('2 times per week');
    expect(objective.missing.join(' ')).toContain('Baseline');
    expect(objective.missing.join(' ')).toContain('Clinician input required');
    expect(objective.missing.join(' ')).toContain('Target');
    expect(result.generation.warnings.some((w) => w.kind === 'missing-info')).toBe(true);
  });

  it('screening scores stay labeled as screening results, never diagnoses', async () => {
    const { client, input } = await setupClient();
    await db.structured.createAssessment(
      { clientId: client.id, definitionKey: 'phq9', name: 'PHQ-9', dateAdministered: '2026-07-01', totalScore: 15 },
      'Dr. Kim',
    );
    const assessments = await db.structured.listAssessments(client.id);
    const context = await assembleGenerationContext(
      db,
      client.id,
      'treatment-plan',
      { ...EMPTY_SELECTION, inputIds: [input.id], assessmentIds: [assessments[0].id] },
      { sessionDate: '2026-07-10' },
    );
    // The evidence block itself carries the guard text the model must echo.
    const packedEvidence = fake;
    fake.queue({
      problems: [{ text: 'Client has Major Depressive Disorder based on PHQ-9 of 15.', refs: ['E2'] }],
      evidencedBy: [],
      formulation: [],
      hierarchy: [],
      goalPlanRationale: '',
      expectedImprovement: '',
      proposedObjectives: [],
    });
    const result = await provider().generateTreatmentPlan(context);
    void packedEvidence;
    // The problem cites the assessment; the assessment evidence text carries
    // "Screening result, not a diagnosis" — visible in the evidence drawer.
    const source = result.problems[0].sources.find((s) => s.refType === 'assessment');
    expect(source).toBeDefined();
    expect(source!.excerpt).toContain('Screening result, not a diagnosis');
  });
});
