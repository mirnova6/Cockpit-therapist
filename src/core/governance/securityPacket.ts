/**
 * Phase 7 Security Review Packet (§"Security Review Packet").
 *
 * Assembles a structured description of the app's security architecture for
 * independent legal/security review. It combines STATIC architecture facts
 * with a small amount of LIVE state expressed as counts/statuses only.
 *
 * It contains NO secrets: no API keys, no endpoints, no passphrases, no client
 * PHI, and no provider names — only architecture prose and aggregate counts.
 * A test asserts that seeded secret/PHI canaries never appear in the packet.
 */
import type { ClinicalDatabase } from '../db/database';
import { computePhiGateStatus, HIPAA_CONSCIOUS_DISCLAIMER } from './phase7Schema';

export interface SecurityPacketSection {
  key: string;
  title: string;
  points: string[];
}

export interface SecurityReviewPacket {
  format: 'cockpit-security-review-packet';
  version: 1;
  generatedAt: string;
  disclaimer: string;
  sections: SecurityPacketSection[];
  liveSummary: {
    checklist: { total: number; reviewed: number };
    providerApprovals: { total: number; approved: number; withSignedBaa: number };
    phiGate: { blocked: boolean; statusLine: string; completed: number; total: number };
    onlineEnabled: boolean;
    killSwitchActive: boolean;
  };
}

const STATIC_SECTIONS: SecurityPacketSection[] = [
  {
    key: 'architecture',
    title: 'App architecture summary',
    points: [
      'Single-clinician, local-first clinical documentation aid. React + TypeScript core with a platform-agnostic domain layer (no network dependency for core use).',
      'Runs in a browser today; native desktop (Tauri) and mobile (Capacitor) shells implement small storage/key-storage seams without changing the crypto or schema.',
      'No server component and no multi-user access; all state lives on the device.',
    ],
  },
  {
    key: 'encryption',
    title: 'Encryption model',
    points: [
      'All records and file blobs are encrypted at rest with AES-256-GCM (authenticated encryption).',
      'A random 256-bit data encryption key (DEK) encrypts all content.',
      'Tampered ciphertext fails GCM authentication and is rejected (verified in tests).',
    ],
  },
  {
    key: 'key-management',
    title: 'Key management model',
    points: [
      'The DEK is wrapped by a key derived from the passphrase (and optional PIN) via PBKDF2-SHA256 at 310k iterations.',
      'The DEK exists unwrapped only in memory while unlocked; locking/auto-lock discards it. No password is stored, hashed or otherwise.',
      'Optional device unlock stores a random wrapping key ONLY in the OS Keychain/Keystore — there is no recovery backdoor, and a wiped key store forces passphrase unlock.',
      'Model API keys are stored inside the encrypted records store, never in plaintext meta, and never appear in exports or logs.',
    ],
  },
  {
    key: 'local-storage',
    title: 'Local storage model',
    points: [
      'Browser build: encrypted records/blobs in IndexedDB. Native build: the same encrypted envelopes in a file-backed adapter (one file per record/blob/meta).',
      'A small non-PHI meta store holds bootstrap data only: key-derivation parameters, clinician display name, lockout counters, and settings — never client content or unwrapped keys.',
      'Tests assert no plaintext PHI, prompts, outputs, or API keys appear in the storage layer.',
    ],
  },
  {
    key: 'backup-restore',
    title: 'Backup/restore model',
    points: [
      'Backups export only encrypted envelopes — unreadable without the passphrase.',
      'Backup v2 adds a schema version, per-collection counts, and a SHA-256 integrity checksum over a canonical body.',
      'Restore inspects and validates before clearing any data and refuses partial restore, so corruption cannot leave a half-restored workspace; a dry-run validates without writing.',
    ],
  },
  {
    key: 'export',
    title: 'Export behavior',
    points: [
      'Only clinician-approved documents export for the record; drafts carry a NOT-APPROVED watermark.',
      'Unencrypted client JSON export sits behind an explicit warning and must be handled as PHI per the Export policy.',
      'Exports never contain internal instructions, key material, or prompt text. Every export is audited.',
    ],
  },
  {
    key: 'ai-modes',
    title: 'AI processing modes',
    points: [
      'Deterministic (always available, never simulates a model), Local AI (on-device OpenAI-compatible endpoint), and Secure Online AI (HTTPS provider) behind layered consent.',
      'AI providers have no database write authority; all AI output is a draft until clinician approval.',
      'The active mode is always visibly labeled; nothing claims a model is connected unless a real readiness check passes.',
    ],
  },
  {
    key: 'local-ai',
    title: 'Local AI behavior',
    points: [
      'Local AI runs against a clinician-configured on-device endpoint; a genuine connectivity/readiness check verifies the model is actually served.',
      'No PHI leaves the device in local mode.',
      'Model quality varies; weaker models raise unsupported-claim rates, which are measurable in the evaluation harness.',
    ],
  },
  {
    key: 'online-safeguards',
    title: 'Online AI safeguards',
    points: [
      'Online mode is disabled by default. Sending PHI requires ALL of: online enabled, PHI-approval attestation, per-input consent, an approved provider for the capability, an outbound preview, and explicit per-send confirmation.',
      'A per-client local-only override beats every other setting. An emergency kill switch refuses all online sends instantly.',
      'Best-effort redaction is offered and disclosed as imperfect; every send is previewed before it leaves.',
    ],
  },
  {
    key: 'provider-registry',
    title: 'Provider approval registry',
    points: [
      'Each online provider has a registry entry: approval status, BAA/contract status, approved and disallowed purposes, review-due and key-rotation dates, and a named reviewer.',
      'The gateway ENFORCES the registry: online PHI is refused unless status is approved, the entry is not past its review date, and the capability is allowed.',
      'Refusals are logged as refused operations.',
    ],
  },
  {
    key: 'audit',
    title: 'Audit log behavior',
    points: [
      'Security-relevant actions (unlocks, exports, backups, approvals, governance edits, AI operations) are logged.',
      'Logs record identifiers, actions, and metadata only — never clinical plaintext, prompt text, or key material.',
      'AI operation logs additionally record provider/model/mode, consent/attestation status, PHI-left-device flag, token estimates, and status.',
    ],
  },
  {
    key: 'risk-workflow',
    title: 'Risk workflow',
    points: [
      'Risk-flagged content requires individual clinician review and a disposition note; it is never bulk-approvable.',
      'The app never determines risk autonomously and never converts screening scores into diagnoses.',
      'Risk language in generated documents forces the risk-gating workflow before approval.',
    ],
  },
  {
    key: 'isolation',
    title: 'Client isolation model',
    points: [
      'Cross-client isolation is enforced in repositories, retrieval, the AI gateway, embeddings, and pre-save checks — not just the UI.',
      'A namespace check aborts retrieval if a foreign record ever appears.',
      'Embeddings are client-namespaced and deleted with the client.',
    ],
  },
  {
    key: 'prompt-injection',
    title: 'Prompt-injection protections',
    points: [
      'All client text is fenced as untrusted data in prompts; providers cannot write to the database.',
      'A separate deterministic verifier labels every generated sentence and flags unsupported/contradicted content.',
      'Governance state and the PHI readiness gate are computed only from stored flags, never from client content, so injected text cannot change them (verified in tests).',
    ],
  },
  {
    key: 'known-limitations',
    title: 'Known limitations',
    points: [
      'Single-clinician, single-device trust model; browser storage depends on device security and durability.',
      'A compromised or malware-infected device defeats application-level encryption while unlocked.',
      'Redaction is best-effort; retrieval ranking is lexical unless an embedding provider is configured; PDF text must be pasted to be searchable.',
      'No independent security audit or penetration test has yet been performed.',
    ],
  },
  {
    key: 'production-blockers',
    title: 'Remaining production blockers',
    points: [
      'Signed native builds with verified durable storage and OS key storage.',
      'Independent security review and legal/HIPAA review completed.',
      'Signed BAAs and completed vendor reviews for any online provider before online PHI use.',
      'Adopted practice policies (retention, deletion, backup, incident response, device security) and completed clinician training/disclosure.',
      'Every item on the Real PHI Readiness Gate marked complete through explicit manual review, ending with a named final approval.',
    ],
  },
];

