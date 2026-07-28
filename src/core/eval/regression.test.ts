import { describe, expect, it } from 'vitest';
import {
  buildRegressionReport,
  compareToBaseline,
  DEFAULT_THRESHOLDS,
  renderRegressionText,
  summarizeRuns,
} from './regression';
import type { EvalRun } from './evalSchema';

function run(over: Partial<EvalRun> = {}): EvalRun {
  return {
    id: 'r1',
    caseId: 'case-1',
    caseTitle: 'Fictional case',
    caseSource: 'built-in',
    taskType: 'extraction',
    providerType: 'deterministic',
    providerId: 'deterministic',
    modelId: 'rule-based',
    startedAt: '2026-01-01T00:00:00Z',
    finishedAt: '2026-01-01T00:00:01Z',
    durationMs: 1000,
    status: 'completed',
    outputPreview: '',
    qualityChecks: [],
    trapResults: [],
    errors: [],
    score: 80,
    phiLeftDevice: false,
    createdAt: '2026-01-01T00:00:00Z',
    ...(over as object),
  } as EvalRun;
}

describe('regression summary', () => {
  it('aggregates scores, risk failures and trap failures', () => {
    const m = summarizeRuns([
      run({ score: 90 }),
      run({ score: 70, errors: [{ label: 'risk missed', detail: 'x', highPriority: true } as never] }),
      run({ score: 80, trapResults: [{ trap: 't', passed: false, detail: 'd' } as never] }),
    ]);
    expect(m.runCount).toBe(3);
    expect(m.meanScore).toBe(80);
    expect(m.riskFailures).toBe(1);
    expect(m.trapFailures).toBe(1);
  });

  it('counts isolation and contradiction failures from retrieval metrics', () => {
    const m = summarizeRuns([
      run({
        retrieval: {
          expectedRetrieved: 1,
          expectedMissed: 2,
          irrelevantRetrieved: 0,
          contradictionRetrieved: false,
          timePeriodsCovered: 1,
          isolationVerified: false,
          failureExplanations: [],
        },
      }),
    ]);
    expect(m.isolationFailures).toBe(1);
    expect(m.missedContradictions).toBe(1);
    expect(m.retrievalFailures).toBe(2);
  });
});

describe('safety gates always fail the run', () => {
  it('fails on ANY risk-safety failure even with a perfect score', () => {
    const report = buildRegressionReport({
      runs: [run({ score: 100, errors: [{ label: 'r', detail: 'd', highPriority: true } as never] })],
      providerType: 'deterministic',
      modelId: 'rule-based',
      retrievalMode: 'lexical',
    });
    expect(report.passed).toBe(false);
    expect(report.safetyFailures.join(' ')).toMatch(/RISK SAFETY/);
    expect(DEFAULT_THRESHOLDS.maxRiskFailures).toBe(0);
  });

  it('fails on ANY cross-client isolation failure', () => {
    const report = buildRegressionReport({
      runs: [
        run({
          score: 100,
          retrieval: {
            expectedRetrieved: 1,
            expectedMissed: 0,
            irrelevantRetrieved: 0,
            contradictionRetrieved: true,
            timePeriodsCovered: 2,
            isolationVerified: false,
            failureExplanations: [],
          },
        }),
      ],
      providerType: 'deterministic',
      modelId: 'rule-based',
      retrievalMode: 'hybrid',
    });
    expect(report.passed).toBe(false);
    expect(report.safetyFailures.join(' ')).toMatch(/ISOLATION/);
  });

  it('passes a clean run and records fictional-only provenance', () => {
    const report = buildRegressionReport({
      runs: [run({ score: 85 })],
      providerType: 'deterministic',
      modelId: 'rule-based',
      retrievalMode: 'lexical',
    });
    expect(report.passed).toBe(true);
    expect(report.safetyFailures).toEqual([]);
    expect(report.fictionalOnly).toBe(true);
    expect(report.commit).toBeTruthy();
  });

  it('fails when the mean score drops below the threshold', () => {
    const report = buildRegressionReport({
      runs: [run({ score: 10 })],
      providerType: 'local',
      modelId: 'tiny',
      retrievalMode: 'lexical',
    });
    expect(report.passed).toBe(false);
    expect(report.failures.join(' ')).toMatch(/below the/);
  });
});

describe('baseline comparison', () => {
  const base = buildRegressionReport({
    runs: [run({ score: 85 })],
    providerType: 'deterministic',
    modelId: 'rule-based',
    retrievalMode: 'lexical',
  });

  it('flags a safety regression against the baseline', () => {
    const current = buildRegressionReport({
      runs: [run({ score: 85, errors: [{ label: 'r', detail: 'd', highPriority: true } as never] })],
      providerType: 'deterministic',
      modelId: 'rule-based',
      retrievalMode: 'lexical',
    });
    const cmp = compareToBaseline(current, base);
    expect(cmp.regressed).toBe(true);
    expect(cmp.safetyRegressed).toBe(true);
    const risk = cmp.comparisons.find((c) => c.metric.startsWith('Risk'));
    expect(risk?.direction).toBe('regressed');
  });

  it('reports improvement and unchanged metrics correctly', () => {
    const better = buildRegressionReport({
      runs: [run({ score: 95 })],
      providerType: 'deterministic',
      modelId: 'rule-based',
      retrievalMode: 'lexical',
    });
    const cmp = compareToBaseline(better, base);
    expect(cmp.safetyRegressed).toBe(false);
    expect(cmp.comparisons.find((c) => c.metric === 'Mean internal score')?.direction).toBe('improved');
  });
});

describe('rendered report', () => {
  it('states fictional-only and non-blocking nature, and never claims validation', () => {
    const text = renderRegressionText(
      buildRegressionReport({
        runs: [run()],
        providerType: 'deterministic',
        modelId: 'rule-based',
        retrievalMode: 'lexical',
      }),
    );
    expect(text).toContain('FICTIONAL CASES ONLY');
    expect(text).toMatch(/NOT clinically validated/i);
    expect(text).toMatch(/does not block application use/i);
  });
});
