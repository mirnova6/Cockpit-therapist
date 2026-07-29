import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AuthService } from '../auth/authService';
import type { ClinicalDatabase } from '../db/database';
import { makeClient, makeTestDb } from '../ai/phase4TestUtils';
import { buildInfo } from './buildInfo';
import { generateDeploymentReport, renderDeploymentReportText } from './deploymentReport';

let auth: AuthService;
let db: ClinicalDatabase;

const PHI_CANARY = 'Zebediah Quintwell-Fauxman';

beforeEach(async () => {
  ({ auth, db } = await makeTestDb('test-release'));
});
afterEach(async () => {
  await auth.close();
});

async function completeGate(): Promise<void> {
  for (const item of await db.governance.listPhiGate()) {
    await db.governance.setPhiGateItem(item.id, { complete: true, completedBy: 'Reviewer' }, 'Dr. Kim');
  }
}

describe('build info', () => {
  it('returns a version and commit (injected by vite define, or a dev fallback)', () => {
    const info = buildInfo();
    expect(info.version).toBeTruthy();
    expect(info.commit).toBeTruthy();
    expect(info.buildDate).toBeTruthy();
  });
});

describe('release checklist', () => {
  it('seeds and persists status updates', async () => {
    const items = await db.governance.listReleaseChecklist();
    expect(items.length).toBeGreaterThanOrEqual(10);
    await db.governance.updateReleaseItem(items[0].id, { status: 'done', notes: 'built on macOS' }, 'Dr. Kim');
    const reloaded = (await db.governance.listReleaseChecklist()).find((i) => i.id === items[0].id);
    expect(reloaded!.status).toBe('done');
    expect(reloaded!.notes).toBe('built on macOS');
  });
});

describe('deployment decision report', () => {
  it('defaults to fictional-data beta with PHI blocked and online refused', async () => {
    const report = await generateDeploymentReport(db);
    expect(report.classification).toBe('ready-fictional-data-beta');
    expect(report.phiGateBlocked).toBe(true);
    expect(report.notApprovedForOnlinePhi).toBe(true);
    expect(report.nativeBuildsReady).toBe(false);
    // Never defaults to real-PHI readiness.
    expect(report.classification).not.toBe('ready-online-phi-after-review');
  });

  it('upgrades to limited-reviewed local-only ONLY after the whole PHI gate is complete', async () => {
    await completeGate();
    const report = await generateDeploymentReport(db);
    expect(report.phiGateBlocked).toBe(false);
    expect(report.classification).toBe('ready-limited-reviewed-local-only');
    // Still not online PHI (online mode not enabled + no approved provider).
    expect(report.notApprovedForOnlinePhi).toBe(true);
  });

  it('makes no compliance claim and contains no client PHI', async () => {
    await makeClient(db, PHI_CANARY);
    const report = await generateDeploymentReport(db);
    const text = JSON.stringify(report) + '\n' + renderDeploymentReportText(report);
    expect(text).not.toContain(PHI_CANARY);
    // No positive HIPAA-compliance claim.
    expect(text).not.toMatch(/is HIPAA compliant|fully compliant|HIPAA-compliant\b/i);
    expect(text).toContain('makes no compliance claim');
  });
});
