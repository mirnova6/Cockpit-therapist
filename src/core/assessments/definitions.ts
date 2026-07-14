/**
 * Built-in assessment definitions.
 *
 * ONLY officially published scoring rules are encoded, with the source cited
 * next to each rule. Anything without a verified rule returns `undefined`,
 * which the UI renders as:
 *   "Score recorded. Interpretation rules not yet configured."
 *
 * Every interpretation is a SCREENING statement — never a diagnosis. The UI
 * appends each definition's screeningNote wherever an interpretation shows.
 */
import type { AssessmentRecord } from '../db/structuredSchema';

export interface CategoricalField {
  key: string;
  label: string;
  options: Array<{ value: number; label: string }>;
}

export interface AssessmentDefinition {
  key: string;
  label: string;
  fullName: string;
  entry: 'total' | 'categorical';
  min?: number;
  max?: number;
  /** All built-in measures here score symptom burden: lower = better. */
  lowerIsBetter: boolean;
  /** Named subscale entry fields (optional scores alongside the total). */
  subscales?: string[];
  /** Categorical entry fields (C-SSRS screener). */
  categoricalFields?: CategoricalField[];
  /** Returns severity text from encoded official rules, or undefined. */
  interpret?: (record: Pick<AssessmentRecord, 'totalScore' | 'subscaleScores'>) => string | undefined;
  /**
   * Published clinically meaningful change in points, if one exists.
   * PHQ-9: ≥5 points (Kroenke 2001; McMillan 2010).
   * PCL-5: 5 points reliable change, 10 points clinically meaningful
   * (U.S. National Center for PTSD PCL-5 guidance).
   */
  meaningfulChange?: number;
  /** Returns risk flags derived from encoded official rules. */
  riskFlags?: (record: Pick<AssessmentRecord, 'totalScore' | 'subscaleScores'>) => string[];
  /** Extra boolean risk question shown at entry (e.g. PHQ-9 item 9). */
  riskQuestion?: { key: string; label: string; flag: string };
  screeningNote: string;
}

function band(
  score: number,
  bands: Array<[min: number, max: number, label: string]>,
): string | undefined {
  const hit = bands.find(([min, max]) => score >= min && score <= max);
  return hit?.[2];
}

