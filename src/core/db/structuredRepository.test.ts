import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AuthService } from '../auth/authService';
import type { ClinicalDatabase } from './database';
import type { FactDraft } from './structuredRepository';
import { APPROVED_STATUSES } from './structuredSchema';

let counter = 0;
let auth: AuthService;
let db: ClinicalDatabase;

beforeEach(async () => {
  auth = new AuthService({ dbName: `test-p2-${Date.now()}-${counter++}`, iterations: 1000 });
  db = await auth.setup({ name: 'Dr. Kim', passphrase: 'test-passphrase-1' });
});

afterEach(async () => {
  await auth.close();
});

async function makeClient(name: string) {
  return db.createClient(
    {
      displayName: name,
      contactEnabled: false,
      levelOfCare: 'outpatient',
      status: 'active',
      diagnoses: [],
      medications: [],
      risk: { level: 'not-assessed' },
    },
    'Dr. Kim',
  );
}

async function makeInput(clientId: string, rawText = 'Client reports poor sleep.') {
  return db.createInput(
    {
      clientId,
      inputType: 'rough-notes',
      dateOfInformation: '2026-07-10',
      rawText,
      authorSource: 'Dr. Kim',
      reportedBy: 'therapist-entered',
      containsRisk: false,
      allowAiAnalysis: true,
      localOnly: true,
    },
    [],
    'Dr. Kim',
  );
}

function factDraft(clientId: string, sourceInputId: string, overrides: Partial<FactDraft> = {}): FactDraft {
  return {
    clientId,
    sourceInputId,
    sourceInputVersion: 1,
    category: 'sleep',
    statement: 'Client reports poor sleep.',
    excerpt: 'Client reports poor sleep.',
    dateRecorded: '2026-07-10',
    classification: 'client-report',
    extractionMethod: 'rule-based',
    extractionConfidence: 'moderate',
    temporalStatus: 'current',
    riskRelated: false,
    ...overrides,
  };
}

describe('StructuredRepository — isolation', () => {
  it('facts, assessments, and hypotheses stay with the correct client', async () => {
    const a = await makeClient('A');
    const b = await makeClient('B');
    const inputA = await makeInput(a.id);
    const inputB = await makeInput(b.id);

    await db.structured.createFact(factDraft(a.id, inputA.id, { statement: 'Alpha fact' }), 'Dr. Kim');
    await db.structured.createFact(factDraft(b.id, inputB.id, { statement: 'Beta fact' }), 'Dr. Kim');
    await db.structured.createAssessment(
      { clientId: a.id, definitionKey: 'phq9', name: 'PHQ-9', dateAdministered: '2026-07-01', totalScore: 8 },
      'Dr. Kim',
    );
    await db.structured.createHypothesis(
      {
        clientId: b.id,
        category: 'relational-pattern',
        statement: 'Beta hypothesis',
        confidence: 'low-support',
        alternativeExplanations: [],
        missingInformation: [],
        questionsToAssess: [],
      },
      'Dr. Kim',
    );

    expect((await db.structured.listFacts(a.id)).map((f) => f.statement)).toEqual(['Alpha fact']);
    expect((await db.structured.listFacts(b.id)).map((f) => f.statement)).toEqual(['Beta fact']);
    expect(await db.structured.listAssessments(b.id)).toHaveLength(0);
    expect(await db.structured.listHypotheses(a.id)).toHaveLength(0);
  });

  it('rejects cross-client evidence links at the repository level', async () => {
    const a = await makeClient('A');
    const b = await makeClient('B');
    const inputA = await makeInput(a.id);
    const inputB = await makeInput(b.id);
    const factA = await db.structured.createFact(factDraft(a.id, inputA.id), 'Dr. Kim');

    // Source input belongs to another client
    await expect(
      db.structured.createEvidenceLink(
        {
          clientId: a.id,
          targetType: 'fact',
          targetId: factA.id,
          sourceInputId: inputB.id,
          excerpt: 'x',
          dateOfSource: '2026-07-10',
          relationship: 'supports',
          strength: 'moderate',
        },
        'Dr. Kim',
      ),
    ).rejects.toThrow(/Cross-client/);

    // Target belongs to another client
    await expect(
      db.structured.createEvidenceLink(
        {
          clientId: b.id,
          targetType: 'fact',
          targetId: factA.id,
          sourceInputId: inputB.id,
          excerpt: 'x',
          dateOfSource: '2026-07-10',
          relationship: 'supports',
          strength: 'moderate',
        },
        'Dr. Kim',
      ),
    ).rejects.toThrow(/Cross-client/);
  });

  it('deleting a client removes all Phase 2 records without touching others', async () => {
    const keep = await makeClient('Keep');
    const drop = await makeClient('Drop');
    const inputKeep = await makeInput(keep.id);
    const inputDrop = await makeInput(drop.id);

    const keptFact = await db.structured.createFact(factDraft(keep.id, inputKeep.id), 'Dr. Kim');
    await db.structured.decideFact(keptFact.id, 'approve', 'Dr. Kim');
    const dropFact = await db.structured.createFact(factDraft(drop.id, inputDrop.id), 'Dr. Kim');
    await db.structured.decideFact(dropFact.id, 'approve', 'Dr. Kim');
    await db.structured.createAssessment(
      { clientId: drop.id, definitionKey: 'gad7', name: 'GAD-7', dateAdministered: '2026-07-01', totalScore: 9 },
      'Dr. Kim',
    );
    await db.structured.createGap(
      { clientId: drop.id, topic: 'Attachment style', reason: 'Insufficient info', suggestedQuestions: [], priority: 'medium' },
      'Dr. Kim',
    );

    await db.deleteClient(drop.id, 'Dr. Kim');

    expect(await db.structured.listFacts(drop.id)).toHaveLength(0);
    expect(await db.structured.listAssessments(drop.id)).toHaveLength(0);
    expect(await db.structured.listEvidence(drop.id)).toHaveLength(0);
    expect(await db.structured.listGaps(drop.id)).toHaveLength(0);
    expect(await db.structured.listVersions(drop.id)).toHaveLength(0);
    // Untouched client
    expect(await db.structured.listFacts(keep.id)).toHaveLength(1);
    expect(await db.structured.listEvidence(keep.id)).toHaveLength(1);
  });
});

