import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AuthService } from '../auth/authService';
import type { ClinicalDatabase } from '../db/database';
import {
  ConsentRefusedError,
  IsolationError,
  assertClientScope,
  buildSendPreview,
  cancelAiOperation,
  cancelAllAiOperations,
  evaluateConsent,
  inFlightAiOperationCount,
  newOperationToken,
  runAiTask,
} from './aiGateway';
import { DEFAULT_AI_SETTINGS } from './aiSchema';
import {
  FakeAIProvider,
  localSettings,
  makeClient,
  makeInput,
  makeTestDb,
  onlineSettings,
} from './phase4TestUtils';
import { deterministicProvider } from './providers/deterministicProvider';
import type { EvidenceBlock } from './types';

let auth: AuthService;
let db: ClinicalDatabase;

beforeEach(async () => {
  ({ auth, db } = await makeTestDb('test-gateway'));
});

afterEach(async () => {
  cancelAllAiOperations();
  await auth.close();
});

function block(clientId: string, text = 'Client reports poor sleep.'): EvidenceBlock {
  return { ref: 'E1', refType: 'input', refId: 'i1', clientId, text };
}

describe('consent gate', () => {
  const consented = [{ id: 'i1', allowAiAnalysis: true, localOnly: false }];

  it('online processing is DISABLED by default and refused', () => {
    const result = evaluateConsent(
      { ...DEFAULT_AI_SETTINGS, activeProviderType: 'online' },
      new FakeAIProvider('online'),
      consented,
    );
    expect(result.ok).toBe(false);
    expect(result.status).toBe('refused-online-disabled');
  });

  it('refuses PHI when the provider is not attested as approved, even with online enabled', () => {
    const result = evaluateConsent(
      onlineSettings({ onlinePhiApproved: false }),
      new FakeAIProvider('online'),
      consented,
    );
    expect(result.ok).toBe(false);
    expect(result.status).toBe('refused-provider-not-approved');
    expect(result.reason).toContain('Protected information will not be sent');
  });

  it('refuses online sending of inputs without AI consent or marked local-only', () => {
    const noConsent = evaluateConsent(onlineSettings(), new FakeAIProvider('online'), [
      { id: 'i1', allowAiAnalysis: false, localOnly: false },
    ]);
    expect(noConsent.ok).toBe(false);
    expect(noConsent.blockedInputIds).toEqual(['i1']);

    const localOnly = evaluateConsent(onlineSettings(), new FakeAIProvider('online'), [
      { id: 'i2', allowAiAnalysis: true, localOnly: true },
    ]);
    expect(localOnly.ok).toBe(false);
    expect(localOnly.blockedInputIds).toEqual(['i2']);
  });

  it('local mode still honors the per-input AI-analysis consent flag', () => {
    const result = evaluateConsent(localSettings(), new FakeAIProvider('local'), [
      { id: 'i1', allowAiAnalysis: false, localOnly: true },
    ]);
    expect(result.ok).toBe(false);
    expect(result.status).toBe('refused-missing-consent');
  });

  it('local-only inputs CAN be processed locally when consented', () => {
    const result = evaluateConsent(localSettings(), new FakeAIProvider('local'), [
      { id: 'i1', allowAiAnalysis: true, localOnly: true },
    ]);
    expect(result.ok).toBe(true);
  });

  it('deterministic mode needs no consent (nothing is analyzed by a model)', () => {
    const result = evaluateConsent(DEFAULT_AI_SETTINGS, deterministicProvider, []);
    expect(result.ok).toBe(true);
    expect(result.status).toBe('not-required-deterministic');
  });
});

describe('cross-client isolation', () => {
  it('rejects and audits foreign evidence before any provider call', async () => {
    const a = await makeClient(db, 'A');
    const b = await makeClient(db, 'B');
    await expect(
      assertClientScope(db, a.id, [block(a.id), block(b.id, 'Other client content')]),
    ).rejects.toThrow(IsolationError);
    const audit = await db.listAudit(10);
    const violation = audit.find((e) => e.action === 'ai.isolation-violation');
    expect(violation).toBeDefined();
    // The audit entry must never contain clinical plaintext.
    expect(violation!.detail).not.toContain('Other client content');
  });
});

