/**
 * Production readiness report generator (§19) — assembles LIVE workspace
 * state (settings, approvals, checklist, evaluation runs, operations,
 * feedback) plus documented capabilities into an exportable report.
 *
 * The report is a preparation artifact: it never claims compliance and
 * always carries the legal/security-review wording.
 */
import type { ClinicalDatabase } from '../db/database';
import { READINESS_DISCLAIMER } from './governanceSchema';

export interface ReadinessReport {
  format: 'cockpit-readiness-report';
  version: 1;
  generatedAt: string;
  disclaimer: string;
  capabilities: string[];
  localSecurityPosture: string[];
  onlineSafeguards: string[];
  liveState: {
    checklist: { total: number; byStatus: Record<string, number> };
    providerApprovals: Array<{ provider: string; status: string; baa: string; purposes: number; reviewDue?: string }>;
    onlineEnabled: boolean;
    killSwitchActive: boolean;
    embeddingProvider: string;
    embeddingsStored: number;
    aiOperations: { total: number; refused: number; cancelled: number; failed: number; onlineSends: number };
    evaluationRuns: { total: number; averageScore?: number; trapFailures: number; riskFailures: number };
    feedbackEntries: number;
    knowledgeSources: { total: number; approved: number };
  };
  automatedTests: string;
  knownLimitations: string[];
  remainingRisks: string[];
  requiredBeforeRealClients: string[];
  requiredBeforeOnlinePhi: string[];
  requiredBeforeMultiUser: string[];
  nativePackagingNeeds: string[];
  legalSecurityReviewNeeds: string[];
}

