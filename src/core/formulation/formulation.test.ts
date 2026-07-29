import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AuthService } from '../auth/authService';
import type { ClinicalDatabase } from '../db/database';
import {
  approvedFact,
  makeClient,
  makeInput,
  makeTestDb,
} from '../ai/phase4TestUtils';
import type { IntelligenceGeneration } from '../db/intelligenceSchema';
import { diffFormulations, proposeFormulationUpdate } from './formulationEngine';

let auth: AuthService;
let db: ClinicalDatabase;

const generation: IntelligenceGeneration = {
  providerType: 'deterministic',
  providerId: 'deterministic',
  generatedAt: '2026-07-10T00:00:00Z',
  disclosure: 'test',
};

beforeEach(async () => {
  ({ auth, db } = await makeTestDb('test-formulation'));
});

afterEach(async () => {
  await auth.close();
});

describe('formulation engine', () => {
  it('every populated section carries evidence; empty sections say so instead of fabricating', async () => {
    const client = await makeClient(db, 'A');
    const input = await makeInput(db, client.id, 'History includes childhood neglect; client copes by people-pleasing.');
    await approvedFact(db, client.id, input.id, 'developmental-factor', 'Reports childhood neglect', { riskRelated: true });
    await approvedFact(db, client.id, input.id, 'coping-strategy', 'Copes by people-pleasing');

    const formulation = await proposeFormulationUpdate(db, client.id, 'developmental', 'Dr. Kim', generation, 'initial');
    const early = formulation.sections.find((s) => s.key === 'early')!;
    expect(early.supportingEvidence.length).toBeGreaterThan(0);
    expect(early.text).toContain('childhood neglect');

    const cost = formulation.sections.find((s) => s.key === 'present-cost')!;
    expect(cost.supportingEvidence).toHaveLength(0);
    expect(cost.text).toBe('No approved information documented for this area yet.');
    expect(cost.confidence).toBe('insufficient-evidence');
    expect(formulation.areasNeedingAssessment.join(' ')).toContain('Present-day cost');
  });

  it('pending and rejected facts never reach a formulation', async () => {
    const client = await makeClient(db, 'A');
    const input = await makeInput(db, client.id, 'Notes.');
    await db.structured.createFact(
      {
        clientId: client.id,
        sourceInputId: input.id,
        sourceInputVersion: 1,
        category: 'trauma',
        statement: 'UNAPPROVED-TRAUMA-CLAIM',
        dateRecorded: '2026-07-10',
        classification: 'client-report',
        extractionMethod: 'manual',
        extractionConfidence: 'high',
        temporalStatus: 'current',
        riskRelated: false,
      },
      'Dr. Kim',
    );
    const formulation = await proposeFormulationUpdate(db, client.id, 'trauma-informed', 'Dr. Kim', generation, 'test');
    expect(JSON.stringify(formulation.sections)).not.toContain('UNAPPROVED-TRAUMA-CLAIM');
  });

  it('unresolved contradictions attach to overlapping sections and lower confidence', async () => {
    const client = await makeClient(db, 'A');
    const input = await makeInput(db, client.id, 'Substance discussion.');
    await approvedFact(db, client.id, input.id, 'substance-use', 'Reports drinking daily after work');
    await db.structured.createContradiction(
      {
        clientId: client.id,
        topic: 'Drinking frequency',
        description: 'Client reported daily drinking but collateral reports weekend drinking only.',
        firstEvidence: { description: 'Client: drinking daily after work' },
        secondEvidence: { description: 'Collateral: weekends only' },
        dateIdentified: '2026-07-09',
      },
      'Dr. Kim',
    );
    const formulation = await proposeFormulationUpdate(db, client.id, 'substance-use', 'Dr. Kim', generation, 'test');
    const usePattern = formulation.sections.find((s) => s.key === 'use-pattern')!;
    expect(usePattern.contradictingEvidence.length).toBe(1);
    expect(usePattern.contradictingEvidence[0].label).toBe('Unresolved contradiction');
  });

  it('new data creates a PROPOSED update — the approved formulation is never overwritten', async () => {
    const client = await makeClient(db, 'A');
    const input = await makeInput(db, client.id, 'Anxiety notes.');
    await approvedFact(db, client.id, input.id, 'anxiety', 'Reports daily worry');

    const first = await proposeFormulationUpdate(db, client.id, 'biopsychosocial', 'Dr. Kim', generation, 'initial');
    await db.intelligence.decideFormulation(first.id, 'approve', 'Dr. Kim');

    await approvedFact(db, client.id, input.id, 'sleep', 'Reports insomnia most nights');
    const second = await proposeFormulationUpdate(db, client.id, 'biopsychosocial', 'Dr. Kim', generation, 'new sleep data');

    // Approved one untouched; proposal pending and linked to it.
    const approved = await db.intelligence.currentApprovedFormulation(client.id, 'biopsychosocial');
    expect(approved!.id).toBe(first.id);
    expect(second.reviewStatus).toBe('pending');
    expect(second.previousFormulationId).toBe(first.id);

    // Approving supersedes with full history and versions.
    await db.intelligence.decideFormulation(second.id, 'approve', 'Dr. Kim');
    const firstAfter = await db.intelligence.getFormulation(first.id);
    expect(firstAfter!.reviewStatus).toBe('superseded');
    const versions = await db.structured.listVersions(client.id, 'formulation');
    expect(versions.length).toBeGreaterThanOrEqual(2);
  });

  it('diffFormulations shows what changed, evidence added, and confidence shifts', async () => {
    const client = await makeClient(db, 'A');
    const input = await makeInput(db, client.id, 'Notes.');
    await approvedFact(db, client.id, input.id, 'anxiety', 'Reports daily worry');
    const first = await proposeFormulationUpdate(db, client.id, 'biopsychosocial', 'Dr. Kim', generation, 'initial');
    await db.intelligence.decideFormulation(first.id, 'approve', 'Dr. Kim');
    await approvedFact(db, client.id, input.id, 'mood', 'Reports low mood on most days');
    const second = await proposeFormulationUpdate(db, client.id, 'biopsychosocial', 'Dr. Kim', generation, 'update');

    const changes = diffFormulations(await db.intelligence.getFormulation(first.id), second);
    const psychological = changes.find((c) => c.key === 'psychological')!;
    expect(psychological.changeType).toBe('modified');
    expect(psychological.previousText).not.toContain('low mood');
    expect(psychological.proposedText).toContain('low mood');
    expect(psychological.evidenceAdded.length).toBeGreaterThan(0);
  });

  it('cultural information is preserved accurately in the cultural formulation', async () => {
    const client = await makeClient(db, 'A');
    const input = await makeInput(db, client.id, 'Client identifies as first-generation immigrant; family expectations shape care decisions.');
    await approvedFact(
      db,
      client.id,
      input.id,
      'cultural-factor',
      'Identifies as first-generation immigrant; family expectations shape care decisions',
    );
    const formulation = await proposeFormulationUpdate(db, client.id, 'cultural', 'Dr. Kim', generation, 'initial');
    const identity = formulation.sections.find((s) => s.key === 'identity')!;
    expect(identity.text).toContain('first-generation immigrant');
    expect(identity.text).toContain('family expectations shape care decisions');
    expect(identity.hypothesisBased).toBe(false);
  });

  it('hypothesis-based sections are labeled and hypotheses stay labeled inside text', async () => {
    const client = await makeClient(db, 'A');
    await db.structured.createHypothesis(
      {
        clientId: client.id,
        category: 'attachment-pattern',
        statement: 'Client may expect abandonment in close relationships',
        confidence: 'low-support',
        alternativeExplanations: ['Current relationship stress'],
        missingInformation: [],
        questionsToAssess: [],
      },
      'Dr. Kim',
    );
    const formulation = await proposeFormulationUpdate(db, client.id, 'attachment-based', 'Dr. Kim', generation, 'initial');
    const patterns = formulation.sections.find((s) => s.key === 'relational-patterns')!;
    expect(patterns.hypothesisBased).toBe(true);
    expect(patterns.text).toContain('Hypothesis (low support)');
    expect(patterns.alternativeExplanations).toContain('Current relationship stress');
  });
});
