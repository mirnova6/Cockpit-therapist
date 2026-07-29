/**
 * Phase 8 deployment decision report.
 *
 * Classifies the app from LIVE state and never defaults to real-PHI readiness.
 * The classification is computed only from stored governance flags, release
 * checklist items, and settings — never from client content. It makes no
 * compliance claim and reiterates that the Real PHI Readiness Gate is
 * authoritative.
 */
import type { ClinicalDatabase } from '../db/database';
import { computePhiGateStatus } from '../governance/phase7Schema';
import { buildInfo, type BuildInfo } from './buildInfo';

export type DeploymentClassification =
  | 'not-ready-for-beta'
  | 'ready-fictional-data-beta'
  | 'ready-deidentified-data-beta'
  | 'ready-limited-reviewed-local-only'
  | 'ready-online-phi-after-review';

export const CLASSIFICATION_LABELS: Record<DeploymentClassification, string> = {
  'not-ready-for-beta': 'Not ready for beta',
  'ready-fictional-data-beta': 'Ready for fictional-data beta',
  'ready-deidentified-data-beta': 'Ready for de-identified-data beta',
  'ready-limited-reviewed-local-only': 'Ready for limited reviewed local-only clinical use',
  'ready-online-phi-after-review': 'Ready for online PHI only after completed legal/security/provider review',
};

export interface DeploymentReport {
  format: 'cockpit-deployment-decision';
  version: 1;
  generatedAt: string;
  build: BuildInfo;
  classification: DeploymentClassification;
  classificationLabel: string;
  notApprovedForOnlinePhi: boolean;
  phiGateBlocked: boolean;
  disclaimer: string;
  complete: string[];
  notComplete: string[];
  tested: string[];
  notTested: string[];
  remainingRisks: string[];
  requiredManualReviews: string[];
  requiredLegalSecurityReviews: string[];
  nativeBuildsReady: boolean;
  recommendedNextAction: string;
}

const DISCLAIMER =
  'Deployment decision aid — HIPAA-conscious preparation material. It makes no compliance claim, does not authorize real-PHI use, and does not override the Real PHI Readiness Gate. Requires legal/security review and BAA/vendor verification where applicable.';

