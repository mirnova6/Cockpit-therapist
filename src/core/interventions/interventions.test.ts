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
import { generateInterventionSet } from './interventionEngine';

let auth: AuthService;
let db: ClinicalDatabase;

const generation: IntelligenceGeneration = {
  providerType: 'deterministic',
  providerId: 'deterministic',
  generatedAt: '2026-07-10T00:00:00Z',
  disclosure: 'test',
};

beforeEach(async () => {
  ({ auth, db } = await makeTestDb('test-interventions'));
});

afterEach(async () => {
  await auth.close();
});

const MI_TEXT = `Working with ambivalence:
Motivational interviewing strengthens the client's own motivation for change by exploring ambivalence and developing discrepancy between current use and personal values.`;

async function approveMiKnowledge() {
  const source = await db.knowledge.createSource(
    {
      title: 'Motivational Interviewing',
      topic: 'motivational interviewing ambivalence',
      therapyModel: 'MI',
      sourceType: 'treatment-manual',
      citationDetails: 'Miller & Rollnick (2013). Motivational Interviewing (3rd ed.).',
      allowedUses: [],
      excludedUses: [],
    },
    MI_TEXT,
    'Dr. Kim',
  );
  await db.knowledge.setStatus(source.id, 'approved', 'Dr. Kim');
}

describe('intervention recommendations', () => {
  it('recommends only where approved client evidence exists, with reasons for exclusions', async () => {
    const client = await makeClient(db, 'A');
    const input = await makeInput(db, client.id, 'Substance use discussion.');
    await approvedFact(db, client.id, input.id, 'substance-use', 'Reports uncertainty about complete sobriety');
    await approvedFact(db, client.id, input.id, 'craving', 'Reports strong cravings on weekends');

    const set = await generateInterventionSet(db, client.id, 'Dr. Kim', generation);
    const mi = set.recommendations.find((r) => r.name === 'Motivational Interviewing');
    expect(mi).toBeDefined();
    expect(mi!.clientEvidence.length).toBeGreaterThan(0);
    // Modalities without evidence are listed as not recommended with a reason.
    const grief = set.notRecommended.find((n) => n.name === 'Grief work');
    expect(grief).toBeDefined();
    expect(grief!.reason).toContain('No approved client evidence');
  });

  it('tier is "established" only with BOTH client evidence and approved knowledge support', async () => {
    const client = await makeClient(db, 'A');
    const input = await makeInput(db, client.id, 'Substance use discussion.');
    await approvedFact(db, client.id, input.id, 'substance-use', 'Reports uncertainty about complete sobriety');
    await approvedFact(db, client.id, input.id, 'craving', 'Reports strong cravings on weekends');

    // Without knowledge: tentative at best.
    let set = await generateInterventionSet(db, client.id, 'Dr. Kim', generation);
    let mi = set.recommendations.find((r) => r.name === 'Motivational Interviewing')!;
    expect(mi.tier).toBe('tentative');
    expect(mi.knowledgeSupport).toHaveLength(0);

    // With approved knowledge: established, citing the retrieved passage.
    await approveMiKnowledge();
    set = await generateInterventionSet(db, client.id, 'Dr. Kim', generation);
    mi = set.recommendations.find((r) => r.name === 'Motivational Interviewing')!;
    expect(mi.tier).toBe('established');
    expect(mi.knowledgeSupport.length).toBeGreaterThan(0);
    expect(mi.knowledgeSupport[0].citation).toContain('Miller');
    expect(mi.knowledgeSupport[0].passage).toContain('ambivalence');
  });

  it('recommendations are options, not directives, and require clinician review', async () => {
    const client = await makeClient(db, 'A');
    const input = await makeInput(db, client.id, 'Anxiety.');
    await approvedFact(db, client.id, input.id, 'anxiety', 'Reports daily worry');
    const set = await generateInterventionSet(db, client.id, 'Dr. Kim', generation);
    expect(set.reviewStatus).toBe('pending');
    for (const rec of set.recommendations) {
      expect(rec.whyItMayFit).toContain('not a directive');
    }
  });

  it('trauma processing carries a stabilization concern when stabilization evidence is missing', async () => {
    const client = await makeClient(db, 'A');
    const input = await makeInput(db, client.id, 'Trauma history discussion.');
    await approvedFact(db, client.id, input.id, 'trauma', 'Reports assault two years ago with ongoing nightmares');

    const set = await generateInterventionSet(db, client.id, 'Dr. Kim', generation);
    const emdr = set.recommendations.find((r) => r.name === 'EMDR preparation')!;
    expect(emdr.stabilizationConcern).toBeDefined();
    expect(emdr.stabilizationConcern).toContain('insufficient');
    expect(emdr.cautions[0]).toBe(emdr.stabilizationConcern);
  });

  it('the stabilization concern clears when coping/protective evidence is documented — but stays under elevated risk', async () => {
    const client = await makeClient(db, 'A');
    const input = await makeInput(db, client.id, 'Trauma + coping.');
    await approvedFact(db, client.id, input.id, 'trauma', 'Reports assault two years ago');
    await approvedFact(db, client.id, input.id, 'coping-strategy', 'Uses grounding exercises daily with benefit');

    let set = await generateInterventionSet(db, client.id, 'Dr. Kim', generation);
    let emdr = set.recommendations.find((r) => r.name === 'EMDR preparation')!;
    expect(emdr.stabilizationConcern).toBeUndefined();

    await db.updateClient(client.id, { risk: { level: 'high' } }, 'Dr. Kim', 'Risk raised');
    set = await generateInterventionSet(db, client.id, 'Dr. Kim', generation);
    emdr = set.recommendations.find((r) => r.name === 'EMDR preparation')!;
    expect(emdr.stabilizationConcern).toContain('risk');
  });

  it('never uses proprietary frameworks that were not supplied and approved', async () => {
    const client = await makeClient(db, 'A');
    const input = await makeInput(db, client.id, 'Various documented needs.');
    await approvedFact(db, client.id, input.id, 'risk-factor', 'History of impulsive aggression when intoxicated', { riskRelated: true });
    const set = await generateInterventionSet(db, client.id, 'Dr. Kim', generation);
    const text = JSON.stringify(set);
    expect(text).not.toContain('NCI');
    expect(text).not.toContain('Behavior Operations');
  });
});
