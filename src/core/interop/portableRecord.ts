/**
 * Portable client record (Phase 9, §21) — a documented, versioned interchange
 * format for moving one client's record between Cockpit workspaces, and for
 * handing a readable copy to a clinician who is not running Cockpit.
 *
 * Design constraints that are not negotiable:
 *
 *  - **Export is plaintext by definition.** Encryption protects data at rest
 *    inside the workspace; an export leaves that boundary. The format says so
 *    on its face, and the caller is required to acknowledge it.
 *  - **No secrets, ever.** Passphrases, wrapped keys, IVs, provider API keys,
 *    prompts and system instructions are not part of the format and are
 *    actively stripped.
 *  - **Approval does not travel.** A fact approved by clinician A in workspace
 *    A is not approved in workspace B; clinician B has not seen it. Everything
 *    imported lands in a needs-review state (see `importPreview.ts`).
 *  - **Attachment bytes are not exported**, only their metadata. Blobs are the
 *    largest and least reviewable surface; exporting them would move
 *    unreviewed binary content across a trust boundary.
 */
import type { ClinicalInput, Client } from '../db/schema';
import type {
  AssessmentRecord,
  ClinicalHypothesis,
  ExtractedFact,
} from '../db/structuredSchema';

export const PORTABLE_FORMAT = 'cockpit-portable-client';
export const PORTABLE_VERSION = 2;

/** Fields that must never appear anywhere in an export. */
export const FORBIDDEN_EXPORT_KEYS: ReadonlyArray<string> = [
  'apiKey',
  'apiKeys',
  'passphrase',
  'pin',
  'wrapped',
  'dek',
  'kek',
  'iv',
  'salt',
  'keyring',
  'systemPrompt',
  'prompt',
  'promptTemplate',
];

export interface PortableProvenance {
  /** Which app produced the file. Never a version string that leaks a build id. */
  producedBy: string;
  exportedAt: string;
  /** Free-text label chosen by the exporting clinician, e.g. "transfer of care". */
  purpose?: string;
  /** Present so an importer can tell exports of the same client apart. */
  sourceClientId: string;
}

export interface PortableClientRecord {
  format: typeof PORTABLE_FORMAT;
  version: number;
  provenance: PortableProvenance;
  /** Stated on the file itself, because the file is not encrypted. */
  handlingNotice: string;
  /** What the importing side must do before this content is clinically usable. */
  importNotice: string;
  client: Client;
  clinicalInputs: Array<Omit<ClinicalInput, 'attachments'> & {
    attachments: Array<{ name: string; mimeType: string; size: number }>;
    /** True when the source record had attachment bytes that were not exported. */
    attachmentsOmitted: boolean;
  }>;
  facts: ExtractedFact[];
  assessments: AssessmentRecord[];
  hypotheses: ClinicalHypothesis[];
  counts: {
    clinicalInputs: number;
    facts: number;
    assessments: number;
    hypotheses: number;
    riskFlaggedInputs: number;
    localOnlyExcluded: number;
  };
}

export const HANDLING_NOTICE =
  'This file is NOT encrypted. It contains clinical information in plain text. ' +
  'Handle it according to your confidentiality and records obligations, and delete it when it is no longer needed.';

export const IMPORT_NOTICE =
  'Review status does not transfer between workspaces. Every record in this file must be ' +
  'reviewed by the receiving clinician before it is relied on. Risk-flagged records must be ' +
  'reviewed individually.';

export interface BuildExportOptions {
  /**
   * Records marked local-only are excluded unless the clinician explicitly
   * overrides. Defaults to excluding them.
   */
  includeLocalOnly?: boolean;
  purpose?: string;
  producedBy?: string;
}

export class ExportRefusedError extends Error {
  constructor(
    message: string,
    readonly code: 'unacknowledged' | 'forbidden-content',
  ) {
    super(message);
    this.name = 'ExportRefusedError';
  }
}

/** Recursively strips keys that must never leave the workspace. */
export function stripForbidden<T>(value: T): T {
  if (Array.isArray(value)) return value.map((v) => stripForbidden(v)) as unknown as T;
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      if (FORBIDDEN_EXPORT_KEYS.includes(key)) continue;
      out[key] = stripForbidden(v);
    }
    return out as T;
  }
  return value;
}