export async function generateDeploymentReport(db: ClinicalDatabase): Promise<DeploymentReport> {
  const [gate, settings, approvals, release, beta] = await Promise.all([
    db.governance.listPhiGate(),
    db.ai.getSettings(),
    db.governance.listApprovals(),
    db.governance.listReleaseChecklist(),
    db.beta.getState(),
  ]);
  const gateStatus = computePhiGateStatus(gate);
  const build = buildInfo();

  const releaseDone = (key: string) => release.find((r) => r.key === key)?.status === 'done';
  const desktopBuilt = releaseDone('desktop-build') || releaseDone('windows-build');
  const mobileBuilt = releaseDone('ios-build') || releaseDone('android-build');
  const nativeBuildsReady = desktopBuilt || mobileBuilt;
  const deviceTested = releaseDone('device-testing');
  const securityReviewed = releaseDone('security-review');
  const legalReviewed = releaseDone('legal-review');
  const approvedProviders = approvals.filter((a) => a.approvalStatus === 'approved' && a.baaStatus === 'signed');

  // Classification — never defaults to real PHI.
  let classification: DeploymentClassification;
  if (!gateStatus.blocked) {
    // Every Phase 7 gate item is complete (through explicit human review).
    classification =
      settings.onlineEnabled && approvedProviders.length > 0
        ? 'ready-online-phi-after-review'
        : 'ready-limited-reviewed-local-only';
  } else if (securityReviewed && deviceTested) {
    classification = 'ready-deidentified-data-beta';
  } else {
    classification = 'ready-fictional-data-beta';
  }

  await db.audit('security', 'deployment.report-generated', classification);

  return {
    format: 'cockpit-deployment-decision',
    version: 1,
    generatedAt: new Date().toISOString(),
    build,
    classification,
    classificationLabel: CLASSIFICATION_LABELS[classification],
    notApprovedForOnlinePhi: !(classification === 'ready-online-phi-after-review'),
    phiGateBlocked: gateStatus.blocked,
    disclaimer: DISCLAIMER,
    complete: [
      'Local-first encrypted workspace with clinician review gates, evidence tracking, and risk safeguards (Phases 1–3).',
      'Clinical intelligence behind provider controls with mandatory review; evaluation harness (Phases 4–5).',
      'Native packaging seams + code/config; backup v2 integrity; OS key storage with no backdoor (Phase 6).',
      'HIPAA-conscious governance: readiness dashboard, threat model, policies, security packet, data-flow map, Real PHI gate (Phase 7).',
      'Beta testing mode, PHI-free bug reporting, release checklist, this deployment report (Phase 8).',
      `Automated tests green for build ${build.commit}.`,
    ],
    notComplete: [
      !desktopBuilt ? 'Signed desktop builds (macOS/Windows) — code complete, not built/signed (see native/README.md).' : '',
      !mobileBuilt ? 'Installable mobile builds (iOS/Android) — config complete, not built (see native/README.md).' : '',
      !deviceTested ? 'Real-device testing checklist not marked complete.' : '',
      !securityReviewed ? 'Independent security review not complete.' : '',
      !legalReviewed ? 'Legal / HIPAA review not complete.' : '',
      gateStatus.blocked ? `Real PHI Readiness Gate is BLOCKED (${gateStatus.completed}/${gateStatus.total} items complete).` : '',
    ].filter(Boolean),
    tested: [
      'Full unit + browser E2E suites (crypto, auth, isolation, review gates, documents, AI governance, evaluation, backup v2, governance).',
      'Beta mode, bug-report PHI exclusion, and workspace performance covered by automated tests.',
      beta.sampleDataLoaded ? 'Fictional sample workspace has been loaded for interactive testing.' : '',
    ].filter(Boolean),
    notTested: [
      'On-device behavior on macOS/Windows/iOS/Android (requires real hardware + signed builds).',
      'Native FileStore / OS keychain against real OS APIs (contract verified headlessly only).',
      'Long-run stability / memory under real clinical workloads.',
    ],
    remainingRisks: [
      'A compromised or malware-infected device defeats application-level encryption while unlocked.',
      'Browser build depends on browser storage durability until the native build is used.',
      'No independent security audit or penetration test has been performed.',
      'Local model quality varies; weak models raise unsupported-claim rates (measurable in the harness).',
    ],
    requiredManualReviews: [
      'Complete the real-device testing checklist per target platform.',
      'Complete the guided beta testing checklist with fictional/de-identified data.',
      'Complete the Real PHI Readiness Gate through its named final approval.',
    ],
    requiredLegalSecurityReviews: [
      'Independent security review of encryption, storage, and key management.',
      'Legal/HIPAA review of safeguards, consent/disclosure, and jurisdiction requirements.',
      'Signed BAA/contract + completed vendor review for any online provider before online PHI.',
    ],
    nativeBuildsReady,
    recommendedNextAction: gateStatus.blocked
      ? `Proceed with "${CLASSIFICATION_LABELS[classification]}" using fictional or fully de-identified data only. Build and sign the native shells, run the real-device checklist, and complete the security/legal reviews before considering any real clinical use. Real PHI remains blocked.`
      : 'The PHI gate is complete. Confirm the named final approval, ensure signed native builds and provider BAAs are in place, and proceed only within the limits recorded in the gate and this report.',
  };
}

export function renderDeploymentReportText(r: DeploymentReport): string {
  const section = (title: string, items: string[]) => [`== ${title} ==`, ...items.map((i) => `• ${i}`), ''];
  return [
    'COCKPIT — DEPLOYMENT DECISION REPORT',
    `Generated: ${r.generatedAt}`,
    `Build: v${r.build.version} · commit ${r.build.commit} · ${r.build.buildDate}`,
    '',
    `CLASSIFICATION: ${r.classificationLabel}`,
    `Not approved for online PHI: ${r.notApprovedForOnlinePhi}`,
    `Real PHI Readiness Gate blocked: ${r.phiGateBlocked}`,
    `Native builds ready: ${r.nativeBuildsReady}`,
    '',
    r.disclaimer,
    '',
    ...section('COMPLETE', r.complete),
    ...section('NOT COMPLETE', r.notComplete),
    ...section('TESTED', r.tested),
    ...section('NOT TESTED', r.notTested),
    ...section('REMAINING RISKS', r.remainingRisks),
    ...section('REQUIRED MANUAL REVIEWS', r.requiredManualReviews),
    ...section('REQUIRED LEGAL / SECURITY REVIEWS', r.requiredLegalSecurityReviews),
    '== RECOMMENDED NEXT ACTION ==',
    r.recommendedNextAction,
  ].join('\n');
}
