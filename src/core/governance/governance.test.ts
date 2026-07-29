import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthService } from '../auth/authService';
import type { ClinicalDatabase } from '../db/database';
import { ConsentRefusedError, runAiTask } from '../ai/aiGateway';
import {
  FakeAIProvider,
  makeClient,
  makeInput,
  makeTestDb,
  onlineSettings,
} from '../ai/phase4TestUtils';
import {
  EmbeddingRefusedError,
  generateClientEmbeddings,
  semanticPreviewSearch,
} from '../embeddings/embeddingService';
import { activeEmbeddingProvider } from '../embeddings/embeddingProviders';
import { DEFAULT_AI_SETTINGS, type AiSettings } from '../ai/aiSchema';
import { generateReadinessReport, renderReadinessReportText } from './readinessReport';

let auth: AuthService;
let db: ClinicalDatabase;

beforeEach(async () => {
  ({ auth, db } = await makeTestDb('test-gov'));
});

afterEach(async () => {
  vi.unstubAllGlobals();
  await auth.close();
});

function onlineRunArgs(clientId: string, provider: FakeAIProvider, settings = onlineSettings()) {
  return {
    db,
    settings,
    provider,
    clientId,
    capability: 'question-answering' as const,
    instructions: 'answer',
    clientEvidence: [{ ref: 'E1', refType: 'input', refId: 'i1', clientId, text: 'Sensitive clinical sentence.' }],
    knowledgePassages: [],
    expectJson: false,
    sourceInputs: [{ id: 'i1', allowAiAnalysis: true, localOnly: false }],
    onlineSendConfirmed: true,
  };
}

describe('emergency disable switch (§17)', () => {
  it('refuses every online send while active, before the provider is called', async () => {
    const client = await makeClient(db, 'A');
    const provider = new FakeAIProvider('online');
    provider.queue('never used');
    await expect(
      runAiTask(onlineRunArgs(client.id, provider, onlineSettings({ onlineKillSwitch: true }))),
    ).rejects.toThrow(/emergency disable/i);
    expect(provider.requests).toHaveLength(0);
    const ops = await db.ai.listOperations(client.id);
    expect(ops[0].status).toBe('refused');
    expect(ops[0].consentStatus).toBe('refused-kill-switch');
  });
});

describe('per-client local-only override (§17)', () => {
  it('blocks online sends for a flagged client regardless of consent and attestations', async () => {
    const client = await makeClient(db, 'A', { aiLocalOnly: true });
    const provider = new FakeAIProvider('online');
    provider.queue('never used');
    await expect(runAiTask(onlineRunArgs(client.id, provider))).rejects.toThrow(/local-only/i);
    expect(provider.requests).toHaveLength(0);
    const ops = await db.ai.listOperations(client.id);
    expect(ops[0].consentStatus).toBe('refused-client-local-only');
  });
});

describe('provider approval registry enforcement (§17)', () => {
  async function saveApproval(patch: object = {}) {
    return db.governance.saveApproval(
      {
        providerId: 'anthropic-online',
        providerName: 'Anthropic (Claude API)',
        providerType: 'online',
        model: 'claude-sonnet-5',
        approvalStatus: 'approved',
        baaStatus: 'signed',
        approvedPurposes: [],
        disallowedPurposes: [],
        ...patch,
      },
      'Dr. Kim',
    );
  }

  it('a non-approved registry entry refuses PHI even with all Phase 4 attestations', async () => {
    const client = await makeClient(db, 'A');
    await saveApproval({ approvalStatus: 'suspended' });
    const provider = new FakeAIProvider('online');
    provider.queue('never used');
    await expect(runAiTask(onlineRunArgs(client.id, provider))).rejects.toThrow(/suspended/i);
    const ops = await db.ai.listOperations(client.id);
    expect(ops[0].consentStatus).toBe('refused-provider-not-approved');
  });

  it('an expired approval refuses until re-reviewed', async () => {
    const client = await makeClient(db, 'A');
    await saveApproval({ reviewDueDate: '2020-01-01' });
    const provider = new FakeAIProvider('online');
    await expect(runAiTask(onlineRunArgs(client.id, provider))).rejects.toThrow(/expired/i);
    const ops = await db.ai.listOperations(client.id);
    expect(ops[0].consentStatus).toBe('refused-approval-expired');
  });

  it('disallowed and unapproved purposes are refused; approved purposes pass', async () => {
    const client = await makeClient(db, 'A');
    await saveApproval({ approvedPurposes: ['document-generation'], disallowedPurposes: ['question-answering'] });
    const provider = new FakeAIProvider('online');
    provider.queue('answer');
    await expect(runAiTask(onlineRunArgs(client.id, provider))).rejects.toThrow(/disallowed use/i);

    await saveApproval({ approvedPurposes: ['question-answering'], disallowedPurposes: [] });
    const ok = await runAiTask(onlineRunArgs(client.id, provider));
    expect(ok.response.text).toBe('answer');
    // Approval decisions are audited without key material.
    const audit = await db.listAudit(20);
    expect(audit.some((e) => e.action === 'provider-approval.save')).toBe(true);
  });
});

