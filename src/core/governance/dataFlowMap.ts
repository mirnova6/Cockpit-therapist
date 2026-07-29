/**
 * Phase 7 Data Flow Map (§"Data Flow Map").
 *
 * A schema-level description of how each kind of data moves through the app:
 * what is entered, where it is stored, whether it is encrypted, when it leaves
 * the device, what requires clinician/provider approval, what appears in
 * exports and audit logs, and what is never stored in plaintext.
 *
 * IMPORTANT: this map is STATIC. It is built entirely from these constants and
 * never reads any client record, so it can never contain client PHI. A test
 * asserts that a canary PHI value present in the workspace does not appear in
 * the rendered map.
 */

export interface DataFlowRow {
  dataType: string;
  entryPoint: string;
  storageLocation: string;
  encryptedAtRest: 'yes' | 'no' | 'n/a';
  leavesDevice: string;
  clinicianApproval: string;
  providerApproval: string;
  appearsInExports: string;
  appearsInAuditLogs: string;
  neverPlaintext: string;
}

export interface DataFlowMap {
  format: 'cockpit-data-flow-map';
  version: 1;
  generatedAt: string;
  disclaimer: string;
  rows: DataFlowRow[];
  legend: string[];
}

const ROWS: DataFlowRow[] = [
  {
    dataType: 'Client profile & clinical inputs (PHI)',
    entryPoint: 'Clinician typing / pasting into client screens',
    storageLocation: 'Encrypted records store (IndexedDB in browser; file-backed adapter on native)',
    encryptedAtRest: 'yes',
    leavesDevice: 'Never, unless the clinician exports or explicitly enables online AI for consented, approved sources',
    clinicianApproval: 'Clinician authors it directly; extracted facts require per-item approval',
    providerApproval: 'N/A for storage; online AI use requires an approved provider',
    appearsInExports: 'Only in clinician-initiated exports (approved documents, or unencrypted JSON behind a warning)',
    appearsInAuditLogs: 'No clinical text — audit records identifiers/actions only',
    neverPlaintext: 'Never written unencrypted to storage',
  },
  {
    dataType: 'File attachments (PHI)',
    entryPoint: 'Clinician file upload on a clinical input',
    storageLocation: 'Encrypted blob store',
    encryptedAtRest: 'yes',
    leavesDevice: 'Never automatically; included only in encrypted backups',
    clinicianApproval: 'Attached by clinician',
    providerApproval: 'N/A',
    appearsInExports: 'Not in document exports; only inside encrypted backups (ciphertext)',
    appearsInAuditLogs: 'No — only that an attachment action occurred',
    neverPlaintext: 'Blob bytes are always ciphertext at rest',
  },
  {
    dataType: 'Structured facts, assessments, hypotheses, evidence (PHI)',
    entryPoint: 'Extraction preview approvals; clinician entry',
    storageLocation: 'Encrypted records store, client-scoped collections',
    encryptedAtRest: 'yes',
    leavesDevice: 'Never automatically',
    clinicianApproval: 'Every fact/score/hypothesis requires clinician approval; risk items individually',
    providerApproval: 'N/A for storage',
    appearsInExports: 'Only via approved-document or JSON export',
    appearsInAuditLogs: 'No clinical text',
    neverPlaintext: 'Never unencrypted at rest',
  },
  {
    dataType: 'Generated documents (DAP, treatment plan, goals) (PHI)',
    entryPoint: 'Deterministic/AI generation from approved sources',
    storageLocation: 'Encrypted records store',
    encryptedAtRest: 'yes',
    leavesDevice: 'Only on clinician export; drafts watermarked',
    clinicianApproval: 'Draft until approved; risk segments require individual confirmation',
    providerApproval: 'If AI-generated online, requires an approved provider + consent',
    appearsInExports: 'Approved documents export; drafts carry a NOT-APPROVED watermark',
    appearsInAuditLogs: 'Export events audited without content',
    neverPlaintext: 'Never unencrypted at rest',
  },
  {
    dataType: 'AI prompts containing client text',
    entryPoint: 'Assembled at run time from authorized client record',
    storageLocation: 'In memory only — prompt text is not persisted',
    encryptedAtRest: 'n/a',
    leavesDevice: 'Local/deterministic: never. Online: only after enable + attestation + consent + approval + preview + confirm',
    clinicianApproval: 'Online send requires explicit per-run confirmation of the previewed outbound text',
    providerApproval: 'Online send requires an approved provider for the capability',
    appearsInExports: 'No — prompt text is never exported',
    appearsInAuditLogs: 'No prompt text — only provider/model/mode/consent/PHI-flag metadata',
    neverPlaintext: 'Prompt text is never written to storage at all',
  },
  {
    dataType: 'AI outputs (drafts)',
    entryPoint: 'Returned by deterministic/local/online provider',
    storageLocation: 'Held for review; persisted only when saved as a draft/proposal record (encrypted)',
    encryptedAtRest: 'yes',
    leavesDevice: 'No (output returns to the device)',
    clinicianApproval: 'Draft until clinician approves per item; verifier flags unsupported content',
    providerApproval: 'N/A on return',
    appearsInExports: 'Only if incorporated into an approved, exported document',
    appearsInAuditLogs: 'Operation metadata only, no output text',
    neverPlaintext: 'Persisted proposals are encrypted at rest',
  },
  {
    dataType: 'Model API keys / endpoints',
    entryPoint: 'Clinician enters in AI settings',
    storageLocation: 'Encrypted records store (never plaintext meta)',
    encryptedAtRest: 'yes',
    leavesDevice: 'Sent only to the configured provider endpoint over HTTPS when a send occurs',
    clinicianApproval: 'Configured by clinician',
    providerApproval: 'Provider must be approved for online PHI use',
    appearsInExports: 'Never — keys are excluded from all exports, backups export ciphertext only',
    appearsInAuditLogs: 'Never — no key material in audit or operation logs',
    neverPlaintext: 'Never stored or exported in plaintext',
  },
  {
    dataType: 'Embeddings (semantic vectors)',
    entryPoint: 'Generated from client text when an embedding provider is configured',
    storageLocation: 'Encrypted records store, client-namespaced',
    encryptedAtRest: 'yes',
    leavesDevice: 'Only if an online embedding provider is used (same online gates apply)',
    clinicianApproval: 'Feature is off by default; clinician enables it',
    providerApproval: 'Online embedding obeys the same provider-approval gates',
    appearsInExports: 'Excluded from client exports by default; regenerable',
    appearsInAuditLogs: 'Generation/deletion counts only',
    neverPlaintext: 'Vectors and source text are encrypted at rest',
  },
  {
    dataType: 'Audit & AI operation logs',
    entryPoint: 'Written automatically by the app',
    storageLocation: 'Encrypted records store',
    encryptedAtRest: 'yes',
    leavesDevice: 'Only inside encrypted backups; viewable in-app',
    clinicianApproval: 'N/A (system-generated)',
    providerApproval: 'N/A',
    appearsInExports: 'Not exported as clinical content; may be included in a readiness/security packet as counts/metadata only',
    appearsInAuditLogs: 'This IS the audit log — identifiers and actions, never clinical plaintext',
    neverPlaintext: 'Encrypted at rest; contains no clinical plaintext by design',
  },
  {
    dataType: 'Governance data (approvals, checklist, threat model, policies, PHI gate)',
    entryPoint: 'Clinician/reviewer edits in governance screens',
    storageLocation: 'Encrypted records store',
    encryptedAtRest: 'yes',
    leavesDevice: 'Only when the clinician exports a readiness/security packet (no client PHI, no secrets)',
    clinicianApproval: 'Edited by clinician/reviewer',
    providerApproval: 'N/A',
    appearsInExports: 'Security/readiness packet exports (metadata and policy text only)',
    appearsInAuditLogs: 'Governance changes audited (labels/status), no client PHI',
    neverPlaintext: 'Encrypted at rest; exports contain no client PHI or secrets',
  },
  {
    dataType: 'Bootstrap meta (key params, display name, lockout counters, settings)',
    entryPoint: 'Set during setup / normal use',
    storageLocation: 'Meta store (non-PHI, plaintext by necessity for bootstrap)',
    encryptedAtRest: 'no',
    leavesDevice: 'No',
    clinicianApproval: 'N/A',
    providerApproval: 'N/A',
    appearsInExports: 'Key-derivation parameters travel inside backups so restore can unwrap; no PHI',
    appearsInAuditLogs: 'N/A',
    neverPlaintext: 'Contains NO PHI and NO secret key material — only non-sensitive bootstrap parameters',
  },
];

