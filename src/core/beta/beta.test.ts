import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AuthService } from '../auth/authService';
import type { ClinicalDatabase } from '../db/database';
import { makeClient, makeInput, makeTestDb } from '../ai/phase4TestUtils';
import { generateBetaReport, renderBetaReportText } from './betaReport';
import { scrubText } from './betaSchema';
import { seedBetaWorkspace, SAMPLE_CLIENTS } from './sampleData';

let auth: AuthService;
let db: ClinicalDatabase;

const PHI_CANARY = 'Zebediah Quintwell-Fauxman';

beforeEach(async () => {
  ({ auth, db } = await makeTestDb('test-beta'));
});
afterEach(async () => {
  await auth.close();
});

describe('Beta testing mode', () => {
  it('toggles and persists beta state', async () => {
    expect((await db.beta.getState()).enabled).toBe(false);
    await db.beta.setEnabled(true);
    const state = await db.beta.getState();
    expect(state.enabled).toBe(true);
    expect(state.enabledAt).toBeTruthy();
    await db.beta.setEnabled(false);
    expect((await db.beta.getState()).enabled).toBe(false);
  });

  it('seeds only clearly-fictional sample clients', async () => {
    const { clientIds } = await seedBetaWorkspace(db);
    expect(clientIds.length).toBe(SAMPLE_CLIENTS.length);
    const clients = await db.listClients();
    expect(clients.length).toBe(SAMPLE_CLIENTS.length);
    // Every seeded client is explicitly labeled fictional.
    expect(clients.every((c) => c.displayName.includes('[FICTIONAL]'))).toBe(true);
    // Each has at least one input and the sample data has assessments.
    const first = clients[0];
    expect((await db.listInputsForClient(first.id)).length).toBeGreaterThan(0);
  });

  it('marks sample data loaded on the beta state', async () => {
    const { clientIds } = await seedBetaWorkspace(db);
    const state = await db.beta.markSampleLoaded(clientIds);
    expect(state.sampleDataLoaded).toBe(true);
    expect(state.sampleClientIds).toEqual(expect.arrayContaining(clientIds));
  });

  it('persists guided checklist edits and seeds the full list', async () => {
    const checks = await db.beta.listChecklist();
    expect(checks.length).toBeGreaterThanOrEqual(20);
    await db.beta.updateCheck(checks[0].id, { status: 'pass', notes: 'looks good' });
    const reloaded = (await db.beta.listChecklist()).find((c) => c.id === checks[0].id);
    expect(reloaded!.status).toBe('pass');
    expect(reloaded!.notes).toBe('looks good');
  });
});

describe('Bug reporting excludes PHI', () => {
  const base = {
    appVersion: '0.8.0 (abc123)',
    platform: 'Browser development mode',
    screen: 'Client dashboard',
    issueType: 'Crash' as const,
    stepsToReproduce: 'Open a client',
    expectedBehavior: 'Loads',
    actualBehavior: 'Crashes',
    severity: 'major' as const,
  };

  it('refuses to save a report without the no-PHI confirmation', async () => {
    await expect(db.beta.addBugReport({ ...base, noPhiConfirmed: false })).rejects.toThrow(/no PHI/i);
    expect((await db.beta.listBugReports()).length).toBe(0);
  });

  it('saves only structured fields and scrubs secret-shaped tokens', async () => {
    const report = await db.beta.addBugReport({
      ...base,
      stepsToReproduce: 'Paste key sk-ant-SECRET1234567890 and press save',
      noPhiConfirmed: true,
    });
    expect(report.stepsToReproduce).not.toContain('sk-ant-SECRET1234567890');
    expect(report.stepsToReproduce).toContain('[redacted-key]');
    // The stored report has no field capable of holding client records.
    expect(Object.keys(report).sort()).toEqual(
      [
        'actualBehavior', 'appVersion', 'createdAt', 'expectedBehavior', 'id', 'issueType',
        'noPhiConfirmed', 'platform', 'screen', 'screenshotNote', 'severity', 'stepsToReproduce',
      ].sort(),
    );
  });

  it('never captures client records even when clients with PHI exist', async () => {
    await makeClient(db, PHI_CANARY);
    await db.beta.addBugReport({ ...base, noPhiConfirmed: true });
    const serialized = JSON.stringify(await db.beta.listBugReports());
    expect(serialized).not.toContain(PHI_CANARY);
  });

  it('scrubText redacts keys, long tokens, and long numbers', () => {
    expect(scrubText('sk-ant-abcdefghijkl')).toContain('[redacted-key]');
    expect(scrubText('id 1234567890123')).toContain('[redacted-number]');
  });
});

describe('Beta report + audit hygiene', () => {
  it('produces a PHI-free beta report', async () => {
    await makeClient(db, PHI_CANARY);
    await db.beta.setEnabled(true);
    await db.beta.addBugReport({
      appVersion: 'v', platform: 'p', screen: 's', issueType: 'Other', stepsToReproduce: '', expectedBehavior: '', actualBehavior: 'x', severity: 'minor', noPhiConfirmed: true,
    });
    const report = await generateBetaReport(db);
    const serialized = JSON.stringify(report) + '\n' + renderBetaReportText(report);
    expect(serialized).not.toContain(PHI_CANARY);
    expect(serialized).toContain('fictional or fully de-identified data only');
  });

  it('keeps clinical plaintext out of the audit log after beta activity', async () => {
    const client = await makeClient(db, PHI_CANARY);
    await makeInput(db, client.id, `${PHI_CANARY} described SECRET-SYMPTOM-XYZ.`);
    await db.beta.setEnabled(true);
    await seedBetaWorkspace(db);
    const serialized = JSON.stringify(await db.listAudit(1000));
    expect(serialized).not.toContain(PHI_CANARY);
    expect(serialized).not.toContain('SECRET-SYMPTOM-XYZ');
    expect(serialized).toContain('beta.sample-seeded');
  });
});