export async function generateReadinessReport(db: ClinicalDatabase): Promise<ReadinessReport> {
  const [settings, approvals, checklist, runs, ops, feedback, knowledge] = await Promise.all([
    db.ai.getSettings(),
    db.governance.listApprovals(),
    db.governance.checklistSummary(),
    db.evaluation.listRuns(),
    db.ai.listOperations(undefined, 10_000),
    db.ai.listAllFeedback(),
    db.knowledge.listSources(),
  ]);
  const embeddingsStored = await db.governance.countEmbeddings();

  const completedRuns = runs.filter((r) => r.status === 'completed');
  const averageScore =
    completedRuns.length > 0
      ? Math.round(completedRuns.reduce((sum, r) => sum + r.score, 0) / completedRuns.length)
      : undefined;

  await db.audit('security', 'readiness.report-generated');

  return {
    format: 'cockpit-readiness-report',
    version: 1,
    generatedAt: new Date().toISOString(),
    disclaimer: `${READINESS_DISCLAIMER} This report is generated for preparation purposes and requires legal/security review before any production use.`,
    capabilities: [
      'Encrypted single-clinician clinical workspace: clients, inputs, structured facts, assessments (official scoring rules only), hypotheses, evidence links, contradictions, review queue, version history',
      'Document generation (DAP notes, Master Treatment Plans, goals) with per-sentence evidence, risk gating, approval workflow, and approved-only export',
      'Clinical intelligence: client-record RAG with debug panel, clinician-managed knowledge base, 20-step Analyze-and-Update pipeline, living case formulations, intervention recommendations, safety & trust strategy, per-client assistant — all clinician-reviewed, nothing autonomous',
      'AI providers: deterministic (always available), local OpenAI-compatible endpoint, secure online (Anthropic API) behind layered consent',
      'Phase 5: fictional-case evaluation harness with quality/risk metrics, model comparison, feedback dashboard, audit & operations viewers, provider approval registry, semantic-retrieval preparation, readiness checklist',
    ],
    localSecurityPosture: [
      'AES-256-GCM per record/blob; PBKDF2-SHA256 (310k iterations) key wrapping; data key in memory only, discarded on lock',
      'Auto-lock on inactivity; lockout backoff on failed unlocks; locking cancels in-flight AI operations and clears AI state',
      'Cross-client isolation enforced in repositories, retrieval, gateway, embeddings, and pre-save checks',
      'Backups are encrypted envelopes only; client deletion cascades across every collection including embeddings',
      'No plaintext PHI, prompts, outputs, or API keys in IndexedDB (verified by automated tests)',
    ],
    onlineSafeguards: [
      'Online processing disabled by default; separate PHI-approval attestation required before any protected content can be sent',
      'Per-input consent + local-only flags, per-client local-only override, provider approval registry with per-purpose allow/deny and expiration, emergency disable switch',
      'Mandatory outbound preview (with optional best-effort redaction, shown before sending) and per-run confirmation',
      'Every operation logged (provider, model, mode, consent status, PHI flag, token estimates) without prompt text',
    ],
    liveState: {
      checklist,
      providerApprovals: approvals.map((a) => ({
        provider: `${a.providerName} (${a.providerId})`,
        status: a.approvalStatus,
        baa: a.baaStatus,
        purposes: a.approvedPurposes.length,
        reviewDue: a.reviewDueDate,
      })),
      onlineEnabled: settings.onlineEnabled,
      killSwitchActive: settings.onlineKillSwitch,
      embeddingProvider:
        settings.embeddingProviderType === 'none'
          ? 'None configured — semantic retrieval NOT active (lexical ranking in use)'
          : settings.embeddingProviderType,
      embeddingsStored,
      aiOperations: {
        total: ops.length,
        refused: ops.filter((o) => o.status === 'refused').length,
        cancelled: ops.filter((o) => o.status === 'cancelled').length,
        failed: ops.filter((o) => o.status === 'failed').length,
        onlineSends: ops.filter((o) => o.phiLeftDevice && o.status === 'completed').length,
      },
      evaluationRuns: {
        total: runs.length,
        averageScore,
        trapFailures: runs.reduce((sum, r) => sum + r.trapResults.filter((t) => !t.passed).length, 0),
        riskFailures: runs.reduce((sum, r) => sum + r.errors.filter((e) => e.highPriority).length, 0),
      },
      feedbackEntries: feedback.length,
      knowledgeSources: { total: knowledge.length, approved: knowledge.filter((k) => k.status === 'approved').length },
    },
    automatedTests:
      'Unit suite covers crypto, auth, repositories, scoring rules, extraction guards, documents, gateway consent/isolation/cancellation, RAG, knowledge base, verification, pipeline (incl. injection inertness), formulation, interventions, assistant, evaluation harness, governance controls, and backups. Browser E2E drives setup → clinical flows → AI governance → evaluation → relaunch persistence → encrypted-at-rest checks. Run `npm test` and `node e2e/smoke.mjs` for current counts and results.',
    knownLimitations: [
      'Retrieval ranking is lexical; semantic ranking exists only as a preview search and requires a configured embedding provider',
      'Redaction is best-effort pattern matching and is disclosed as imperfect',
      'PDF text extraction is not available; knowledge PDFs need pasted text to be searchable',
      'Evaluation metrics are internal quality checks against fictional targets — not clinically validated',
      'Single-clinician, single-device trust model; browser storage depends on device security',
    ],
    remainingRisks: [
      'Device compromise (malware, screen capture, coerced unlock) defeats application-level encryption',
      'Browser storage can be evicted under disk pressure — backups are the clinician’s responsibility',
      'Local AI model quality varies; weak models raise unsupported-claim rates (measurable in the evaluation harness)',
      'No independent security audit or penetration test has been performed',
    ],
    requiredBeforeRealClients: [
      'Complete the readiness checklist through “Reviewed” for Encryption, Authentication, Locking, Backup, Secure deletion, Export, Audit, Risk workflow, and Cross-client isolation categories',
      'Establish a backup schedule and a tested restore procedure',
      'Document practice policies: retention, incident response, device security',
      'Independent security review of the encryption and storage implementation',
    ],
    requiredBeforeOnlinePhi: [
      'Signed BAA/contract with each online provider, recorded in the approval registry with approved purposes',
      'Legal confirmation that the provider arrangement covers the intended uses',
      'Enable online mode + PHI attestation only after the registry entry is approved',
      'Test the emergency disable switch and the refusal paths with fictional data first (evaluation harness)',
    ],
    requiredBeforeMultiUser: [
      'Per-user authentication, roles, and per-user audit attribution (not yet built)',
      'Server-side or synchronized storage with its own security review (not yet built)',
      'Organizational admin controls and centralized provider governance (registry exists; central management does not)',
    ],
    nativePackagingNeeds: [
      'Capacitor (iOS/Android) / Tauri or Electron (desktop) wrappers around the existing platform-agnostic core',
      'OS keychain/keystore-backed key storage replacing passphrase-only unlock where available',
      'SQLite StorageAdapter implementation for native filesystems',
    ],
    legalSecurityReviewNeeds: [
      'HIPAA administrative/physical/technical safeguard mapping against practice policies',
      'Jurisdiction-specific consent and documentation requirements',
      'Review of all disclosure and attestation wording in the app',
    ],
  };
}

