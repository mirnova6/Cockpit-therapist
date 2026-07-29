import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AuthService } from '../auth/authService';
import type { ClinicalDatabase } from '../db/database';
import {
  approvedFact,
  makeClient,
  makeInput,
  makeTestDb,
} from '../ai/phase4TestUtils';
import { retrieveClientEvidence } from './clientRetrieval';

let auth: AuthService;
let db: ClinicalDatabase;

beforeEach(async () => {
  ({ auth, db } = await makeTestDb('test-rag'));
});

afterEach(async () => {
  await auth.close();
});

describe('client-record retrieval', () => {
  it('returns ONLY the selected client’s records', async () => {
    const a = await makeClient(db, 'A');
    const b = await makeClient(db, 'B');
    const inputA = await makeInput(db, a.id, 'Client A reports drinking daily and poor sleep.');
    const inputB = await makeInput(db, b.id, 'Client B reports drinking on weekends only.');
    await approvedFact(db, a.id, inputA.id, 'substance-use', 'Reports daily alcohol use');
    await approvedFact(db, b.id, inputB.id, 'substance-use', 'Reports weekend alcohol use');

    const result = await retrieveClientEvidence(db, a.id, 'alcohol drinking pattern');
    expect(result.sources.length).toBeGreaterThan(0);
    for (const source of [...result.sources, ...result.contradictions]) {
      expect(source.clientId).toBe(a.id);
    }
    const text = JSON.stringify(result);
    expect(text).not.toContain('Client B');
    expect(text).not.toContain('weekend');
  });

  it('excludes rejected and superseded facts; pending facts excluded unless explicitly selected', async () => {
    const a = await makeClient(db, 'A');
    const input = await makeInput(db, a.id, 'Sleep discussion.');
    const rejected = await db.structured.createFact(
      {
        clientId: a.id,
        sourceInputId: input.id,
        sourceInputVersion: 1,
        category: 'sleep',
        statement: 'REJECTED-SLEEP-CLAIM insomnia nightly',
        dateRecorded: '2026-07-10',
        classification: 'client-report',
        extractionMethod: 'manual',
        extractionConfidence: 'high',
        temporalStatus: 'current',
        riskRelated: false,
      },
      'Dr. Kim',
    );
    await db.structured.decideFact(rejected.id, 'reject', 'Dr. Kim');
    const pending = await db.structured.createFact(
      {
        clientId: a.id,
        sourceInputId: input.id,
        sourceInputVersion: 1,
        category: 'sleep',
        statement: 'PENDING-SLEEP-CLAIM insomnia most nights',
        dateRecorded: '2026-07-10',
        classification: 'client-report',
        extractionMethod: 'manual',
        extractionConfidence: 'high',
        temporalStatus: 'current',
        riskRelated: false,
      },
      'Dr. Kim',
    );

    const withoutPending = await retrieveClientEvidence(db, a.id, 'insomnia sleep');
    const texts = withoutPending.sources.map((s) => s.text).join(' ');
    expect(texts).not.toContain('REJECTED-SLEEP-CLAIM');
    expect(texts).not.toContain('PENDING-SLEEP-CLAIM');
    expect(withoutPending.debug.excluded.some((e) => e.reason.includes('Rejected'))).toBe(true);
    expect(withoutPending.debug.excluded.some((e) => e.reason.includes('Pending review'))).toBe(true);

    const withPending = await retrieveClientEvidence(db, a.id, 'insomnia sleep', {
      includePendingFactIds: [pending.id],
    });
    const included = withPending.sources.find((s) => s.text.includes('PENDING-SLEEP-CLAIM'));
    expect(included).toBeDefined();
    expect(included!.approvalStatus).toContain('pending');
  });

  it('longitudinal questions retrieve from multiple time periods, not just the newest note', async () => {
    const a = await makeClient(db, 'A');
    await makeInput(db, a.id, 'Intake: client described conflict with partner and avoidance of family calls.', {
      dateOfInformation: '2025-09-05',
      inputType: 'bps',
    });
    await makeInput(db, a.id, 'Mid-treatment: relationship conflict recurred; client withdrew from partner.', {
      dateOfInformation: '2026-01-15',
    });
    await makeInput(db, a.id, 'Recent session: client argued with partner again and left the conversation.', {
      dateOfInformation: '2026-07-08',
    });

    const result = await retrieveClientEvidence(
      db,
      a.id,
      'What pattern appears across the client’s relationships?',
      { today: '2026-07-10' },
    );
    expect(result.debug.timePeriodsCovered.length).toBeGreaterThanOrEqual(3);
    const dates = result.sources.map((s) => s.date);
    expect(dates).toContain('2025-09-05');
    expect(dates).toContain('2026-07-08');
  });

  it('retrieves contradictory evidence alongside results and says so in the debug panel', async () => {
    const a = await makeClient(db, 'A');
    const input = await makeInput(db, a.id, 'Client reports abstinence from alcohol this month.');
    await approvedFact(db, a.id, input.id, 'substance-use', 'Reports abstinence from alcohol');
    await db.structured.createContradiction(
      {
        clientId: a.id,
        topic: 'Alcohol use vs reported abstinence',
        description: 'Client reported abstinence, but a later note documents alcohol use.',
        firstEvidence: { sourceInputId: input.id, description: 'Reports abstinence' },
        secondEvidence: { description: 'Later note documents drinking' },
        dateIdentified: '2026-07-09',
      },
      'Dr. Kim',
    );

    const result = await retrieveClientEvidence(db, a.id, 'alcohol abstinence drinking status');
    expect(result.contradictions.length).toBe(1);
    expect(result.debug.contradictionsRetrieved).toBe(true);
    expect(result.contradictions[0].text).toContain('abstinence');
  });

  it('every retrieved source explains WHY it was selected', async () => {
    const a = await makeClient(db, 'A');
    const input = await makeInput(db, a.id, 'Client reports panic attacks at work.');
    await approvedFact(db, a.id, input.id, 'anxiety', 'Reports panic attacks at work');
    const result = await retrieveClientEvidence(db, a.id, 'panic anxiety work');
    for (const source of result.sources) {
      expect(source.reasons.length).toBeGreaterThan(0);
    }
    const approvedSource = result.sources.find((s) => s.approvalStatus === 'approved');
    expect(approvedSource?.reasons.join(' ')).toContain('Clinician-approved');
  });
});