export const ASSESSMENT_DEFINITIONS: AssessmentDefinition[] = [
  {
    key: 'phq9',
    label: 'PHQ-9',
    fullName: 'Patient Health Questionnaire-9 (depression screening)',
    entry: 'total',
    min: 0,
    max: 27,
    lowerIsBetter: true,
    // Kroenke, Spitzer & Williams (2001), J Gen Intern Med 16:606-613.
    interpret: (r) =>
      r.totalScore === undefined
        ? undefined
        : band(r.totalScore, [
            [0, 4, 'Minimal depression severity'],
            [5, 9, 'Mild depression severity'],
            [10, 14, 'Moderate depression severity'],
            [15, 19, 'Moderately severe depression severity'],
            [20, 27, 'Severe depression severity'],
          ]),
    meaningfulChange: 5,
    riskQuestion: {
      key: 'item9',
      label: 'Item 9 (thoughts of death or self-harm) endorsed above zero',
      flag: 'self-harm-item-endorsed',
    },
    screeningNote: 'PHQ-9 is a depression screening measure, not a diagnostic instrument.',
  },
  {
    key: 'gad7',
    label: 'GAD-7',
    fullName: 'Generalized Anxiety Disorder-7 (anxiety screening)',
    entry: 'total',
    min: 0,
    max: 21,
    lowerIsBetter: true,
    // Spitzer, Kroenke, Williams & Löwe (2006), Arch Intern Med 166:1092-1097.
    interpret: (r) =>
      r.totalScore === undefined
        ? undefined
        : band(r.totalScore, [
            [0, 4, 'Minimal anxiety severity'],
            [5, 9, 'Mild anxiety severity'],
            [10, 14, 'Moderate anxiety severity'],
            [15, 21, 'Severe anxiety severity'],
          ]),
    screeningNote: 'GAD-7 is an anxiety screening measure, not a diagnostic instrument.',
  },
  {
    key: 'pcl5',
    label: 'PCL-5',
    fullName: 'PTSD Checklist for DSM-5',
    entry: 'total',
    min: 0,
    max: 80,
    lowerIsBetter: true,
    // U.S. National Center for PTSD: a cut-point of 31-33 suggests probable
    // PTSD; diagnosis requires a structured clinical interview.
    interpret: (r) =>
      r.totalScore === undefined
        ? undefined
        : r.totalScore >= 31
          ? 'At or above the provisional PTSD cut-point range (31–33). Confirm with clinical interview.'
          : 'Below the provisional PTSD cut-point range (31–33).',
    meaningfulChange: 10,
    screeningNote:
      'PCL-5 is a symptom screening measure; PTSD diagnosis requires a clinical interview (e.g. CAPS-5).',
  },
  {
    key: 'bamr',
    label: 'BAM-R',
    fullName: 'Brief Addiction Monitor — Revised',
    entry: 'total',
    min: 0,
    lowerIsBetter: true,
    subscales: ['Use', 'Risk factors', 'Protective factors'],
    // No universally published total-score severity banding is encoded here.
    interpret: () => undefined,
    screeningNote:
      'BAM-R is a monitoring tool. No severity interpretation rules are configured for it.',
  },
  {
    key: 'cssrs',
    label: 'C-SSRS (Screener)',
    fullName: 'Columbia Suicide Severity Rating Scale — Screener',
    entry: 'categorical',
    lowerIsBetter: true,
    categoricalFields: [
      {
        key: 'ideation',
        label: 'Highest ideation level endorsed',
        options: [
          { value: 0, label: '0 — No suicidal ideation reported' },
          { value: 1, label: '1 — Wish to be dead' },
          { value: 2, label: '2 — Nonspecific active suicidal thoughts' },
          { value: 3, label: '3 — Active ideation with method, no intent' },
          { value: 4, label: '4 — Active ideation with some intent, no plan' },
          { value: 5, label: '5 — Active ideation with plan and intent' },
        ],
      },
      {
        key: 'behavior',
        label: 'Suicidal behavior (lifetime/recent per screener)',
        options: [
          { value: 0, label: 'No behavior reported' },
          { value: 1, label: 'Behavior reported' },
        ],
      },
    ],
    // Columbia Protocol screener triage: any ideation endorses a positive
    // screen; levels 4-5 or any behavior indicate the highest triage category.
    interpret: (r) => {
      const ideation = r.subscaleScores?.find((s) => s.label.startsWith('Highest ideation'))?.score;
      const behavior = r.subscaleScores?.find((s) => s.label.startsWith('Suicidal behavior'))?.score;
      if (ideation === undefined) return undefined;
      if ((behavior ?? 0) > 0 || ideation >= 4)
        return 'Positive screen — highest triage category per Columbia Protocol. Clinician must complete a full risk assessment.';
      if (ideation >= 1)
        return 'Positive screen for suicidal ideation. Clinician must complete a full risk assessment.';
      return 'Screener negative for current ideation as recorded. Clinical judgment still governs.';
    },
    riskFlags: (r) => {
      const ideation = r.subscaleScores?.find((s) => s.label.startsWith('Highest ideation'))?.score ?? 0;
      const behavior = r.subscaleScores?.find((s) => s.label.startsWith('Suicidal behavior'))?.score ?? 0;
      const flags: string[] = [];
      if (ideation >= 1) flags.push('suicidal-ideation');
      if (ideation >= 4 || behavior > 0) flags.push('high-acuity');
      return flags;
    },
    screeningNote:
      'The C-SSRS screener is a triage tool. It never replaces a full clinician risk assessment.',
  },
  {
    key: 'audit',
    label: 'AUDIT',
    fullName: 'Alcohol Use Disorders Identification Test',
    entry: 'total',
    min: 0,
    max: 40,
    lowerIsBetter: true,
    // WHO AUDIT manual (2nd ed., 2001) risk zones.
    interpret: (r) =>
      r.totalScore === undefined
        ? undefined
        : band(r.totalScore, [
            [0, 7, 'WHO Zone I — lower-risk drinking'],
            [8, 15, 'WHO Zone II — hazardous drinking range'],
            [16, 19, 'WHO Zone III — harmful drinking range'],
            [20, 40, 'WHO Zone IV — possible alcohol dependence; further evaluation indicated'],
          ]),
    screeningNote: 'AUDIT is an alcohol-use screening measure, not a diagnostic instrument.',
  },
  {
    key: 'dast10',
    label: 'DAST-10',
    fullName: 'Drug Abuse Screening Test (10-item)',
    entry: 'total',
    min: 0,
    max: 10,
    lowerIsBetter: true,
    // Skinner (1982); DAST-10 published interpretation bands.
    interpret: (r) =>
      r.totalScore === undefined
        ? undefined
        : band(r.totalScore, [
            [0, 0, 'No problems reported'],
            [1, 2, 'Low level of problems related to drug use'],
            [3, 5, 'Moderate level of problems related to drug use'],
            [6, 8, 'Substantial level of problems related to drug use'],
            [9, 10, 'Severe level of problems related to drug use'],
          ]),
    screeningNote: 'DAST-10 is a drug-use screening measure, not a diagnostic instrument.',
  },
];

