/**
 * Phase 8 beta test report — assembles the guided-checklist results, bug
 * reports, and feedback into an exportable summary. Contains no PHI: bug
 * reports and feedback are structured, PHI-free records by construction.
 */
import type { ClinicalDatabase } from '../db/database';
import { buildInfo } from '../release/buildInfo';
import { runtimeEnvironment } from '../platform/platform';
import { BETA_BANNER, type BetaCheckStatus } from './betaSchema';

export interface BetaTestReport {
  format: 'cockpit-beta-test-report';
  version: 1;
  generatedAt: string;
  banner: string;
  build: { version: string; commit: string; buildDate: string };
  runtime: string;
  checklist: {
    total: number;
    byStatus: Record<BetaCheckStatus, number>;
    failed: Array<{ label: string; notes?: string }>;
  };
  bugReports: Array<{ severity: string; issueType: string; screen: string; createdAt: string }>;
  feedback: Array<{ area: string; rating: number; comment: string }>;
}

export async function generateBetaReport(db: ClinicalDatabase): Promise<BetaTestReport> {
  const [checks, bugs, feedback] = await Promise.all([
    db.beta.listChecklist(),
    db.beta.listBugReports(),
    db.beta.listFeedback(),
  ]);
  const byStatus: Record<BetaCheckStatus, number> = { pending: 0, pass: 0, fail: 0, blocked: 0, skip: 0 };
  for (const c of checks) byStatus[c.status]++;
  const build = buildInfo();

  await db.audit('security', 'beta.report-generated', `${bugs.length} bug(s), ${feedback.length} feedback`);

  return {
    format: 'cockpit-beta-test-report',
    version: 1,
    generatedAt: new Date().toISOString(),
    banner: BETA_BANNER,
    build: { version: build.version, commit: build.commit, buildDate: build.buildDate },
    runtime: runtimeEnvironment().label,
    checklist: {
      total: checks.length,
      byStatus,
      failed: checks.filter((c) => c.status === 'fail' || c.status === 'blocked').map((c) => ({ label: c.label, notes: c.notes })),
    },
    bugReports: bugs.map((b) => ({ severity: b.severity, issueType: b.issueType, screen: b.screen, createdAt: b.createdAt })),
    feedback: feedback.map((f) => ({ area: f.area, rating: f.rating, comment: f.comment })),
  };
}

export function renderBetaReportText(r: BetaTestReport): string {
  const lines = [
    'COCKPIT — BETA TEST REPORT',
    `Generated: ${r.generatedAt}`,
    `Build: v${r.build.version} · commit ${r.build.commit} · ${r.build.buildDate}`,
    `Runtime: ${r.runtime}`,
    '',
    r.banner,
    '',
    '== GUIDED CHECKLIST ==',
    `Total: ${r.checklist.total} — ${Object.entries(r.checklist.byStatus).map(([k, v]) => `${k}: ${v}`).join(', ')}`,
  ];
  if (r.checklist.failed.length > 0) {
    lines.push('Failed/blocked:');
    for (const f of r.checklist.failed) lines.push(`• ${f.label}${f.notes ? ` — ${f.notes}` : ''}`);
  }
  lines.push('', '== BUG REPORTS (PHI-free) ==');
  if (r.bugReports.length === 0) lines.push('None recorded.');
  for (const b of r.bugReports) lines.push(`• [${b.severity}] ${b.issueType} on ${b.screen} (${b.createdAt.slice(0, 10)})`);
  lines.push('', '== FEEDBACK ==');
  if (r.feedback.length === 0) lines.push('None recorded.');
  for (const f of r.feedback) lines.push(`• ${f.area}: ${f.rating}/5 — ${f.comment}`);
  return lines.join('\n');
}
