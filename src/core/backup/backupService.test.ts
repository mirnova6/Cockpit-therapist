import { afterEach, describe, expect, it } from 'vitest';
import { AuthService } from '../auth/authService';
import { createBackup, isValidBackup, restoreBackup } from './backupService';

let counter = 0;
const services: AuthService[] = [];

function makeService(dbName: string): AuthService {
  const service = new AuthService({ dbName, iterations: 1000 });
  services.push(service);
  return service;
}

afterEach(async () => {
  while (services.length) await services.pop()?.close();
});

describe('backupService', () => {
  it('creates a backup that restores into a fresh workspace with the same passphrase', async () => {
    const sourceName = `test-backup-src-${Date.now()}-${counter++}`;
    const targetName = `test-backup-dst-${Date.now()}-${counter++}`;

    const sourceAuth = makeService(sourceName);
    const sourceDb = await sourceAuth.setup({ name: 'Dr. Osei', passphrase: 'backup-pass-1' });
    const client = await sourceDb.createClient(
      {
        displayName: 'M.N.',
        contactEnabled: false,
        levelOfCare: 'php',
        status: 'active',
        diagnoses: [{ id: 'd1', label: 'GAD', kind: 'diagnosis' }],
        medications: [],
        risk: { level: 'moderate' },
      },
      'Dr. Osei',
    );
    await sourceDb.createInput(
      {
        clientId: client.id,
        inputType: 'bps',
        dateOfInformation: '2026-07-01',
        rawText: 'Full biopsychosocial text.',
        authorSource: 'Dr. Osei',
        reportedBy: 'therapist-entered',
        containsRisk: false,
        allowAiAnalysis: true,
        localOnly: true,
      },
      [{ name: 'bps.txt', mimeType: 'text/plain', bytes: new TextEncoder().encode('doc') }],
      'Dr. Osei',
    );

    const backup = await createBackup(sourceDb.adapter);
    expect(isValidBackup(backup)).toBe(true);
    // Backup must not contain plaintext PHI
    const dump = JSON.stringify(backup.records) + JSON.stringify(backup.blobs);
    expect(dump).not.toContain('M.N.');
    expect(dump).not.toContain('biopsychosocial');

    // Round-trip through JSON like a real file download/upload
    const parsed = JSON.parse(JSON.stringify(backup));

    const targetAuth = makeService(targetName);
    // restore into an empty adapter (uninitialized workspace)
    expect(await targetAuth.getStatus()).toBe('uninitialized');
    const targetAdapter = await (async () => {
      // Reach the adapter by asking the service for status first (opens it)
      const { IndexedDbAdapter } = await import('../storage/indexedDbAdapter');
      return IndexedDbAdapter.open(targetName);
    })();
    await restoreBackup(targetAdapter, parsed);
    targetAdapter.close();

    const restoredDb = await targetAuth.unlockWithPassphrase('backup-pass-1');
    const clients = await restoredDb.listClients();
    expect(clients).toHaveLength(1);
    expect(clients[0].displayName).toBe('M.N.');
    const inputs = await restoredDb.listInputsForClient(clients[0].id);
    expect(inputs).toHaveLength(1);
    const bytes = await restoredDb.getAttachmentBytes(inputs[0].attachments[0].id);
    expect(new TextDecoder().decode(bytes)).toBe('doc');
  });

  it('round-trips Phase 2 structured data with relationships intact', async () => {
    const sourceName = `test-backup-p2-src-${Date.now()}-${counter++}`;
    const targetName = `test-backup-p2-dst-${Date.now()}-${counter++}`;

    const sourceAuth = makeService(sourceName);
    const sourceDb = await sourceAuth.setup({ name: 'Dr. Osei', passphrase: 'backup-pass-2' });
    const client = await sourceDb.createClient(
      {
        displayName: 'P.Q.',
        contactEnabled: false,
        levelOfCare: 'outpatient',
        status: 'active',
        diagnoses: [],
        medications: [],
        risk: { level: 'low' },
      },
      'Dr. Osei',
    );
    const input = await sourceDb.createInput(
      {
        clientId: client.id,
        inputType: 'rough-notes',
        dateOfInformation: '2026-07-01',
        rawText: 'Client reports insomnia most nights.',
        authorSource: 'Dr. Osei',
        reportedBy: 'therapist-entered',
        containsRisk: false,
        allowAiAnalysis: true,
        localOnly: true,
      },
      [],
      'Dr. Osei',
    );
    const fact = await sourceDb.structured.createFact(
      {
        clientId: client.id,
        sourceInputId: input.id,
        sourceInputVersion: 1,
        category: 'sleep',
        statement: 'Insomnia most nights',
        excerpt: 'Client reports insomnia most nights.',
        dateRecorded: '2026-07-01',
        classification: 'client-report',
        extractionMethod: 'manual',
        extractionConfidence: 'high',
        temporalStatus: 'current',
        riskRelated: false,
      },
      'Dr. Osei',
    );
    await sourceDb.structured.decideFact(fact.id, 'approve', 'Dr. Osei');
    await sourceDb.structured.createAssessment(
      { clientId: client.id, definitionKey: 'phq9', name: 'PHQ-9', dateAdministered: '2026-07-01', totalScore: 9 },
      'Dr. Osei',
    );

    const backup = JSON.parse(JSON.stringify(await createBackup(sourceDb.adapter)));
    const dump = JSON.stringify(backup.records);
    expect(dump).not.toContain('Insomnia');

    const targetAuth = makeService(targetName);
    expect(await targetAuth.getStatus()).toBe('uninitialized');
    const { IndexedDbAdapter } = await import('../storage/indexedDbAdapter');
    const targetAdapter = await IndexedDbAdapter.open(targetName);
    await restoreBackup(targetAdapter, backup);
    targetAdapter.close();

    const restored = await targetAuth.unlockWithPassphrase('backup-pass-2');
    const restoredClient = (await restored.listClients())[0];
    const facts = await restored.structured.listFacts(restoredClient.id);
    expect(facts).toHaveLength(1);
    expect(facts[0].reviewStatus).toBe('approved');
    const evidence = await restored.structured.listEvidence(restoredClient.id, {
      type: 'fact',
      id: facts[0].id,
    });
    expect(evidence).toHaveLength(1);
    expect(evidence[0].sourceInputId).toBe(facts[0].sourceInputId);
    const assessments = await restored.structured.listAssessments(restoredClient.id);
    expect(assessments[0].severityInterpretation).toContain('Mild');
    const versions = await restored.structured.listVersions(restoredClient.id, 'fact', facts[0].id);
    expect(versions.length).toBeGreaterThanOrEqual(1);
  });

  it('rejects invalid backup files', async () => {
    expect(isValidBackup(null)).toBe(false);
    expect(isValidBackup({})).toBe(false);
    expect(isValidBackup({ format: 'something-else', version: 1 })).toBe(false);
  });
});
