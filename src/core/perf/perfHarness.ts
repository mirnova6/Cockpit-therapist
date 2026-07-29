/**
 * Phase 8 performance harness.
 *
 * `measureWorkspace` runs NON-MUTATING read measurements against the live
 * (possibly beta-seeded) workspace so the deployment report and a performance
 * view can show real numbers. `stressSeed` populates an EPHEMERAL database for
 * the stress test suite — it must never be pointed at a real workspace.
 */
import type { ClinicalDatabase } from '../db/database';
import { retrieveClientEvidence } from '../rag/clientRetrieval';
import { DEFAULT_FILTER, filterClients } from '../../features/clients/clientFilters';
import { newId } from '../db/schema';

export interface PerfSample {
  label: string;
  ms: number;
  detail?: string;
}

async function timed(label: string, fn: () => Promise<unknown> | unknown, detail?: string): Promise<PerfSample> {
  const start = (globalThis.performance ?? Date).now();
  await fn();
  const ms = Math.round(((globalThis.performance ?? Date).now() - start) * 100) / 100;
  return { label, ms, detail };
}

/** Non-mutating read measurements — safe to run on the live workspace. */
export async function measureWorkspace(db: ClinicalDatabase): Promise<PerfSample[]> {
  const samples: PerfSample[] = [];
  const clients = await db.listClients();
  samples.push(await timed('List all clients', () => db.listClients(), `${clients.length} client(s)`));
  samples.push(
    await timed('Search / filter clients', () => filterClients(clients, {}, { ...DEFAULT_FILTER, search: 'a' })),
  );
  samples.push(await timed('Load audit log (500)', () => db.listAudit(500)));
  if (clients.length > 0) {
    const first = clients[0].id;
    samples.push(await timed('List assessments (1 client)', () => db.structured.listAssessments(first)));
    samples.push(
      await timed('RAG retrieval (1 client)', () => retrieveClientEvidence(db, first, 'mood anxiety risk sleep'), 'lexical'),
    );
  }
  return samples;
}

export interface StressResult {
  clientsCreated: number;
  createMs: number;
  listMs: number;
  searchMs: number;
  retrievalMs: number;
  backupMs: number;
  backupBytes: number;
  restoreMs: number;
}

/**
 * Seed a workspace with N clients (each with a long transcript + assessments)
 * for the stress suite. EPHEMERAL DB ONLY. Returns coarse timings.
 */
export async function stressSeed(
  db: ClinicalDatabase,
  opts: { clients?: number; transcriptChars?: number } = {},
): Promise<{ clientIds: string[]; createMs: number }> {
  const n = opts.clients ?? 50;
  const bigText =
    'FICTIONAL long transcript. ' + 'The client discussed mood, sleep, work stress, and coping. '.repeat(Math.ceil((opts.transcriptChars ?? 4000) / 56));
  const clientIds: string[] = [];
  const start = (globalThis.performance ?? Date).now();
  for (let i = 0; i < n; i++) {
    const c = await db.createClient(
      {
        displayName: `[FICTIONAL] Stress ${i}`,
        contactEnabled: false,
        levelOfCare: 'outpatient',
        status: 'active',
        diagnoses: [{ id: newId(), label: 'Adjustment disorder', code: 'F43.20', kind: 'diagnosis' }],
        medications: [],
        risk: { level: 'not-assessed' },
      },
      'Stress',
    );
    clientIds.push(c.id);
    await db.createInput(
      {
        clientId: c.id,
        inputType: 'session-transcript',
        dateOfInformation: '2026-06-01',
        rawText: bigText,
        authorSource: 'Stress',
        reportedBy: 'therapist-entered',
        containsRisk: false,
        allowAiAnalysis: true,
        localOnly: false,
      },
      [],
      'Stress',
    );
    await db.structured.createAssessment(
      { clientId: c.id, definitionKey: 'phq9', name: 'PHQ-9', dateAdministered: '2026-06-01', totalScore: 10 },
      'Stress',
    );
  }
  const createMs = Math.round((globalThis.performance ?? Date).now() - start);
  return { clientIds, createMs };
}
