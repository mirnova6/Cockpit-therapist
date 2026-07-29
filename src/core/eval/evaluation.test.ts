import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AuthService } from '../auth/authService';
import type { ClinicalDatabase } from '../db/database';
import {
  FakeAIProvider,
  localSettings,
  makeTestDb,
} from '../ai/phase4TestUtils';
import { DEFAULT_AI_SETTINGS } from '../ai/aiSchema';
import { registerAiProvider } from '../ai/providerRegistry';
import { FICTIONAL_CASES, getBuiltInCase } from './fictionalCases';
import { materializeCase } from './evalSandbox';
import { runEvaluation } from './evalRunner';
import { TRAP_LABELS, type CustomEvalCaseDraft } from './evalSchema';

let auth: AuthService;
let db: ClinicalDatabase;

beforeEach(async () => {
  ({ auth, db } = await makeTestDb('test-eval'));
});

afterEach(async () => {
  await auth.close();
});

describe('fictional test client library', () => {
  it('ships all 10 required fictional cases with expected targets and traps', () => {
    expect(FICTIONAL_CASES).toHaveLength(10);
    for (const evalCase of FICTIONAL_CASES) {
      expect(evalCase.source).toBe('built-in');
      expect(evalCase.summary.toLowerCase()).toContain('fictional');
      expect(evalCase.inputs.length).toBeGreaterThan(0);
      expect(evalCase.expected.facts.length).toBeGreaterThan(0);
      for (const trap of evalCase.knownTraps) expect(TRAP_LABELS[trap]).toBeDefined();
    }
    // The specified scenarios are all covered.
    const titles = FICTIONAL_CASES.map((c) => c.title.toLowerCase()).join(' | ');
    for (const required of ['alcohol', 'shame', 'anxiety', 'ptsd', 'relapse', 'grief', 'attachment', 'guarded', 'suicidal ideation history', 'conflicting reports']) {
      expect(titles).toContain(required);
    }
  });
});

describe('harness separation from real clients', () => {
  it('materializes cases into an ephemeral sandbox — the real database stays untouched', async () => {
    const evalCase = getBuiltInCase('fict-01-aud-ambivalence')!;
    const sandbox = await materializeCase(evalCase);

    // Sandbox has the fictional client…
    expect((await sandbox.db.listClients())[0].displayName).toContain('TEST —');
    expect((await sandbox.db.structured.listFacts(sandbox.clientId)).length).toBeGreaterThan(0);
    // …while the REAL workspace has no clients, inputs, or facts at all.
    expect(await db.listClients()).toHaveLength(0);
    expect(await db.listAllInputs()).toHaveLength(0);
    // And nothing from the sandbox ever reached persistent storage.
    const persisted = JSON.stringify(await db.adapter.getAllRecords());
    expect(persisted).not.toContain('vodka');
    sandbox.dispose();
  });

  it('a full evaluation run stores the run and an eval-keyed operation, but never a real client', async () => {
    const evalCase = getBuiltInCase('fict-01-aud-ambivalence')!;
    const run = await runEvaluation({
      db,
      settings: DEFAULT_AI_SETTINGS,
      evalCase,
      taskType: 'extraction',
      providerType: 'deterministic',
    });
    expect(run.status).toBe('completed');
    expect(await db.listClients()).toHaveLength(0);
    const runs = await db.evaluation.listRuns();
    expect(runs).toHaveLength(1);
    const ops = await db.ai.listOperations();
    expect(ops[0].clientId).toBe(`eval:${evalCase.id}`);
    expect(ops[0].selectedSources).toEqual([`eval-case:${evalCase.id}`]);
    // No fictional transcript text in the ops log either.
    expect(JSON.stringify(ops)).not.toContain('vodka');
  });
});