export const CUSTOM_DEFINITION_KEY = 'custom';

export function getDefinition(key: string): AssessmentDefinition | undefined {
  return ASSESSMENT_DEFINITIONS.find((d) => d.key === key);
}

export const NOT_CONFIGURED_TEXT = 'Score recorded. Interpretation rules not yet configured.';

/** Computes interpretation from encoded rules only. */
export function interpretRecord(
  record: Pick<AssessmentRecord, 'definitionKey' | 'totalScore' | 'subscaleScores'>,
): string | undefined {
  const def = getDefinition(record.definitionKey);
  return def?.interpret?.(record);
}

export function computeRiskFlags(
  record: Pick<AssessmentRecord, 'definitionKey' | 'totalScore' | 'subscaleScores'>,
): string[] {
  const def = getDefinition(record.definitionKey);
  return def?.riskFlags?.(record) ?? [];
}

export interface ScoreChange {
  previousScore: number;
  delta: number;
  direction: 'improved' | 'worsened' | 'unchanged';
  clinicallyMeaningful?: boolean;
}

/**
 * Change vs the chronologically previous record of the same measure.
 * Direction uses the definition's lowerIsBetter; meaningful-change only when
 * a published threshold is encoded.
 */
export function scoreChange(
  record: AssessmentRecord,
  history: AssessmentRecord[],
): ScoreChange | undefined {
  if (record.totalScore === undefined) return undefined;
  const prior = history
    .filter(
      (h) =>
        h.definitionKey === record.definitionKey &&
        h.name === record.name &&
        h.id !== record.id &&
        h.totalScore !== undefined &&
        (h.dateAdministered < record.dateAdministered ||
          (h.dateAdministered === record.dateAdministered && h.createdAt < record.createdAt)),
    )
    .sort((a, b) => a.dateAdministered.localeCompare(b.dateAdministered))
    .pop();
  if (!prior || prior.totalScore === undefined) return undefined;
  const delta = record.totalScore - prior.totalScore;
  const def = getDefinition(record.definitionKey);
  const lowerIsBetter = def?.lowerIsBetter ?? true;
  const direction =
    delta === 0 ? 'unchanged' : (delta < 0) === lowerIsBetter ? 'improved' : 'worsened';
  return {
    previousScore: prior.totalScore,
    delta,
    direction,
    clinicallyMeaningful:
      def?.meaningfulChange !== undefined ? Math.abs(delta) >= def.meaningfulChange : undefined,
  };
}
