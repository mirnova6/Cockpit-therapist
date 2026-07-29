/**
 * Phase 9 structured beta-feedback triage (§2).
 *
 * Extends the Phase 8 beta feedback into a product-improvement workflow with
 * categories, severities, statuses, priorities and resolution tracking.
 *
 * PHI RULE (unchanged and enforced): feedback items capture structured fields
 * only and require the existing no-PHI confirmation. There is deliberately no
 * field capable of holding a client record, transcript, prompt, output or key.
 */

export const FEEDBACK_CATEGORIES = [
  'Bug',
  'Workflow friction',
  'Documentation quality',
  'Clinical-output quality',
  'Retrieval issue',
  'Incorrect evidence',
  'Missing feature',
  'Navigation issue',
  'Performance issue',
  'Accessibility issue',
  'Security concern',
  'Risk-workflow concern',
  'Native-platform issue',
  'Local-AI issue',
  'Online-AI issue',
] as const;
export type FeedbackCategory = (typeof FEEDBACK_CATEGORIES)[number];

export const FEEDBACK_STATUSES = [
  'New',
  'Confirmed',
  'Needs More Information',
  'Planned',
  'In Progress',
  'Fixed',
  'Cannot Reproduce',
  'Not Planned',
  'Closed',
] as const;
export type FeedbackStatus = (typeof FEEDBACK_STATUSES)[number];

export const FEEDBACK_SEVERITIES = ['blocker', 'major', 'minor', 'trivial'] as const;
export type FeedbackSeverity = (typeof FEEDBACK_SEVERITIES)[number];

export const FEEDBACK_PRIORITIES = ['P0', 'P1', 'P2', 'P3'] as const;
export type FeedbackPriority = (typeof FEEDBACK_PRIORITIES)[number];

export const REPRODUCIBILITY = ['always', 'often', 'sometimes', 'once', 'unable'] as const;
export type Reproducibility = (typeof REPRODUCIBILITY)[number];

/** Statuses that mean the item is no longer open. */
export const CLOSED_STATUSES: FeedbackStatus[] = ['Fixed', 'Cannot Reproduce', 'Not Planned', 'Closed'];

export interface TriageItem {
  id: string;
  /** Short human-facing identifier, e.g. FB-0007. */
  reference: string;
  appVersion: string;
  platform: string;
  runtime: string;
  featureArea: string;
  category: FeedbackCategory;
  severity: FeedbackSeverity;
  reproducibility: Reproducibility;
  description: string;
  expectedBehavior: string;
  actualBehavior: string;
  /** Only when the item concerns AI behavior. */
  providerId?: string;
  modelId?: string;
  /** Fictional evaluation case id, when one reproduces the issue. */
  fictionalCaseId?: string;
  status: FeedbackStatus;
  priority: FeedbackPriority;
  resolutionNotes?: string;
  linkedCommit?: string;
  linkedRelease?: string;
  /** Required: the reporter confirmed the item contains no PHI. */
  noPhiConfirmed: boolean;
  createdAt: string;
  resolvedAt?: string;
}

export type TriageDraft = Omit<TriageItem, 'id' | 'reference' | 'createdAt' | 'resolvedAt'>;

export interface TriageDashboard {
  total: number;
  open: number;
  /** Most frequent categories, descending. */
  mostCommon: Array<{ category: FeedbackCategory; count: number }>;
  /** Open blockers and majors, most severe first. */
  highestSeverity: TriageItem[];
  openByFeature: Array<{ featureArea: string; count: number }>;
  byPlatform: Array<{ platform: string; count: number }>;
  byProvider: Array<{ providerId: string; count: number }>;
  recentlyResolved: TriageItem[];
  /**
   * Regression candidates: items that were Fixed but later reopened, or that
   * reproduce against a fictional evaluation case (so they can be added to the
   * regression suite).
   */
  regressionCandidates: TriageItem[];
}

const SEVERITY_ORDER: Record<FeedbackSeverity, number> = { blocker: 0, major: 1, minor: 2, trivial: 3 };

function tally<T extends string>(values: T[]): Array<{ key: T; count: number }> {
  const map = new Map<T, number>();
  for (const v of values) map.set(v, (map.get(v) ?? 0) + 1);
  return [...map.entries()]
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count || String(a.key).localeCompare(String(b.key)));
}

export function isOpen(item: TriageItem): boolean {
  return !CLOSED_STATUSES.includes(item.status);
}

export function buildDashboard(items: TriageItem[]): TriageDashboard {
  const open = items.filter(isOpen);
  return {
    total: items.length,
    open: open.length,
    mostCommon: tally(items.map((i) => i.category)).map(({ key, count }) => ({ category: key, count })),
    highestSeverity: open
      .filter((i) => i.severity === 'blocker' || i.severity === 'major')
      .sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]),
    openByFeature: tally(open.map((i) => i.featureArea)).map(({ key, count }) => ({ featureArea: key, count })),
    byPlatform: tally(items.map((i) => i.platform)).map(({ key, count }) => ({ platform: key, count })),
    byProvider: tally(items.filter((i) => i.providerId).map((i) => i.providerId as string)).map(
      ({ key, count }) => ({ providerId: key, count }),
    ),
    recentlyResolved: items
      .filter((i) => i.resolvedAt)
      .sort((a, b) => (b.resolvedAt ?? '').localeCompare(a.resolvedAt ?? ''))
      .slice(0, 10),
    regressionCandidates: items.filter(
      (i) => Boolean(i.fictionalCaseId) || (i.resolvedAt !== undefined && isOpen(i)),
    ),
  };
}

/** Fields a triage item may never contain; asserted by tests. */
export const FORBIDDEN_TRIAGE_FIELDS = ['clientId', 'clientName', 'transcript', 'prompt', 'output', 'apiKey'];