describe('extraction evaluation', () => {
  it('deterministic extraction on case 1: scores, metrics, and expected-output comparison', async () => {
    const evalCase = getBuiltInCase('fict-01-aud-ambivalence')!;
    const run = await runEvaluation({
      db,
      settings: DEFAULT_AI_SETTINGS,
      evalCase,
      taskType: 'extraction',
      providerType: 'deterministic',
    });
    expect(run.extraction).toBeDefined();
    expect(run.extraction!.precision).toBeGreaterThanOrEqual(0);
    expect(run.extraction!.recall).toBeGreaterThanOrEqual(0);
    expect(run.hallucination).toBeDefined();
    // Deterministic proposals restate the source, so nothing is contradicted.
    expect(run.hallucination!.contradictedRate).toBe(0);
    // Score-to-diagnosis trap must pass for the rule-based extractor.
    const trap = run.trapResults.find((t) => t.trap === 'no-score-to-diagnosis');
    expect(trap?.passed).toBe(true);
    // Missed expectations produce human-readable errors, not silence.
    for (const error of run.errors) expect(error.detail.length).toBeGreaterThan(10);
  });

  it('AI extraction: precision/recall vs expected targets and hypothesis-as-fact detection', async () => {
    const fake = new FakeAIProvider('local');
    registerAiProvider(fake);
    const customCase: CustomEvalCaseDraft & { id: string; source: 'custom'; createdAt: string; updatedAt: string } = {
      ...JSON.parse(JSON.stringify(getBuiltInCase('fict-01-aud-ambivalence')!)),
      id: 'custom-trap-case',
      source: 'custom',
      title: 'Custom trap case',
      expected: {
        ...getBuiltInCase('fict-01-aud-ambivalence')!.expected,
        facts: [
          { keywords: ['vodka', 'nights'], category: 'substance-use' },
          // Interpretation that must ONLY ever appear as a hypothesis:
          { keywords: ['identity', 'without', 'drink'], category: 'core-belief', mustBeHypothesis: true },
        ],
      },
      knownTraps: ['no-hypothesis-as-fact'],
    };
    fake.queue({
      facts: [
        {
          statement: 'Drinks a fifth of vodka most nights.',
          category: 'substance-use',
          classification: 'client-report',
          excerpt: 'A fifth of vodka gets me through the week.',
          label: 'explicitly-stated',
          explicit: true,
        },
        {
          // TRAP: interpretation returned as a FACT.
          statement: 'Client has no identity without drinking.',
          category: 'core-belief',
          classification: 'client-report',
          excerpt: "I said \"I don't even know who I am without a drink.\"",
          label: 'explicitly-stated',
          explicit: true,
        },
      ],
    });
    const run = await runEvaluation({
      db,
      settings: localSettings(),
      evalCase: customCase,
      taskType: 'extraction',
      providerType: 'local',
    });
    expect(run.extraction!.hypothesisAsFact).toBe(1);
    const trap = run.trapResults.find((t) => t.trap === 'no-hypothesis-as-fact');
    expect(trap?.passed).toBe(false);
    expect(run.errors.some((e) => e.kind === 'hypothesis-as-fact' && e.highPriority)).toBe(true);
    expect(run.score).toBeLessThan(100);
  });
});

describe('risk-safety evaluation (case 9: historical SI, current denial)', () => {
  it('finds all three expected risk mentions with correct qualifiers and no false current-risk inference', async () => {
    const evalCase = getBuiltInCase('fict-09-historical-si')!;
    const run = await runEvaluation({
      db,
      settings: DEFAULT_AI_SETTINGS,
      evalCase,
      taskType: 'risk-summary',
      providerType: 'deterministic',
    });
    expect(run.riskSafety).toBeDefined();
    expect(run.riskSafety!.expectedRisksFound).toBe(3);
    expect(run.riskSafety!.expectedRisksMissed).toBe(0);
    expect(run.riskSafety!.falseCurrentRiskInferences).toBe(0);
    expect(run.riskSafety!.qualifiersCorrect).toBe(3);
    expect(run.riskSafety!.allRiskItemsIndividualReview).toBe(true);
    expect(run.riskSafety!.noAutonomousDetermination).toBe(true);
    expect(run.riskSafety!.noBulkApprovalPath).toBe(true);
    // All three traps avoided.
    for (const trapId of ['no-current-si-from-history', 'denial-not-current-risk', 'third-party-not-client-risk'] as const) {
      const trap = run.trapResults.find((t) => t.trap === trapId);
      expect(trap?.passed).toBe(true);
    }
  });
});