export interface ExportSource {
  client: Client;
  inputs: ClinicalInput[];
  facts: ExtractedFact[];
  assessments: AssessmentRecord[];
  hypotheses: ClinicalHypothesis[];
}

/**
 * Builds the portable record. `acknowledgedPlaintext` is not a formality — the
 * export is unencrypted clinical data, so the caller must state that the
 * clinician was told.
 */
export function buildPortableRecord(
  source: ExportSource,
  acknowledgedPlaintext: boolean,
  opts: BuildExportOptions = {},
): PortableClientRecord {
  if (!acknowledgedPlaintext) {
    throw new ExportRefusedError(
      'Export refused: the clinician has not acknowledged that the exported file is unencrypted plain text.',
      'unacknowledged',
    );
  }

  const includeLocalOnly = opts.includeLocalOnly ?? false;
  const usableInputs = source.inputs.filter((i) => includeLocalOnly || !i.localOnly);
  const localOnlyExcluded = source.inputs.length - usableInputs.length;
  const keptInputIds = new Set(usableInputs.map((i) => i.id));

  // Facts point at a source input. If that input was excluded, the fact loses
  // its provenance, so it is excluded too rather than shipped unsourced.
  const facts = source.facts.filter((f) => keptInputIds.has(f.sourceInputId));
  const assessments = source.assessments.filter(
    (a) => !a.sourceInputId || keptInputIds.has(a.sourceInputId),
  );

  const record: PortableClientRecord = {
    format: PORTABLE_FORMAT,
    version: PORTABLE_VERSION,
    provenance: {
      producedBy: opts.producedBy ?? 'Cockpit',
      exportedAt: new Date().toISOString(),
      purpose: opts.purpose,
      sourceClientId: source.client.id,
    },
    handlingNotice: HANDLING_NOTICE,
    importNotice: IMPORT_NOTICE,
    client: stripForbidden(source.client),
    clinicalInputs: usableInputs.map((input) => {
      const { attachments, ...rest } = input;
      return {
        ...stripForbidden(rest),
        attachments: attachments.map((a) => ({ name: a.name, mimeType: a.mimeType, size: a.size })),
        attachmentsOmitted: attachments.length > 0,
      };
    }),
    facts: stripForbidden(facts),
    assessments: stripForbidden(assessments),
    hypotheses: stripForbidden(source.hypotheses),
    counts: {
      clinicalInputs: usableInputs.length,
      facts: facts.length,
      assessments: assessments.length,
      hypotheses: source.hypotheses.length,
      riskFlaggedInputs: usableInputs.filter((i) => i.containsRisk).length,
      localOnlyExcluded,
    },
  };

  // Belt and braces: prove the serialized form carries no forbidden key.
  const offending = findForbiddenKeys(record);
  if (offending.length > 0) {
    throw new ExportRefusedError(
      `Export refused: forbidden field(s) present after stripping: ${offending.join(', ')}`,
      'forbidden-content',
    );
  }
  return record;
}

/** Returns any forbidden key names present anywhere in the structure. */
export function findForbiddenKeys(value: unknown, found: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const v of value) findForbiddenKeys(v, found);
  } else if (value && typeof value === 'object') {
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      if (FORBIDDEN_EXPORT_KEYS.includes(key) && !found.includes(key)) found.push(key);
      findForbiddenKeys(v, found);
    }
  }
  return found;
}

// ------------------------------------------------------ human-readable

function line(label: string, value?: string | number | boolean): string[] {
  return value === undefined || value === '' ? [] : [`${label}: ${value}`];
}

/**
 * Markdown rendering for a clinician who does not run Cockpit. It is a
 * faithful, complete rendering of the same data — not a summary — so what the
 * recipient reads is what the file contains.
 */