describe('readiness checklist (§18)', () => {
  it('seeds all categories, persists updates, and never claims compliance', async () => {
    const items = await db.governance.listChecklist();
    const categories = new Set(items.map((i) => i.category));
    for (const required of ['Encryption', 'Authentication', 'Backup and restore', 'Secure deletion', 'Audit logging', 'Risk workflow', 'Cross-client isolation', 'HIPAA policy review', 'Legal review', 'Native packaging', 'Incident response']) {
      expect(categories.has(required)).toBe(true);
    }
    expect(items.length).toBeGreaterThanOrEqual(20);

    const first = items[0];
    await db.governance.updateChecklistItem(first.id, { status: 'reviewed', notes: 'Verified in tests', nextReviewDate: '2027-01-01' }, 'Dr. Kim');
    const updated = (await db.governance.listChecklist()).find((i) => i.id === first.id)!;
    expect(updated.status).toBe('reviewed');
    expect(updated.reviewer).toBe('Dr. Kim');
    expect(updated.dateReviewed).toBeDefined();
    expect(updated.nextReviewDate).toBe('2027-01-01');

    const summary = await db.governance.checklistSummary();
    expect(summary.byStatus.reviewed).toBe(1);
  });
});

describe('production readiness report (§19)', () => {
  it('assembles live state, keeps the legal-review disclaimer, and renders for export', async () => {
    await db.governance.listChecklist(); // seed
    const report = await generateReadinessReport(db);
    expect(report.disclaimer).toContain('requires legal/security review');
    expect(report.liveState.onlineEnabled).toBe(false);
    expect(report.liveState.embeddingProvider).toContain('NOT active');
    expect(report.requiredBeforeOnlinePhi.length).toBeGreaterThan(0);
    expect(report.requiredBeforeMultiUser.length).toBeGreaterThan(0);
    const text = renderReadinessReportText(report);
    expect(text).toContain('PRODUCTION READINESS REPORT');
    expect(text).toContain('REQUIRED BEFORE REAL CLIENT DATA');
    expect(text).not.toMatch(/HIPAA.compliant\b/i);
    const audit = await db.listAudit(10);
    expect(audit.some((e) => e.action === 'readiness.report-generated')).toBe(true);
  });
});