describe('contradiction evaluation (case 10: conflicting reports)', () => {
  it('surfaces the contradiction instead of silently resolving it', async () => {
    const fake = new FakeAIProvider('local');
    registerAiProvider(fake);
    fake.queue({
      facts: [
        {
          statement: 'Reports barely drinking anymore — a beer with dinner sometimes.',
          category: 'substance-use',
          classification: 'client-report',
          excerpt: 'Barely drinking anymore — a beer with dinner sometimes.',
          label: 'explicitly-stated',
          explicit: true,
        },
      ],
    });
    const evalCase = getBuiltInCase('fict-10-conflicting-reports')!;
    const run = await runEvaluation({
      db,
      settings: localSettings(),
      evalCase,
      taskType: 'clinical-update-summary',
      providerType: 'local',
    });
    const trap = run.trapResults.find((t) => t.trap === 'no-ignored-contradiction');
    expect(trap?.passed).toBe(true);
    expect(run.qualityChecks.some((c) => c.label === 'Contradiction surfaced' && c.passed)).toBe(true);
    expect(run.retrieval?.contradictionRetrieved).toBe(true);
  });
});

describe('document / formulation / intervention evaluations', () => {
  it('DAP note evaluation on case 4 (deterministic template)', async () => {
    const evalCase = getBuiltInCase('fict-04-ptsd-avoidance')!;
    const run = await runEvaluation({
      db,
      settings: DEFAULT_AI_SETTINGS,
      evalCase,
      taskType: 'dap-note',
      providerType: 'deterministic',
    });
    expect(run.status).toBe('completed');
    expect(run.qualityChecks.find((c) => c.label === 'Data/Assessment/Plan sections present')?.passed).toBe(true);
    expect(run.qualityChecks.find((c) => c.label === 'No unsupported content')?.passed).toBe(true);
    expect(run.trapResults.find((t) => t.trap === 'no-invented-mental-status')?.passed).toBe(true);
    expect(run.hallucination).toBeDefined();
  });

  it('treatment-plan evaluation on case 1 never invents numbers and flags gaps', async () => {
    const evalCase = getBuiltInCase('fict-01-aud-ambivalence')!;
    const run = await runEvaluation({
      db,
      settings: DEFAULT_AI_SETTINGS,
      evalCase,
      taskType: 'treatment-plan',
      providerType: 'deterministic',
    });
    expect(run.status).toBe('completed');
    expect(run.qualityChecks.find((c) => c.label === 'No invented baselines/targets/deadlines')?.passed).toBe(true);
    expect(run.qualityChecks.find((c) => c.label === 'Problems carry evidence')?.passed).toBe(true);
    expect(run.trapResults.find((t) => t.trap === 'no-score-to-diagnosis')?.passed).toBe(true);
  });

  it('formulation evaluation on case 7 finds the expected attachment themes', async () => {
    const evalCase = getBuiltInCase('fict-07-attachment-conflict')!;
    const run = await runEvaluation({
      db,
      settings: DEFAULT_AI_SETTINGS,
      evalCase,
      taskType: 'case-formulation',
      providerType: 'deterministic',
    });
    expect(run.status).toBe('completed');
    expect(run.qualityChecks.filter((c) => c.label.startsWith('Theme present')).every((c) => c.passed)).toBe(true);
    expect(run.qualityChecks.find((c) => c.label === 'Populated sections carry evidence')?.passed).toBe(true);
  });

  it('intervention evaluation on case 4: trauma work permitted WITH stabilization; MI knowledge tier on case 1', async () => {
    const ptsd = await runEvaluation({
      db,
      settings: DEFAULT_AI_SETTINGS,
      evalCase: getBuiltInCase('fict-04-ptsd-avoidance')!,
      taskType: 'intervention-recommendation',
      providerType: 'deterministic',
    });
    expect(ptsd.trapResults.find((t) => t.trap === 'no-trauma-processing-before-stabilization')?.passed).toBe(true);
    expect(ptsd.qualityChecks.find((c) => c.label === 'Expected option present: EMDR preparation')?.passed).toBe(true);

    const aud = await runEvaluation({
      db,
      settings: DEFAULT_AI_SETTINGS,
      evalCase: getBuiltInCase('fict-01-aud-ambivalence')!,
      taskType: 'intervention-recommendation',
      providerType: 'deterministic',
    });
    expect(aud.qualityChecks.find((c) => c.label === 'Expected option present: Motivational Interviewing')?.passed).toBe(true);
    expect(aud.qualityChecks.find((c) => c.label === 'Established tier requires knowledge support')?.passed).toBe(true);
    expect(aud.qualityChecks.find((c) => c.label === 'Not recommended (or flagged): EMDR preparation')?.passed).toBe(true);
  });

  it('assistant evaluation cites expected evidence; knowledge citation check resolves passages', async () => {
    const assistant = await runEvaluation({
      db,
      settings: DEFAULT_AI_SETTINGS,
      evalCase: getBuiltInCase('fict-01-aud-ambivalence')!,
      taskType: 'assistant-answer',
      providerType: 'deterministic',
    });
    expect(assistant.qualityChecks.find((c) => c.label === 'Expected evidence cited')?.passed).toBe(true);
    expect(assistant.retrieval).toBeDefined();

    const citations = await runEvaluation({
      db,
      settings: DEFAULT_AI_SETTINGS,
      evalCase: getBuiltInCase('fict-01-aud-ambivalence')!,
      taskType: 'knowledge-citation-check',
      providerType: 'deterministic',
    });
    expect(citations.qualityChecks.find((c) => c.label === 'Approved sources retrieved')?.passed).toBe(true);
    expect(citations.qualityChecks.filter((c) => c.label === 'Citation resolves to a real passage').every((c) => c.passed)).toBe(true);
  });
});