describe('StructuredRepository — review workflow', () => {
  it('pending and rejected facts are excluded from the approved profile', async () => {
    const client = await makeClient('C');
    const input = await makeInput(client.id);
    const pending = await db.structured.createFact(factDraft(client.id, input.id, { statement: 'Pending' }), 'Dr. Kim');
    const rejected = await db.structured.createFact(factDraft(client.id, input.id, { statement: 'Rejected' }), 'Dr. Kim');
    const approved = await db.structured.createFact(factDraft(client.id, input.id, { statement: 'Approved' }), 'Dr. Kim');

    await db.structured.decideFact(rejected.id, 'reject', 'Dr. Kim');
    await db.structured.decideFact(approved.id, 'approve', 'Dr. Kim');

    const all = await db.structured.listFacts(client.id);
    const approvedOnly = all.filter((f) => APPROVED_STATUSES.includes(f.reviewStatus));
    expect(approvedOnly.map((f) => f.statement)).toEqual(['Approved']);
    expect(all.find((f) => f.id === pending.id)?.reviewStatus).toBe('pending');
    expect(all.find((f) => f.id === rejected.id)?.reviewStatus).toBe('rejected');
  });

  it('editing preserves the original in version history', async () => {
    const client = await makeClient('C');
    const input = await makeInput(client.id);
    const fact = await db.structured.createFact(factDraft(client.id, input.id, { statement: 'Original wording' }), 'Dr. Kim');
    await db.structured.decideFact(fact.id, 'approve', 'Dr. Kim');
    await db.structured.editFact(fact.id, { statement: 'Corrected wording' }, 'Dr. Kim', 'Clarity');

    const current = await db.structured.getFact(fact.id);
    expect(current?.statement).toBe('Corrected wording');
    expect(current?.reviewStatus).toBe('edited');
    expect(current?.version).toBe(3); // create(1) → approve(2) → edit(3)

    const versions = await db.structured.listVersions(client.id, 'fact', fact.id);
    expect(versions.length).toBeGreaterThanOrEqual(2);
    const snapshots = versions.map((v) => (v.snapshot as { statement: string }).statement);
    expect(snapshots).toContain('Original wording');
  });

  it('superseded facts remain available in history', async () => {
    const client = await makeClient('C');
    const input = await makeInput(client.id);
    const fact = await db.structured.createFact(factDraft(client.id, input.id), 'Dr. Kim');
    await db.structured.decideFact(fact.id, 'approve', 'Dr. Kim');
    await db.structured.decideFact(fact.id, 'supersede', 'Dr. Kim');
    const current = await db.structured.getFact(fact.id);
    expect(current?.reviewStatus).toBe('superseded');
    expect(await db.structured.listFacts(client.id)).toHaveLength(1); // still listed for history views
  });

  it('bulk approval skips risk-related items', async () => {
    const client = await makeClient('C');
    const input = await makeInput(client.id);
    const safe1 = await db.structured.createFact(factDraft(client.id, input.id, { statement: 'safe 1' }), 'Dr. Kim');
    const safe2 = await db.structured.createFact(factDraft(client.id, input.id, { statement: 'safe 2' }), 'Dr. Kim');
    const risky = await db.structured.createFact(
      factDraft(client.id, input.id, { statement: 'SI reported', category: 'risk-factor', riskRelated: true }),
      'Dr. Kim',
    );

    const result = await db.structured.bulkApproveFacts([safe1.id, safe2.id, risky.id], 'Dr. Kim');
    expect(result.approved.sort()).toEqual([safe1.id, safe2.id].sort());
    expect(result.skippedRisk).toEqual([risky.id]);
    expect((await db.structured.getFact(risky.id))?.reviewStatus).toBe('pending');
  });

  it('approved facts retain evidence links back to their source', async () => {
    const client = await makeClient('C');
    const input = await makeInput(client.id);
    const fact = await db.structured.createFact(factDraft(client.id, input.id), 'Dr. Kim');
    await db.structured.decideFact(fact.id, 'approve', 'Dr. Kim');
    const evidence = await db.structured.listEvidence(client.id, { type: 'fact', id: fact.id });
    expect(evidence).toHaveLength(1);
    expect(evidence[0].sourceInputId).toBe(input.id);
    expect(evidence[0].excerpt).toBe('Client reports poor sleep.');
  });

  it('review decisions are audited', async () => {
    const client = await makeClient('C');
    const input = await makeInput(client.id);
    const fact = await db.structured.createFact(factDraft(client.id, input.id), 'Dr. Kim');
    await db.structured.decideFact(fact.id, 'approve', 'Dr. Kim');
    const actions = (await db.listAudit(100)).map((e) => e.action);
    expect(actions).toContain('fact.create');
    expect(actions).toContain('fact.approve');
  });
});

