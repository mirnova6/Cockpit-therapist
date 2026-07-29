import { afterEach, describe, expect, it } from 'vitest';
import { AuthService } from '../auth/authService';
import type { ClinicalDatabase } from '../db/database';
import { FORBIDDEN_TRIAGE_FIELDS, type TriageDraft } from './feedbackTriage';

let counter = 0;
const services: AuthService[] = [];

afterEach(async () => {
  while (services.length) await services.pop()?.close();
});

async function workspace() {
  const auth = new AuthService({ dbName: `triage-${Date.now()}-${counter++}`, iterations: 1000 });
  services.push(auth);
  const db = await auth.setup({ name: 'Dr. Triage', passphrase: 'triage-passphrase-value' }); // secret-scan-allow: fixture value, not a real secret
  return db;
}

function draft(over: Partial<TriageDraft> = {}): TriageDraft {
  return {
    appVersion: '0.9.0',
    platform: 'Browser development mode',
    runtime: 'browser-development',
    featureArea: 'Review queue',
    category: 'Workflow friction',
    severity: 'minor',
    reproducibility: 'often',
    description: 'Approving a fact scrolls the list back to the top.',
    expectedBehavior: 'The list keeps its scroll position.',
    actualBehavior: 'The list jumps to the top after each approval.',
    status: 'New',
    priority: 'P2',
    noPhiConfirmed: true,
    ...over,
  };
}

describe('triage items require the no-PHI confirmation', () => {
  it('refuses to store an unconfirmed item', async () => {
    const db = await workspace();
    await expect(db.triage.create(draft({ noPhiConfirmed: false }))).rejects.toThrow(/no PHI/i);
    expect(await db.triage.list()).toHaveLength(0);
  });

  it('has no field capable of holding client content', async () => {
    const db = await workspace();
    const item = await db.triage.create(draft());
    for (const forbidden of FORBIDDEN_TRIAGE_FIELDS) {
      expect(item).not.toHaveProperty(forbidden);
    }
  });

  it('scrubs secret-shaped tokens out of free text', async () => {
    const db = await workspace();
    const item = await db.triage.create(
      draft({ description: 'Failed with key sk-abcd1234efgh5678ijkl in the console.' }), // secret-scan-allow: test fixture, not a real key
    );
    expect(item.description).not.toContain('sk-abcd1234efgh5678ijkl');
    expect(item.description).toContain('[redacted-key]');
  });
});

describe('triage references and lifecycle', () => {
  it('assigns sequential human-facing references', async () => {
    const db = await workspace();
    const a = await db.triage.create(draft());
    const b = await db.triage.create(draft({ featureArea: 'Timeline' }));
    expect(a.reference).toBe('FB-0001');
    expect(b.reference).toBe('FB-0002');
  });

  it('records a resolution time when an item closes, and clears it when reopened', async () => {
    const db = await workspace();
    const item = await db.triage.create(draft());
    expect(item.resolvedAt).toBeUndefined();

    const fixed = await db.triage.update(item.id, { status: 'Fixed', resolutionNotes: 'Preserved scroll position.' });
    expect(fixed.status).toBe('Fixed');
    expect(fixed.resolvedAt).toBeTruthy();

    const reopened = await db.triage.update(item.id, { status: 'Confirmed' });
    expect(reopened.resolvedAt).toBeUndefined();
  });

  it('creates a closed item with a resolution time immediately', async () => {
    const db = await workspace();
    const item = await db.triage.create(draft({ status: 'Not Planned' }));
    expect(item.resolvedAt).toBeTruthy();
  });

  it('deletes an item', async () => {
    const db = await workspace();
    const item = await db.triage.create(draft());
    await db.triage.remove(item.id);
    expect(await db.triage.list()).toHaveLength(0);
  });

  it('refuses to update an item that does not exist', async () => {
    const db = await workspace();
    await expect(db.triage.update('no-such-id', { status: 'Fixed' })).rejects.toThrow(/not found/i);
  });
});

describe('triage dashboard reflects stored items', () => {
  it('counts open items and surfaces blockers', async () => {
    const db = await workspace();
    await db.triage.create(draft({ severity: 'blocker', featureArea: 'Risk review' }));
    await db.triage.create(draft({ severity: 'major', featureArea: 'Risk review' }));
    await db.triage.create(draft({ severity: 'trivial', status: 'Closed' }));

    const dashboard = await db.triage.dashboard();
    expect(dashboard.total).toBe(3);
    expect(dashboard.open).toBe(2);
    expect(dashboard.highestSeverity[0].severity).toBe('blocker');
    expect(dashboard.openByFeature[0]).toEqual({ featureArea: 'Risk review', count: 2 });
  });

  it('flags a fixed-then-reopened item as a regression candidate', async () => {
    const db = await workspace();
    const item = await db.triage.create(draft());
    await db.triage.update(item.id, { status: 'Fixed' });
    // Reopening clears resolvedAt, so the item is open again and not a stale hit.
    await db.triage.update(item.id, { status: 'Confirmed' });

    const withCase = await db.triage.create(draft({ fictionalCaseId: 'case-sleep-01' }));
    const dashboard = await db.triage.dashboard();
    expect(dashboard.regressionCandidates.map((i) => i.id)).toContain(withCase.id);
  });
});

describe('promoting a Phase 8 bug report', () => {
  it('carries the report’s own fields and leaves judgement calls to a human', async () => {
    const db: ClinicalDatabase = await workspace();
    const report = await db.beta.addBugReport({
      appVersion: '0.9.0',
      platform: 'Browser development mode',
      screen: 'DAP note',
      issueType: 'incorrect-output',
      stepsToReproduce: 'Generate a note, then approve it.',
      expectedBehavior: 'The approved note keeps its evidence references.',
      actualBehavior: 'Evidence references are dropped on approval.',
      severity: 'major',
      noPhiConfirmed: true,
    });

    const item = await db.triage.fromBugReport(report, {
      category: 'Clinical-output quality',
      priority: 'P1',
      reproducibility: 'always',
      runtime: 'browser-development',
    });

    expect(item.featureArea).toBe('DAP note');
    expect(item.severity).toBe('major');
    expect(item.description).toBe('Generate a note, then approve it.');
    expect(item.actualBehavior).toBe('Evidence references are dropped on approval.');
    expect(item.category).toBe('Clinical-output quality');
    expect(item.status).toBe('New');
    expect(item.noPhiConfirmed).toBe(true);
  });

  it('will not promote a report that was never PHI-confirmed', async () => {
    const db = await workspace();
    await expect(
      db.triage.fromBugReport(
        {
          id: 'x',
          appVersion: '0.9.0',
          platform: 'p',
          screen: 's',
          issueType: 'crash',
          stepsToReproduce: 'a',
          expectedBehavior: 'b',
          actualBehavior: 'c',
          severity: 'minor',
          noPhiConfirmed: false,
          createdAt: new Date().toISOString(),
        },
        { category: 'Bug', priority: 'P2', reproducibility: 'once', runtime: 'browser-development' },
      ),
    ).rejects.toThrow(/no PHI/i);
  });
});

describe('triage storage is encrypted like everything else', () => {
  it('stores no plaintext triage text in the adapter', async () => {
    const db = await workspace();
    await db.triage.create(draft({ description: 'DISTINCTIVE-TRIAGE-MARKER-7781' }));
    const dump = JSON.stringify(await db.adapter.getAllRecords());
    expect(dump).not.toContain('DISTINCTIVE-TRIAGE-MARKER-7781');
  });
});
