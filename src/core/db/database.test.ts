import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AuthService } from '../auth/authService';
import type { ClinicalDatabase, ClinicalInputDraft } from './database';

let counter = 0;
let auth: AuthService;
let db: ClinicalDatabase;

beforeEach(async () => {
  auth = new AuthService({ dbName: `test-db-${Date.now()}-${counter++}`, iterations: 1000 });
  db = await auth.setup({ name: 'Dr. Kim', passphrase: 'test-passphrase-1' });
});

afterEach(async () => {
  await auth.close();
});

function clientDraft(name: string) {
  return {
    displayName: name,
    contactEnabled: false,
    levelOfCare: 'outpatient' as const,
    status: 'active' as const,
    diagnoses: [],
    medications: [],
    risk: { level: 'not-assessed' as const },
  };
}

function inputDraft(clientId: string, overrides: Partial<ClinicalInputDraft> = {}): ClinicalInputDraft {
  return {
    clientId,
    inputType: 'rough-notes',
    dateOfInformation: '2026-07-10',
    rawText: 'Client discussed work stress and sleep difficulties.',
    authorSource: 'Dr. Kim',
    reportedBy: 'therapist-entered',
    containsRisk: false,
    allowAiAnalysis: true,
    localOnly: true,
    ...overrides,
  };
}

describe('ClinicalDatabase', () => {
  it('creates, updates, archives, and lists clients with change history', async () => {
    const client = await db.createClient(clientDraft('J.T.'), 'Dr. Kim');
    await db.updateClient(client.id, { pronouns: 'they/them' }, 'Dr. Kim', 'Updated pronouns');
    await db.updateClient(client.id, { archived: true }, 'Dr. Kim', 'Client archived');

    const clients = await db.listClients();
    expect(clients).toHaveLength(1);
    expect(clients[0].pronouns).toBe('they/them');
    expect(clients[0].archived).toBe(true);

    const changes = await db.listChangesForClient(client.id);
    expect(changes.map((c) => c.action)).toEqual(['archived', 'updated', 'created']);
    expect(changes.every((c) => c.author === 'Dr. Kim')).toBe(true);
    expect(changes.every((c) => Boolean(c.at))).toBe(true);
  });

  it('keeps each client’s inputs isolated', async () => {
    const a = await db.createClient(clientDraft('A.A.'), 'Dr. Kim');
    const b = await db.createClient(clientDraft('B.B.'), 'Dr. Kim');
    await db.createInput(inputDraft(a.id, { rawText: 'Alpha only' }), [], 'Dr. Kim');
    await db.createInput(inputDraft(b.id, { rawText: 'Beta only' }), [], 'Dr. Kim');

    const aInputs = await db.listInputsForClient(a.id);
    const bInputs = await db.listInputsForClient(b.id);
    expect(aInputs).toHaveLength(1);
    expect(bInputs).toHaveLength(1);
    expect(aInputs[0].rawText).toBe('Alpha only');
    expect(bInputs[0].rawText).toBe('Beta only');
  });

  it('stores attachments encrypted and retrieves them intact', async () => {
    const client = await db.createClient(clientDraft('F.G.'), 'Dr. Kim');
    const bytes = new TextEncoder().encode('Prior treatment plan PDF bytes');
    const input = await db.createInput(
      inputDraft(client.id, { inputType: 'uploaded-document' }),
      [{ name: 'plan.pdf', mimeType: 'application/pdf', bytes }],
      'Dr. Kim',
    );
    expect(input.attachments).toHaveLength(1);
    const restored = await db.getAttachmentBytes(input.attachments[0].id);
    expect(new TextDecoder().decode(restored)).toBe('Prior treatment plan PDF bytes');
  });

  it('increments versions on edits and preserves the risk review workflow', async () => {
    const client = await db.createClient(clientDraft('R.R.'), 'Dr. Kim');
    const input = await db.createInput(
      inputDraft(client.id, { containsRisk: true, rawText: 'Client reported passive SI.' }),
      [],
      'Dr. Kim',
    );
    expect(input.version).toBe(1);
    expect(input.riskReview).toBeUndefined();

    const reviewed = await db.markRiskReviewed(input.id, 'Dr. Kim', 'C-SSRS completed in session');
    expect(reviewed.version).toBe(2);
    expect(reviewed.riskReview?.reviewedBy).toBe('Dr. Kim');
    expect(reviewed.riskReview?.note).toBe('C-SSRS completed in session');

    const changes = await db.listChangesForClient(client.id);
    expect(changes.some((c) => c.action === 'risk-reviewed')).toBe(true);
  });

  it('deleting a client removes its inputs, blobs, and change history', async () => {
    const keep = await db.createClient(clientDraft('Keep'), 'Dr. Kim');
    const remove = await db.createClient(clientDraft('Remove'), 'Dr. Kim');
    const bytes = new Uint8Array([1, 2, 3]);
    const removedInput = await db.createInput(
      inputDraft(remove.id),
      [{ name: 'x.bin', mimeType: 'application/octet-stream', bytes }],
      'Dr. Kim',
    );
    await db.createInput(inputDraft(keep.id), [], 'Dr. Kim');

    await db.deleteClient(remove.id, 'Dr. Kim');

    expect(await db.getClient(remove.id)).toBeUndefined();
    expect(await db.listInputsForClient(remove.id, { includeArchived: true })).toHaveLength(0);
    expect(await db.getAttachmentBytes(removedInput.attachments[0].id)).toBeUndefined();
    expect(await db.listChangesForClient(remove.id)).toHaveLength(0);
    // Unrelated client untouched
    expect(await db.getClient(keep.id)).toBeTruthy();
    expect(await db.listInputsForClient(keep.id)).toHaveLength(1);
  });

  it('tracks recently viewed clients in prefs', async () => {
    const a = await db.createClient(clientDraft('One'), 'Dr. Kim');
    const b = await db.createClient(clientDraft('Two'), 'Dr. Kim');
    await db.noteClientViewed(a.id);
    const prefs = await db.noteClientViewed(b.id);
    expect(prefs.recentlyViewed.map((r) => r.clientId)).toEqual([b.id, a.id]);
  });

  it('records audit events', async () => {
    const client = await db.createClient(clientDraft('Audit'), 'Dr. Kim');
    await db.createInput(inputDraft(client.id), [], 'Dr. Kim');
    const events = await db.listAudit();
    const actions = events.map((e) => e.action);
    expect(actions).toContain('workspace.created');
    expect(actions).toContain('client.create');
    expect(actions).toContain('input.create');
  });
});