export function buildDataFlowMap(): DataFlowMap {
  return {
    format: 'cockpit-data-flow-map',
    version: 1,
    generatedAt: new Date().toISOString(),
    disclaimer:
      'Schema-level data-flow description for legal/security review. Built entirely from documented app behavior — it contains no client PHI and no secrets. It is HIPAA-conscious preparation material and makes no compliance claim.',
    rows: ROWS,
    legend: [
      'Encrypted at rest = AES-256-GCM in the records/blob store.',
      '"Leaves device" for online AI means only after ALL gates pass: online enabled, PHI attestation, per-input consent, approved provider, outbound preview, and explicit confirmation.',
      'Audit and operation logs never contain clinical plaintext or key material.',
      'Meta store holds only non-PHI bootstrap data; it never holds client content or unwrapped keys.',
    ],
  };
}

export function renderDataFlowMapText(map: DataFlowMap): string {
  const lines: string[] = [
    'COCKPIT — DATA FLOW MAP',
    `Generated: ${map.generatedAt}`,
    '',
    map.disclaimer,
    '',
  ];
  for (const row of map.rows) {
    lines.push(
      `== ${row.dataType} ==`,
      `Entered via: ${row.entryPoint}`,
      `Stored: ${row.storageLocation}`,
      `Encrypted at rest: ${row.encryptedAtRest}`,
      `Leaves device: ${row.leavesDevice}`,
      `Requires clinician approval: ${row.clinicianApproval}`,
      `Requires provider approval: ${row.providerApproval}`,
      `In exports: ${row.appearsInExports}`,
      `In audit logs: ${row.appearsInAuditLogs}`,
      `Never plaintext: ${row.neverPlaintext}`,
      '',
    );
  }
  lines.push('== LEGEND ==', ...map.legend.map((l) => `• ${l}`));
  return lines.join('\n');
}
