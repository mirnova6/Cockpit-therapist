import { describe, expect, it } from 'vitest';
import type { AssessmentRecord } from '../db/structuredSchema';
import {
  computeRiskFlags,
  getDefinition,
  interpretRecord,
  scoreChange,
} from './definitions';

function record(overrides: Partial<AssessmentRecord>): AssessmentRecord {
  return {
    id: crypto.randomUUID(),
    clientId: 'c1',
    definitionKey: 'phq9',
    name: 'PHQ-9',
    dateAdministered: '2026-07-01',
    riskFlags: [],
    reviewStatus: 'approved',
    createdAt: '2026-07-01T00:00:00Z',
    updatedAt: '2026-07-01T00:00:00Z',
    version: 1,
    ...overrides,
  };
}

describe('assessment scoring rules', () => {
  it('PHQ-9 severity bands (Kroenke 2001)', () => {
    const bands: Array<[number, string]> = [
      [3, 'Minimal'],
      [7, 'Mild'],
      [12, 'Moderate'],
      [17, 'Moderately severe'],
      [24, 'Severe'],
    ];
    for (const [score, expected] of bands) {
      expect(interpretRecord({ definitionKey: 'phq9', totalScore: score })).toContain(expected);
    }
  });

  it('GAD-7 severity bands (Spitzer 2006)', () => {
    expect(interpretRecord({ definitionKey: 'gad7', totalScore: 3 })).toContain('Minimal');
    expect(interpretRecord({ definitionKey: 'gad7', totalScore: 8 })).toContain('Mild');
    expect(interpretRecord({ definitionKey: 'gad7', totalScore: 12 })).toContain('Moderate');
    expect(interpretRecord({ definitionKey: 'gad7', totalScore: 18 })).toContain('Severe');
  });

  it('AUDIT WHO zones', () => {
    expect(interpretRecord({ definitionKey: 'audit', totalScore: 5 })).toContain('Zone I');
    expect(interpretRecord({ definitionKey: 'audit', totalScore: 10 })).toContain('Zone II');
    expect(interpretRecord({ definitionKey: 'audit', totalScore: 17 })).toContain('Zone III');
    expect(interpretRecord({ definitionKey: 'audit', totalScore: 25 })).toContain('Zone IV');
  });

  it('DAST-10 bands', () => {
    expect(interpretRecord({ definitionKey: 'dast10', totalScore: 0 })).toContain('No problems');
    expect(interpretRecord({ definitionKey: 'dast10', totalScore: 4 })).toContain('Moderate');
    expect(interpretRecord({ definitionKey: 'dast10', totalScore: 9 })).toContain('Severe');
  });

  it('PCL-5 provisional cut-point wording avoids diagnosis claims', () => {
    const above = interpretRecord({ definitionKey: 'pcl5', totalScore: 45 });
    expect(above).toContain('cut-point');
    expect(above).toContain('Confirm with clinical interview');
    expect(interpretRecord({ definitionKey: 'pcl5', totalScore: 10 })).toContain('Below');
  });

  it('BAM-R has no invented interpretation', () => {
    expect(interpretRecord({ definitionKey: 'bamr', totalScore: 12 })).toBeUndefined();
  });

  it('custom assessments have no interpretation', () => {
    expect(interpretRecord({ definitionKey: 'custom', totalScore: 42 })).toBeUndefined();
    expect(getDefinition('custom')).toBeUndefined();
  });

  it('C-SSRS screener flags ideation and high acuity from encoded triage rules', () => {
    const low = {
      definitionKey: 'cssrs',
      subscaleScores: [
        { label: 'Highest ideation level endorsed', score: 2 },
        { label: 'Suicidal behavior (lifetime/recent per screener)', score: 0 },
      ],
    };
    expect(computeRiskFlags(low)).toEqual(['suicidal-ideation']);
    const high = {
      definitionKey: 'cssrs',
      subscaleScores: [
        { label: 'Highest ideation level endorsed', score: 5 },
        { label: 'Suicidal behavior (lifetime/recent per screener)', score: 0 },
      ],
    };
    expect(computeRiskFlags(high)).toEqual(['suicidal-ideation', 'high-acuity']);
    expect(interpretRecord({ ...high, totalScore: undefined })).toContain('full risk assessment');
    const none = {
      definitionKey: 'cssrs',
      subscaleScores: [
        { label: 'Highest ideation level endorsed', score: 0 },
        { label: 'Suicidal behavior (lifetime/recent per screener)', score: 0 },
      ],
    };
    expect(computeRiskFlags(none)).toEqual([]);
  });

  it('computes change vs the chronologically previous score', () => {
    const first = record({ dateAdministered: '2026-06-01', totalScore: 18 });
    const second = record({ dateAdministered: '2026-07-01', totalScore: 11 });
    const third = record({ dateAdministered: '2026-07-08', totalScore: 13 });
    const history = [third, first, second];

    const change2 = scoreChange(second, history);
    expect(change2).toMatchObject({ previousScore: 18, delta: -7, direction: 'improved' });
    expect(change2?.clinicallyMeaningful).toBe(true); // PHQ-9 ≥5 points

    const change3 = scoreChange(third, history);
    expect(change3).toMatchObject({ previousScore: 11, delta: 2, direction: 'worsened' });
    expect(change3?.clinicallyMeaningful).toBe(false);

    expect(scoreChange(first, history)).toBeUndefined();
  });

  it('does not claim meaningful change where no published threshold is encoded', () => {
    const a = record({ definitionKey: 'gad7', name: 'GAD-7', dateAdministered: '2026-06-01', totalScore: 15 });
    const b = record({ definitionKey: 'gad7', name: 'GAD-7', dateAdministered: '2026-07-01', totalScore: 8 });
    const change = scoreChange(b, [a, b]);
    expect(change?.direction).toBe('improved');
    expect(change?.clinicallyMeaningful).toBeUndefined();
  });
});
