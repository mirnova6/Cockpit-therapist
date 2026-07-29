/**
 * Shared helpers for the Phase 4 test suite (imported by *.test.ts only).
 * Includes a scripted fake AI provider so pipeline/gateway/assistant tests
 * can exercise the full AI path without any network or real model.
 */
import { AuthService } from '../auth/authService';
import type { ClinicalDatabase } from '../db/database';
import type { ClinicalInput } from '../db/schema';
import { DEFAULT_AI_SETTINGS, type AiSettings } from './aiSchema';
import type {
  AiTaskRequest,
  AiTaskResponse,
  ClinicalAIProvider,
  ProviderReadiness,
} from './types';
import { AiProviderError } from './types';

let counter = 0;

export interface TestContext {
  auth: AuthService;
  db: ClinicalDatabase;
}

export async function makeTestDb(prefix = 'test-p4'): Promise<TestContext> {
  const auth = new AuthService({ dbName: `${prefix}-${Date.now()}-${counter++}`, iterations: 1000 });
  const db = await auth.setup({ name: 'Dr. Kim', passphrase: 'test-passphrase-1' });
  return { auth, db };
}

export async function makeClient(db: ClinicalDatabase, name: string, overrides: object = {}) {
  return db.createClient(
    {
      displayName: name,
      contactEnabled: false,
      levelOfCare: 'outpatient',
      status: 'active',
      diagnoses: [],
      medications: [],
      risk: { level: 'not-assessed' },
      ...overrides,
    },
    'Dr. Kim',
  );
}

export async function makeInput(
  db: ClinicalDatabase,
  clientId: string,
  rawText: string,
  overrides: Partial<ClinicalInput> = {},
) {
  return db.createInput(
    {
      clientId,
      inputType: 'session-transcript',
      dateOfInformation: '2026-07-10',
      rawText,
      authorSource: 'Dr. Kim',
      reportedBy: 'therapist-entered',
      containsRisk: false,
      allowAiAnalysis: true,
      localOnly: false,
      ...overrides,
    },
    [],
    'Dr. Kim',
  );
}

export async function approvedFact(
  db: ClinicalDatabase,
  clientId: string,
  sourceInputId: string,
  category: string,
  statement: string,
  overrides: object = {},
) {
  const fact = await db.structured.createFact(
    {
      clientId,
      sourceInputId,
      sourceInputVersion: 1,
      category: category as never,
      statement,
      excerpt: statement,
      dateRecorded: '2026-07-10',
      classification: 'client-report',
      extractionMethod: 'manual',
      extractionConfidence: 'high',
      temporalStatus: 'current',
      riskRelated: false,
      ...overrides,
    },
    'Dr. Kim',
  );
  return db.structured.decideFact(fact.id, 'approve', 'Dr. Kim');
}

/** Settings preset for the fake LOCAL provider path. */
export function localSettings(overrides: Partial<AiSettings> = {}): AiSettings {
  return {
    ...DEFAULT_AI_SETTINGS,
    activeProviderType: 'local',
    localEndpointUrl: 'http://localhost:11434',
    localModel: 'fake-model',
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

export function onlineSettings(overrides: Partial<AiSettings> = {}): AiSettings {
  return {
    ...DEFAULT_AI_SETTINGS,
    activeProviderType: 'online',
    onlineEnabled: true,
    onlineApiKey: 'sk-ant-test',
    onlinePhiApproved: true,
    baaConfirmed: true,
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

/**
 * Scripted fake provider. Each test pushes responses (text or objects to be
 * JSON-stringified); requests are recorded for assertions. `hang: true`
 * makes runTask wait until aborted, for cancellation tests.
 */
export class FakeAIProvider implements ClinicalAIProvider {
  readonly id: string;
  readonly label = 'Fake AI (test only)';
  readonly providerType: 'local' | 'online';
  readonly capabilities: ClinicalAIProvider['capabilities'] = [
    'extraction',
    'document-generation',
    'clinical-synthesis',
    'case-formulation',
    'hypothesis-drafting',
    'intervention-recommendation',
    'safety-strategy',
    'question-answering',
    'knowledge-assistance',
    'claim-verification',
  ];

  requests: AiTaskRequest[] = [];
  private responses: unknown[] = [];
  hang = false;

  constructor(providerType: 'local' | 'online' = 'local') {
    this.providerType = providerType;
    this.id = providerType === 'local' ? 'local-endpoint' : 'anthropic-online';
  }

  queue(response: unknown): this {
    this.responses.push(response);
    return this;
  }

  async checkReadiness(): Promise<ProviderReadiness> {
    return { ready: true, detail: 'fake provider always ready' };
  }

  async runTask(request: AiTaskRequest): Promise<AiTaskResponse> {
    this.requests.push(request);
    if (this.hang) {
      await new Promise<never>((_resolve, reject) => {
        request.signal?.addEventListener('abort', () =>
          reject(new AiProviderError('aborted', 'The request was cancelled.')),
        );
      });
    }
    const next = this.responses.shift();
    if (next === undefined) throw new AiProviderError('invalid-response', 'No scripted response queued.');
    const text = typeof next === 'string' ? next : JSON.stringify(next);
    return {
      text,
      json: request.expectJson ? (typeof next === 'string' ? JSON.parse(next) : next) : undefined,
      modelId: 'fake-model',
      providerVersion: 'fake/1',
    };
  }
}