export async function buildSecurityReviewPacket(db: ClinicalDatabase): Promise<SecurityReviewPacket> {
  const [checklist, approvals, gate, settings] = await Promise.all([
    db.governance.checklistSummary(),
    db.governance.listApprovals(),
    db.governance.listPhiGate(),
    db.ai.getSettings(),
  ]);
  const gateStatus = computePhiGateStatus(gate);

  await db.audit('security', 'security-packet.generated');

  return {
    format: 'cockpit-security-review-packet',
    version: 1,
    generatedAt: new Date().toISOString(),
    disclaimer: HIPAA_CONSCIOUS_DISCLAIMER,
    sections: STATIC_SECTIONS,
    liveSummary: {
      checklist: { total: checklist.total, reviewed: checklist.byStatus.reviewed },
      providerApprovals: {
        total: approvals.length,
        approved: approvals.filter((a) => a.approvalStatus === 'approved').length,
        withSignedBaa: approvals.filter((a) => a.baaStatus === 'signed').length,
      },
      phiGate: {
        blocked: gateStatus.blocked,
        statusLine: gateStatus.statusLine,
        completed: gateStatus.completed,
        total: gateStatus.total,
      },
      onlineEnabled: settings.onlineEnabled,
      killSwitchActive: settings.onlineKillSwitch,
    },
  };
}

export function renderSecurityPacketText(packet: SecurityReviewPacket): string {
  const lines: string[] = [
    'COCKPIT — SECURITY REVIEW PACKET',
    `Generated: ${packet.generatedAt}`,
    '',
    packet.disclaimer,
    '',
    '== LIVE SUMMARY (counts/status only — no secrets) ==',
    `Readiness checklist: ${packet.liveSummary.checklist.reviewed}/${packet.liveSummary.checklist.total} reviewed`,
    `Provider approvals: ${packet.liveSummary.providerApprovals.total} recorded · ${packet.liveSummary.providerApprovals.approved} approved · ${packet.liveSummary.providerApprovals.withSignedBaa} with signed BAA`,
    `Online AI enabled: ${packet.liveSummary.onlineEnabled} · Kill switch active: ${packet.liveSummary.killSwitchActive}`,
    `Real PHI readiness gate: ${packet.liveSummary.phiGate.statusLine} (${packet.liveSummary.phiGate.completed}/${packet.liveSummary.phiGate.total} complete)`,
    '',
  ];
  for (const section of packet.sections) {
    lines.push(`== ${section.title.toUpperCase()} ==`, ...section.points.map((p) => `• ${p}`), '');
  }
  return lines.join('\n').trimEnd();
}