describe('StructuredRepository — assessments', () => {
  it('lists scores chronologically and computes interpretation from encoded rules', async () => {
    const client = await makeClient('C');
    await db.structured.createAssessment(
      { clientId: client.id, definitionKey: 'phq9', name: 'PHQ-9', dateAdministered: '2026-07-08', totalScore: 11 },
      'Dr. Kim',
    );
    await db.structured.createAssessment(
      { clientId: client.id, definitionKey: 'phq9', name: 'PHQ-9', dateAdministered: '2026-06-01', totalScore: 18 },
      'Dr. Kim',
    );
    const list = await db.structured.listAssessments(client.id);
    expect(list.map((a) => a.totalScore)).toEqual([18, 11]);
    expect(list[0].severityInterpretation).toContain('Moderately severe');
    expect(list[1].severityInterpretation).toContain('Moderate');
  });

  it('custom assessments never receive invented interpretations', async () => {
    const client = await makeClient('C');
    const record = await db.structured.createAssessment(
      { clientId: client.id, definitionKey: 'custom', name: 'Clinic Wellness Scale', dateAdministered: '2026-07-01', totalScore: 40 },
      'Dr. Kim',
    );
    expect(record.severityInterpretation).toBeUndefined();
  });

  it('risk-flagged assessments require a disposition note', async () => {
    const client = await makeClient('C');
    const cssrsDraft = {
      clientId: client.id,
      definitionKey: 'cssrs',
      name: 'C-SSRS (Screener)',
      dateAdministered: '2026-07-10',
      subscaleScores: [
        { label: 'Highest ideation level endorsed', score: 3 },
        { label: 'Suicidal behavior (lifetime/recent per screener)', score: 0 },
      ],
    };
    await expect(db.structured.createAssessment(cssrsDraft, 'Dr. Kim')).rejects.toThrow(/disposition/);

    const withNote = await db.structured.createAssessment(
      { ...cssrsDraft, riskDisposition: 'Full C-SSRS completed; safety plan updated; supervisor notified.' },
      'Dr. Kim',
    );
    expect(withNote.riskFlags).toContain('suicidal-ideation');
    expect(withNote.severityInterpretation).toContain('full risk assessment');
  });

  it('PHQ-9 item 9 endorsement adds a risk flag requiring disposition', async () => {
    const client = await makeClient('C');
    await expect(
      db.structured.createAssessment(
        { clientId: client.id, definitionKey: 'phq9', name: 'PHQ-9', dateAdministered: '2026-07-10', totalScore: 14 },
        'Dr. Kim',
        ['self-harm-item-endorsed'],
      ),
    ).rejects.toThrow(/disposition/);
  });
});