describe('runAiTask', () => {
  it('refused online run is LOGGED as refused and the provider is never called', async () => {
    const client = await makeClient(db, 'A');
    const input = await makeInput(db, client.id, 'Client reports poor sleep.');
    const provider = new FakeAIProvider('online');
    await expect(
      runAiTask({
        db,
        settings: { ...DEFAULT_AI_SETTINGS, activeProviderType: 'online' },
        provider,
        clientId: client.id,
        capability: 'question-answering',
        instructions: 'answer',
        clientEvidence: [block(client.id)],
        knowledgePassages: [],
        expectJson: false,
        sourceInputs: [{ id: input.id, allowAiAnalysis: true, localOnly: false }],
      }),
    ).rejects.toThrow(ConsentRefusedError);
    expect(provider.requests).toHaveLength(0);
    const ops = await db.ai.listOperations(client.id);
    expect(ops).toHaveLength(1);
    expect(ops[0].status).toBe('refused');
    expect(ops[0].phiLeftDevice).toBe(false);
  });

  it('online runs additionally require explicit confirmation of the send preview', async () => {
    const client = await makeClient(db, 'A');
    const provider = new FakeAIProvider('online');
    provider.queue('answer');
    await expect(
      runAiTask({
        db,
        settings: onlineSettings(),
        provider,
        clientId: client.id,
        capability: 'question-answering',
        instructions: 'answer',
        clientEvidence: [block(client.id)],
        knowledgePassages: [],
        expectJson: false,
        sourceInputs: [{ id: 'i1', allowAiAnalysis: true, localOnly: false }],
        // onlineSendConfirmed deliberately omitted
      }),
    ).rejects.toThrow(/preview has not been confirmed/);
    expect(provider.requests).toHaveLength(0);
  });

  it('successful runs log provider identity, mode, sources, and PHI flag — without prompt text', async () => {
    const client = await makeClient(db, 'A');
    const provider = new FakeAIProvider('local');
    provider.queue('the answer');
    const { response, operationId } = await runAiTask({
      db,
      settings: localSettings(),
      provider,
      clientId: client.id,
      capability: 'clinical-synthesis',
      instructions: 'synthesize',
      clientEvidence: [block(client.id, 'Very sensitive clinical sentence.')],
      knowledgePassages: [],
      expectJson: false,
      sourceInputs: [{ id: 'i1', allowAiAnalysis: true, localOnly: true }],
    });
    expect(response.text).toBe('the answer');
    const ops = await db.ai.listOperations(client.id);
    expect(ops[0].id).toBe(operationId);
    expect(ops[0].status).toBe('completed');
    expect(ops[0].mode).toBe('local');
    expect(ops[0].phiLeftDevice).toBe(false);
    expect(ops[0].selectedSources).toEqual(['input:i1']);
    expect(JSON.stringify(ops[0])).not.toContain('Very sensitive clinical sentence');
  });

  it('cancellation aborts the in-flight request and logs a cancelled operation', async () => {
    const client = await makeClient(db, 'A');
    const provider = new FakeAIProvider('local');
    provider.hang = true;
    const token = newOperationToken();
    const pending = runAiTask({
      db,
      settings: localSettings(),
      provider,
      clientId: client.id,
      capability: 'question-answering',
      instructions: 'answer',
      clientEvidence: [block(client.id)],
      knowledgePassages: [],
      expectJson: false,
      sourceInputs: [],
      operationToken: token,
    });
    // Wait until the request is registered, then cancel (as lock does).
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(inFlightAiOperationCount()).toBe(1);
    cancelAiOperation(token);
    await expect(pending).rejects.toThrow(/cancelled/i);
    expect(inFlightAiOperationCount()).toBe(0);
    const ops = await db.ai.listOperations(client.id);
    expect(ops[0].status).toBe('cancelled');
  });

  it('cancelAllAiOperations (workspace lock) aborts everything in flight', async () => {
    const client = await makeClient(db, 'A');
    const provider = new FakeAIProvider('local');
    provider.hang = true;
    const pending = runAiTask({
      db,
      settings: localSettings(),
      provider,
      clientId: client.id,
      capability: 'question-answering',
      instructions: 'answer',
      clientEvidence: [block(client.id)],
      knowledgePassages: [],
      expectJson: false,
      sourceInputs: [],
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    cancelAllAiOperations();
    await expect(pending).rejects.toThrow(/cancelled/i);
    expect(inFlightAiOperationCount()).toBe(0);
  });
});

describe('send preview', () => {
  it('shows the exact outbound text with redaction applied and disclosed', () => {
    const provider = new FakeAIProvider('online');
    const { preview, evidence } = buildSendPreview(
      onlineSettings({ redactBeforeSend: true }),
      provider,
      [block('c1', 'Maya Novak reported drinking. Call 555-123-4567.')],
      ['Maya Novak'],
    );
    expect(preview.redactionApplied).toBe(true);
    expect(preview.blocks[0].text).toContain('[CLIENT]');
    expect(preview.blocks[0].text).toContain('[PHONE]');
    expect(preview.blocks[0].text).not.toContain('Maya Novak');
    expect(evidence[0].text).toBe(preview.blocks[0].text);
    expect(preview.blocks[0].redaction?.length).toBeGreaterThan(0);
  });
});

describe('encryption at rest', () => {
  it('the stored API key and AI settings are not plaintext in IndexedDB', async () => {
    await db.ai.saveSettings({ onlineApiKey: 'sk-ant-super-secret-key-123', onlineEnabled: false });
    const rows = await db.adapter.getAllRecords();
    const dump = JSON.stringify(rows);
    expect(dump).not.toContain('sk-ant-super-secret-key-123');
    // But it decrypts correctly through the repository.
    const settings = await db.ai.getSettings();
    expect(settings.onlineApiKey).toBe('sk-ant-super-secret-key-123');
    expect(settings.onlineEnabled).toBe(false);
  });
});
