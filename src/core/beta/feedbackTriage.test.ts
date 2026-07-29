import { describe, expect, it } from 'vitest';
import {
  buildDashboard,
  CLOSED_STATUSES,
  FEEDBACK_CATEGORIES,
  FEEDBACK_STATUSES,
  FORBIDDEN_TRIAGE_FIELDS,
  isOpen,
  type TriageItem,
} from './feedbackTriage';

function item(over: Partial<TriageItem> = {}): TriageItem {
  return {
    id: 'i1',
    reference: 'FB-0001',
    appVersion: '0.9.0',
    platform: 'Native desktop mode (Tauri)',
    runtime: 'native-desktop',
    featureArea: 'Documents',
    category: 'Bug',
    severity: 'major',
    reproducibility: 'always',
    description: 'Draft fails to open',
    expectedBehavior: 'Opens',
    actualBehavior: 'Blank screen',
    status: 'New',
    priority: 'P1',
    noPhiConfirmed: true,
    createdAt: '2026-07-01T00:00:00Z',
    ...over,
  };
}

describe('taxonomy completeness', () => {
  it('provides all 15 required categories and 9 statuses', () => {
    expect(FEEDBACK_CATEGORIES).toHaveLength(15);
    expect(FEEDBACK_STATUSES).toHaveLength(9);
    expect(FEEDBACK_CATEGORIES).toContain('Risk-workflow concern');
    expect(FEEDBACK_CATEGORIES).toContain('Accessibility issue');
    expect(FEEDBACK_STATUSES).toContain('Cannot Reproduce');
  });

  it('classifies open vs closed correctly', () => {
    expect(isOpen(item({ status: 'New' }))).toBe(true);
    expect(isOpen(item({ status: 'In Progress' }))).toBe(true);
    for (const s of CLOSED_STATUSES) expect(isOpen(item({ status: s }))).toBe(false);
  });
});

describe('triage items cannot carry PHI', () => {
  it('has no field capable of holding a client record, prompt, output or key', () => {
    const keys = Object.keys(item());
    for (const forbidden of FORBIDDEN_TRIAGE_FIELDS) {
      expect(keys).not.toContain(forbidden);
    }
  });

  it('carries the no-PHI confirmation', () => {
    expect(item().noPhiConfirmed).toBe(true);
  });
});

describe('dashboard', () => {
  const items = [
    item({ id: '1', category: 'Bug', severity: 'blocker', featureArea: 'Documents', status: 'New' }),
    item({ id: '2', category: 'Bug', severity: 'minor', featureArea: 'Retrieval', status: 'Confirmed' }),
    item({ id: '3', category: 'Retrieval issue', severity: 'major', featureArea: 'Retrieval', status: 'In Progress', providerId: 'local-endpoint' }),
    item({ id: '4', category: 'Performance issue', severity: 'trivial', status: 'Fixed', resolvedAt: '2026-07-10T00:00:00Z' }),
    item({ id: '5', category: 'Bug', severity: 'major', status: 'Confirmed', fictionalCaseId: 'case-3', platform: 'Browser development mode' }),
  ];
  const d = buildDashboard(items);

  it('counts totals and open items', () => {
    expect(d.total).toBe(5);
    expect(d.open).toBe(4); // one Fixed
  });

  it('ranks most common issues', () => {
    expect(d.mostCommon[0]).toEqual({ category: 'Bug', count: 3 });
  });

  it('surfaces highest-severity open items first', () => {
    expect(d.highestSeverity[0].severity).toBe('blocker');
    // A fixed trivial item is not in the severity list.
    expect(d.highestSeverity.every((i) => i.status !== 'Fixed')).toBe(true);
  });

  it('groups open issues by feature, and all issues by platform and provider', () => {
    expect(d.openByFeature.find((f) => f.featureArea === 'Retrieval')?.count).toBe(2);
    expect(d.byPlatform.find((p) => p.platform === 'Browser development mode')?.count).toBe(1);
    expect(d.byProvider).toEqual([{ providerId: 'local-endpoint', count: 1 }]);
  });

  it('lists recently resolved items', () => {
    expect(d.recentlyResolved.map((i) => i.id)).toEqual(['4']);
  });

  it('flags regression candidates that reproduce against a fictional case', () => {
    expect(d.regressionCandidates.map((i) => i.id)).toContain('5');
  });
});