describe('semantic retrieval preparation (§16)', () => {
  const localEmbedSettings = (): AiSettings => ({
    ...DEFAULT_AI_SETTINGS,
    embeddingProviderType: 'local',
    embeddingLocalEndpoint: 'http://localhost:11434',
    embeddingLocalModel: 'test-embed',
  });

  it('is honestly DISABLED by default — no provider, no vectors, no claims', async () => {
    const provider = activeEmbeddingProvider(DEFAULT_AI_SETTINGS);
    expect(provider.providerType).toBe('none');
    const readiness = await provider.checkReadiness(DEFAULT_AI_SETTINGS);
    expect(readiness.detail).toContain('NOT active');
    const client = await makeClient(db, 'A');
    await expect(generateClientEmbeddings(db, DEFAULT_AI_SETTINGS, client.id)).rejects.toThrow(EmbeddingRefusedError);
    await expect(semanticPreviewSearch(db, DEFAULT_AI_SETTINGS, client.id, 'anything')).rejects.toThrow(/not active/i);
  });

  it('generates client-namespaced encrypted vectors, isolates namespaces, and deletes with the client', async () => {
    // Deterministic fake embedding endpoint.
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL, init?: RequestInit) => {
        const href = String(url);
        if (href.endsWith('/v1/models')) {
          return new Response(JSON.stringify({ data: [{ id: 'test-embed' }] }), { status: 200 });
        }
        const body = JSON.parse(String(init?.body ?? '{}')) as { input: string[] };
        return new Response(
          JSON.stringify({
            data: body.input.map((text, index) => ({
              index,
              embedding: [text.length % 7, (text.charCodeAt(0) ?? 1) % 5, 1],
            })),
          }),
          { status: 200 },
        );
      }),
    );

    const a = await makeClient(db, 'A');
    const b = await makeClient(db, 'B');
    await makeInput(db, a.id, 'Client A talks about relationship conflict with partner.');
    await makeInput(db, b.id, 'Client B talks about work stress.');

    const settings = localEmbedSettings();
    const result = await generateClientEmbeddings(db, settings, a.id);
    expect(result.generated).toBeGreaterThan(0);

    // Namespace isolation: B has nothing; A's rows all carry A's id.
    expect(await db.governance.listEmbeddings(b.id)).toHaveLength(0);
    const mine = await db.governance.listEmbeddings(a.id);
    expect(mine.length).toBe(result.generated);
    expect(mine.every((e) => e.clientId === a.id)).toBe(true);

    // Encrypted at rest: raw envelopes contain no vector fields or text.
    const dump = JSON.stringify(await db.adapter.getAllRecords());
    expect(dump).not.toContain('relationship conflict');
    expect(dump).not.toContain('"vector"');

    // Semantic preview search stays inside the namespace.
    const rows = await semanticPreviewSearch(db, settings, a.id, 'relationship conflict');
    expect(rows.length).toBeGreaterThan(0);

    // Operation logged without clinical plaintext.
    const ops = await db.ai.listOperations();
    const embedOp = ops.find((o) => o.providerId === 'local-embedding');
    expect(embedOp).toBeDefined();
    expect(JSON.stringify(embedOp)).not.toContain('relationship conflict');

    // Regeneration replaces; secure client deletion clears vectors AND the
    // client-scoped operation entries.
    await generateClientEmbeddings(db, settings, a.id);
    expect((await db.governance.listEmbeddings(a.id)).length).toBe(result.generated);
    await db.deleteClient(a.id, 'Dr. Kim');
    expect(await db.governance.listEmbeddings(a.id)).toHaveLength(0);
    expect((await db.ai.listOperations(a.id)).length).toBe(0);
  });

  it('online embeddings obey consent, local-only, and confirmation rules', async () => {
    const settings: AiSettings = {
      ...onlineSettings(),
      embeddingProviderType: 'online',
      embeddingOnlineEndpoint: 'https://embeddings.example.com',
      embeddingOnlineModel: 'embed-1',
      embeddingOnlineApiKey: 'key-123',
    };
    const flagged = await makeClient(db, 'A', { aiLocalOnly: true });
    await makeInput(db, flagged.id, 'text');
    await expect(generateClientEmbeddings(db, settings, flagged.id, { onlineSendConfirmed: true })).rejects.toThrow(/local-only/i);

    const client = await makeClient(db, 'B');
    await makeInput(db, client.id, 'no consent text', { allowAiAnalysis: false });
    await expect(generateClientEmbeddings(db, settings, client.id, { onlineSendConfirmed: true })).rejects.toThrow(/consent/i);

    const consented = await makeClient(db, 'C');
    await makeInput(db, consented.id, 'consented text');
    await expect(generateClientEmbeddings(db, settings, consented.id)).rejects.toThrow(/preview has not been confirmed/i);

    // Kill switch dominates everything.
    await expect(
      generateClientEmbeddings(db, { ...settings, onlineKillSwitch: true }, consented.id, { onlineSendConfirmed: true }),
    ).rejects.toThrow(/emergency disable/i);
  });
});

describe('feedback isolation (§13)', () => {
  it('aggregates across clients read-only; per-client records never mix', async () => {
    const a = await makeClient(db, 'A');
    const b = await makeClient(db, 'B');
    await db.ai.addFeedback({ clientId: a.id, targetType: 'formulation', targetId: 'f1', labels: ['useful'], author: 'Dr. Kim' });
    await db.ai.addFeedback({ clientId: b.id, targetType: 'assistant-answer', targetId: 'm1', labels: ['missed-risk'], author: 'Dr. Kim' });

    expect(await db.ai.listAllFeedback()).toHaveLength(2);
    expect((await db.ai.listFeedback(a.id)).map((f) => f.targetId)).toEqual(['f1']);
    expect((await db.ai.listFeedback(b.id)).map((f) => f.targetId)).toEqual(['m1']);
    // Feedback changed no clinical records for either client.
    expect(await db.structured.listFacts(a.id)).toHaveLength(0);
    expect(await db.structured.listFacts(b.id)).toHaveLength(0);
  });
});

describe('ConsentRefusedError surface', () => {
  it('every refusal carries a human-readable reason for the UI', async () => {
    const client = await makeClient(db, 'A', { aiLocalOnly: true });
    const provider = new FakeAIProvider('online');
    try {
      await runAiTask(onlineRunArgs(client.id, provider));
      expect.unreachable('should have refused');
    } catch (error) {
      expect(error).toBeInstanceOf(ConsentRefusedError);
      expect((error as ConsentRefusedError).message.length).toBeGreaterThan(20);
    }
  });
});