/** Plain-text rendering for export/print. */
export function renderReadinessReportText(report: ReadinessReport): string {
  const lines: string[] = [
    'COCKPIT — PRODUCTION READINESS REPORT',
    `Generated: ${report.generatedAt}`,
    '',
    report.disclaimer,
    '',
    '== CURRENT CAPABILITIES ==',
    ...report.capabilities.map((c) => `• ${c}`),
    '',
    '== LOCAL-ONLY SECURITY POSTURE ==',
    ...report.localSecurityPosture.map((c) => `• ${c}`),
    '',
    '== ONLINE-MODE SAFEGUARDS ==',
    ...report.onlineSafeguards.map((c) => `• ${c}`),
    '',
    '== LIVE WORKSPACE STATE ==',
    `Checklist: ${report.liveState.checklist.total} items — ${Object.entries(report.liveState.checklist.byStatus)
      .map(([k, v]) => `${k}: ${v}`)
      .join(', ')}`,
    `Online enabled: ${report.liveState.onlineEnabled} · Kill switch: ${report.liveState.killSwitchActive}`,
    `Embedding provider: ${report.liveState.embeddingProvider} (${report.liveState.embeddingsStored} vector(s) stored)`,
    `AI operations: ${report.liveState.aiOperations.total} total · ${report.liveState.aiOperations.refused} refused · ${report.liveState.aiOperations.cancelled} cancelled · ${report.liveState.aiOperations.failed} failed · ${report.liveState.aiOperations.onlineSends} online send(s)`,
    `Evaluation runs: ${report.liveState.evaluationRuns.total}${report.liveState.evaluationRuns.averageScore !== undefined ? ` · average internal score ${report.liveState.evaluationRuns.averageScore}/100` : ''} · ${report.liveState.evaluationRuns.trapFailures} trap failure(s)`,
    `Provider approvals: ${report.liveState.providerApprovals.length === 0 ? 'none recorded' : report.liveState.providerApprovals.map((a) => `${a.provider} → ${a.status} (BAA: ${a.baa})`).join('; ')}`,
    `Clinician feedback entries: ${report.liveState.feedbackEntries}`,
    `Knowledge sources: ${report.liveState.knowledgeSources.approved}/${report.liveState.knowledgeSources.total} approved`,
    '',
    '== AUTOMATED TESTS ==',
    report.automatedTests,
    '',
    '== KNOWN LIMITATIONS ==',
    ...report.knownLimitations.map((c) => `• ${c}`),
    '',
    '== REMAINING RISKS ==',
    ...report.remainingRisks.map((c) => `• ${c}`),
    '',
    '== REQUIRED BEFORE REAL CLIENT DATA ==',
    ...report.requiredBeforeRealClients.map((c) => `• ${c}`),
    '',
    '== REQUIRED BEFORE ONLINE PHI PROCESSING ==',
    ...report.requiredBeforeOnlinePhi.map((c) => `• ${c}`),
    '',
    '== REQUIRED BEFORE MULTI-USER / ORGANIZATIONAL DEPLOYMENT ==',
    ...report.requiredBeforeMultiUser.map((c) => `• ${c}`),
    '',
    '== NATIVE PACKAGING NEEDS ==',
    ...report.nativePackagingNeeds.map((c) => `• ${c}`),
    '',
    '== LEGAL / SECURITY REVIEW NEEDS ==',
    ...report.legalSecurityReviewNeeds.map((c) => `• ${c}`),
  ];
  return lines.join('\n');
}
