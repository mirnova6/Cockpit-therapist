/**
 * Phase 8 sample FICTIONAL workspace data for beta testing.
 *
 * Every record is obviously fictional and clearly labeled "[FICTIONAL]". This
 * data is seeded through the normal repositories so testers exercise the real
 * flows. It must never be confused with, or mixed into decisions about, real
 * clients — beta mode does not change the Real PHI gate.
 */
import type { ClinicalDatabase } from '../db/database';
import { newId, type ClinicalInputType, type LevelOfCare } from '../db/schema';

interface SampleAssessment {
  definitionKey: string;
  name: string;
  dateAdministered: string;
  totalScore: number;
  riskDisposition?: string;
}

interface SampleClient {
  displayName: string;
  pronouns: string;
  levelOfCare: LevelOfCare;
  diagnosis?: { label: string; code: string };
  inputs: Array<{ inputType: ClinicalInputType; dateOfInformation: string; rawText: string; containsRisk?: boolean }>;
  assessments?: SampleAssessment[];
}

const AUTHOR = 'Beta Tester';

export const SAMPLE_CLIENTS: SampleClient[] = [
  {
    displayName: '[FICTIONAL] Riverbend, Alex',
    pronouns: 'they/them',
    levelOfCare: 'outpatient',
    diagnosis: { label: 'Generalized anxiety disorder', code: 'F41.1' },
    inputs: [
      {
        inputType: 'session-transcript',
        dateOfInformation: '2026-06-02',
        rawText:
          'FICTIONAL SAMPLE. Client described persistent worry about work and health, difficulty sleeping, and seeking frequent reassurance from their partner. Denied any thoughts of self-harm. Interested in learning grounding techniques.',
      },
    ],
    assessments: [{ definitionKey: 'gad7', name: 'GAD-7', dateAdministered: '2026-06-02', totalScore: 14 }],
  },
  {
    displayName: '[FICTIONAL] Marlow, Sam',
    pronouns: 'she/her',
    levelOfCare: 'outpatient',
    diagnosis: { label: 'Major depressive disorder', code: 'F33.1' },
    inputs: [
      {
        inputType: 'session-transcript',
        dateOfInformation: '2026-06-05',
        rawText:
          'FICTIONAL SAMPLE. Client reported low mood, loss of interest, and shame about "not coping". Reported passive thoughts that life is not worth it, without plan or intent. Agreed to a safety plan and next-day check-in.',
        containsRisk: true,
      },
    ],
    assessments: [
      { definitionKey: 'phq9', name: 'PHQ-9', dateAdministered: '2026-06-05', totalScore: 18, riskDisposition: 'FICTIONAL: item-9 endorsed; safety plan reviewed, no plan/intent.' },
    ],
  },
  {
    displayName: '[FICTIONAL] Okafor, Jordan',
    pronouns: 'he/him',
    levelOfCare: 'iop',
    diagnosis: { label: 'Alcohol use disorder, moderate', code: 'F10.20' },
    inputs: [
      {
        inputType: 'session-transcript',
        dateOfInformation: '2026-06-08',
        rawText:
          'FICTIONAL SAMPLE. Client ambivalent about reducing alcohol use; identified triggers around social events. Interested in harm-reduction options and tracking use between sessions.',
      },
    ],
    assessments: [{ definitionKey: 'audit', name: 'AUDIT', dateAdministered: '2026-06-08', totalScore: 17 }],
  },
];

export interface SeedResult {
  clientIds: string[];
}

/**
 * Seed the fictional sample workspace. Returns the created client ids so beta
 * mode can track and (optionally) remove them later.
 */
export async function seedBetaWorkspace(db: ClinicalDatabase): Promise<SeedResult> {
  const clientIds: string[] = [];
  for (const sample of SAMPLE_CLIENTS) {
    const client = await db.createClient(
      {
        displayName: sample.displayName,
        pronouns: sample.pronouns,
        contactEnabled: false,
        levelOfCare: sample.levelOfCare,
        status: 'active',
        diagnoses: sample.diagnosis
          ? [{ id: newId(), label: sample.diagnosis.label, code: sample.diagnosis.code, kind: 'diagnosis' }]
          : [],
        medications: [],
        risk: { level: 'not-assessed' },
      },
      AUTHOR,
    );
    clientIds.push(client.id);

    for (const input of sample.inputs) {
      await db.createInput(
        {
          clientId: client.id,
          inputType: input.inputType,
          dateOfInformation: input.dateOfInformation,
          rawText: input.rawText,
          authorSource: AUTHOR,
          reportedBy: 'therapist-entered',
          containsRisk: input.containsRisk ?? false,
          allowAiAnalysis: true,
          localOnly: false,
        },
        [],
        AUTHOR,
      );
    }

    for (const a of sample.assessments ?? []) {
      await db.structured.createAssessment(
        {
          clientId: client.id,
          definitionKey: a.definitionKey,
          name: a.name,
          dateAdministered: a.dateAdministered,
          totalScore: a.totalScore,
          ...(a.riskDisposition ? { riskDisposition: a.riskDisposition } : {}),
        },
        AUTHOR,
      );
    }
  }
  await db.audit('data', 'beta.sample-seeded', `${clientIds.length} fictional client(s)`);
  return { clientIds };
}