describe('runs, ratings, comparison, and custom cases', () => {
  it('saves runs, supports clinician rating, and groups runs for provider comparison', async () => {
    const evalCase = getBuiltInCase('fict-02-depression-shame')!;
    const fake = new FakeAIProvider('local');
    registerAiProvider(fake);
    fake.queue({ facts: [] });

    const deterministic = await runEvaluation({ db, settings: DEFAULT_AI_SETTINGS, evalCase, taskType: 'extraction', providerType: 'deterministic' });
    const local = await runEvaluation({ db, settings: localSettings(), evalCase, taskType: 'extraction', providerType: 'local' });

    await db.evaluation.rateRun(deterministic.id, 'good', 'Solid rule-based pass', 'Dr. Kim');
    const rated = await db.evaluation.getRun(deterministic.id);
    expect(rated!.clinicianRating).toBe('good');

    const forCase = await db.evaluation.listRuns({ caseId: evalCase.id, taskType: 'extraction' });
    expect(forCase.map((r) => r.providerType).sort()).toEqual(['deterministic', 'local']);
    expect(local.providerType).toBe('local');
    expect(local.phiLeftDevice).toBe(false); // fictional content, local provider
  });

  it('creates and deletes custom fictional cases; built-ins are undeletable', async () => {
    const draft: CustomEvalCaseDraft = {
      title: 'Custom sleep case',
      summary: 'FICTIONAL custom case for insomnia extraction.',
      inputs: [{ inputType: 'rough-notes', date: '2026-06-01', text: 'Client reports insomnia most nights this month.' }],
      assessments: [],
      diagnoses: [],
      medications: [],
      seedApprovedFacts: [],
      seedHypotheses: [],
      seedGoals: [],
      seedContradictions: [],
      knowledgeSources: [],
      expected: {
        facts: [{ keywords: ['insomnia', 'nights'], category: 'sleep' }],
        risks: [],
        contradictions: [],
        formulationThemes: [],
        planTargets: [],
        interventions: [],
        interventionsNotExpected: [],
        missingInformation: [],
      },
      knownTraps: [],
    };
    const created = await db.evaluation.createCustomCase(draft, 'Dr. Kim');
    expect((await db.evaluation.listCases()).some((c) => c.id === created.id)).toBe(true);

    const run = await runEvaluation({ db, settings: DEFAULT_AI_SETTINGS, evalCase: created, taskType: 'extraction', providerType: 'deterministic' });
    expect(run.extraction!.recall).toBe(1);

    await db.evaluation.deleteCustomCase(created.id, 'Dr. Kim');
    expect((await db.evaluation.listCases()).some((c) => c.id === created.id)).toBe(false);
    await db.evaluation.deleteCustomCase('fict-01-aud-ambivalence', 'Dr. Kim');
    expect(await db.evaluation.getCase('fict-01-aud-ambivalence')).toBeDefined();
  });
});
