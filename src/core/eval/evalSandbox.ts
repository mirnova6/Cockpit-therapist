/**
 * Evaluation sandbox (§2) — materializes a fictional case into a fresh
 * ClinicalDatabase backed by the in-memory adapter and an EPHEMERAL data
 * key. The sandbox shares no storage, no key, and no client ids with the
 * real workspace: fictional material cannot reach real collections, and
 * the harness never reads real client records.
 */
import { generateDataKey } from '../crypto/cryptoService';
import { ClinicalDatabase } from '../db/database';
import { MemoryAdapter } from '../storage/memoryAdapter';
import type { EvalCase } from './evalSchema';

export interface Sandbox {
  db: ClinicalDatabase;
  clientId: string;
  inputIds: string[];
  dispose: () => void;
}

const AUTHOR = 'Evaluation Harness';

export async function materializeCase(evalCase: EvalCase): Promise<Sandbox> {
  const adapter = new MemoryAdapter();
  const dek = await generateDataKey();
  const db = new ClinicalDatabase(adapter, dek);

  const client = await db.createClient(
    {
      displayName: `TEST — ${evalCase.title.slice(0, 40)}`,
      contactEnabled: false,
      levelOfCare: 'outpatient',
      status: 'active',
      diagnoses: evalCase.diagnoses.map((label, i) => ({ id: `dx-${i}`, label, kind: 'diagnosis' as const })),
      medications: evalCase.medications.map((name, i) => ({ id: `med-${i}`, name, status: 'current' as const })),
      risk: { level: 'not-assessed' },
    },
    AUTHOR,
  );

  const inputIds: string[] = [];
  for (const seed of evalCase.inputs) {
    const input = await db.createInput(
      {
        clientId: client.id,
        inputType: seed.inputType as never,
        dateOfInformation: seed.date,
        rawText: seed.text,
        authorSource: AUTHOR,
        reportedBy: 'therapist-entered',
        containsRisk: seed.containsRisk ?? false,
        allowAiAnalysis: true,
        localOnly: false,
      },
      [],
      AUTHOR,
    );
    inputIds.push(input.id);
  }

  for (const seed of evalCase.assessments) {
    await db.structured.createAssessment(
      {
        clientId: client.id,
        definitionKey: seed.definitionKey,
        name: seed.name,
        dateAdministered: seed.date,
        totalScore: seed.score,
        riskDisposition: seed.riskDisposition,
        sourceInputId: inputIds[0],
      },
      AUTHOR,
    );
  }

  for (const seed of evalCase.seedApprovedFacts) {
    const fact = await db.structured.createFact(
      {
        clientId: client.id,
        sourceInputId: inputIds[0],
        sourceInputVersion: 1,
        category: seed.category,
        statement: seed.statement,
        excerpt: seed.statement,
        dateRecorded: evalCase.inputs[0]?.date ?? '2026-06-01',
        classification: 'client-report',
        extractionMethod: 'manual',
        extractionConfidence: 'high',
        temporalStatus: seed.historical ? 'historical' : 'current',
        riskRelated: seed.riskRelated ?? false,
      },
      AUTHOR,
    );
    await db.structured.decideFact(fact.id, 'approve', AUTHOR, {
      note: seed.riskRelated ? 'Evaluation fixture — fictional risk content reviewed' : undefined,
    });
  }

  for (const seed of evalCase.seedHypotheses) {
    await db.structured.createHypothesis(
      {
        clientId: client.id,
        category: seed.category as never,
        statement: seed.statement,
        confidence: 'moderate-support',
        alternativeExplanations: [],
        missingInformation: [],
        questionsToAssess: [],
      },
      AUTHOR,
    );
  }

  for (const seed of evalCase.seedGoals) {
    await db.documents.createGoal(
      {
        clientId: client.id,
        kind: 'short-term',
        title: seed.title,
        status: 'active',
        objectives: seed.objectives.map((description, i) => ({
          id: `obj-${i}`,
          description,
          progress: 'not-started' as const,
          progressNotes: [],
          therapistPlan: {},
        })),
      },
      AUTHOR,
    );
  }

  for (const seed of evalCase.seedContradictions) {
    await db.structured.createContradiction(
      {
        clientId: client.id,
        topic: seed.topic,
        description: seed.description,
        firstEvidence: { sourceInputId: inputIds[0], description: 'First fictional source' },
        secondEvidence: { description: 'Second fictional source' },
        dateIdentified: evalCase.inputs[0]?.date ?? '2026-06-01',
      },
      AUTHOR,
    );
  }

  for (const seed of evalCase.knowledgeSources) {
    const source = await db.knowledge.createSource(
      {
        title: seed.title,
        topic: seed.topic,
        therapyModel: seed.therapyModel,
        sourceType: 'treatment-manual',
        citationDetails: seed.citation,
        allowedUses: [],
        excludedUses: [],
      },
      seed.text,
      AUTHOR,
    );
    await db.knowledge.setStatus(source.id, 'approved', AUTHOR);
  }

  return {
    db,
    clientId: client.id,
    inputIds,
    dispose: () => db.adapter.close(),
  };
}