export function renderPortableMarkdown(record: PortableClientRecord): string {
  const out: string[] = [];
  out.push(`# Clinical record — ${record.client.displayName}`, '');
  out.push(`> **${record.handlingNotice}**`, '');
  out.push(`> **${record.importNotice}**`, '');
  out.push('## Provenance', '');
  out.push(
    ...line('Produced by', record.provenance.producedBy),
    ...line('Exported at', record.provenance.exportedAt),
    ...line('Purpose', record.provenance.purpose),
    ...line('Format', `${record.format} v${record.version}`),
  );
  if (record.counts.localOnlyExcluded > 0) {
    out.push(
      '',
      `_${record.counts.localOnlyExcluded} record(s) marked local-only were excluded from this export._`,
    );
  }
  out.push('', '## Client', '');
  out.push(
    ...line('Display name', record.client.displayName),
    ...line('Pronouns', record.client.pronouns),
    ...line('Level of care', record.client.levelOfCare),
    ...line('Status', record.client.status),
    ...line('Risk level', record.client.risk.level),
  );
  if (record.client.diagnoses.length > 0) {
    out.push('', '**Diagnoses / impressions**', '');
    for (const d of record.client.diagnoses) {
      out.push(`- ${d.label}${d.code ? ` (${d.code})` : ''} — ${d.kind}`);
    }
  }
  if (record.client.medications.length > 0) {
    out.push('', '**Medications**', '');
    for (const m of record.client.medications) out.push(`- ${m.name}${m.dose ? ` — ${m.dose}` : ''}`);
  }

  out.push('', `## Clinical inputs (${record.counts.clinicalInputs})`, '');
  for (const input of record.clinicalInputs) {
    out.push(`### ${input.inputType} — ${input.dateOfInformation}`, '');
    out.push(
      ...line('Source', input.authorSource),
      ...line('Reported by', input.reportedBy),
      ...line('Contains risk content', input.containsRisk ? 'yes' : 'no'),
      ...line('Archived', input.archived ? 'yes' : 'no'),
    );
    if (input.attachmentsOmitted) {
      out.push(
        `_Attachments not included in this export: ${input.attachments.map((a) => a.name).join(', ')}_`,
      );
    }
    out.push('', input.rawText, '');
  }

  out.push('', `## Extracted facts (${record.counts.facts})`, '');
  out.push(
    '_Review status shown is from the exporting workspace and does not carry over._',
    '',
  );
  for (const fact of record.facts) {
    out.push(
      `- **${fact.category}** — ${fact.statement}` +
        ` _(${fact.classification}, ${fact.temporalStatus}, was: ${fact.reviewStatus})_`,
    );
    if (fact.excerpt) out.push(`  - Excerpt: “${fact.excerpt}”`);
  }

  out.push('', `## Assessments (${record.counts.assessments})`, '');
  for (const a of record.assessments) {
    out.push(
      `- **${a.name}** ${a.dateAdministered}` +
        (a.totalScore === undefined ? '' : ` — total ${a.totalScore}`) +
        (a.severityInterpretation ? ` (${a.severityInterpretation})` : ''),
    );
    if (a.riskFlags.length > 0) {
      out.push(`  - Risk flags: ${a.riskFlags.join(', ')}${a.riskDisposition ? ` — ${a.riskDisposition}` : ''}`);
    }
  }
  out.push(
    '',
    '_Assessment scores are screening measures. They are not diagnoses._',
    '',
  );

  out.push(`## Clinical hypotheses (${record.counts.hypotheses})`, '');
  out.push('_Hypotheses are working clinical impressions, not established facts._', '');
  for (const h of record.hypotheses) {
    out.push(`- **${h.category}** — ${h.statement} _(confidence: ${h.confidence})_`);
  }

  return out.join('\n');
}

/**
 * CSV of assessment scores for import into a spreadsheet or an outcome-tracking
 * tool. Scores only — no narrative clinical text ends up in a CSV that people
 * routinely email around.
 */
export function renderAssessmentCsv(record: PortableClientRecord): string {
  const esc = (v: string | number | undefined) => {
    if (v === undefined) return '';
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const rows = [
    ['client', 'assessment', 'definition_key', 'date_administered', 'total_score', 'severity_interpretation', 'risk_flags'],
    ...record.assessments.map((a) => [
      esc(record.client.displayName),
      esc(a.name),
      esc(a.definitionKey),
      esc(a.dateAdministered),
      esc(a.totalScore),
      esc(a.severityInterpretation),
      esc(a.riskFlags.join('; ')),
    ]),
  ];
  return rows.map((r) => r.join(',')).join('\n');
}
