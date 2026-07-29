/**
 * Import preview and commit (Phase 9, §21).
 *
 * Importing a clinical record is a clinical act, so this module is built around
 * refusing to do it silently:
 *
 *  1. `parsePortableFile` validates structure and reports what it rejected and
 *     why. A malformed file produces an explained refusal, never a partial or
 *     guessed import.
 *  2. `buildImportPreview` shows exactly what would be created — counts, every
 *     risk-flagged record, and every downgrade — and computes nothing behind
 *     the clinician's back.
 *  3. `commitImport` refuses to run without a preview token plus explicit
 *     confirmation, and refuses again if risk-flagged records have not been
 *     individually acknowledged.
 *
 * Two rules the rest of the app depends on and this module must not break:
 *
 *  - **Approval does not transfer.** Every imported record is written with a
 *    needs-review status regardless of what the file claims. A clinician in
 *    this workspace has not seen this content.
 *  - **Imported text is data, not instructions.** Nothing in a file is
 *    interpreted as configuration, and imported prose never reaches a model as
 *    anything but quoted client content.
 */
import { newId, nowIso, type ClinicalInput, type Client } from '../db/schema';
import type {
  AssessmentRecord,
  ClinicalHypothesis,
  ExtractedFact,
  ReviewStatus,
} from '../db/structuredSchema';
import {
  PORTABLE_FORMAT,
  PORTABLE_VERSION,
  type PortableClientRecord,
} from './portableRecord';

/** Status every imported clinical record receives, regardless of the file. */
export const IMPORTED_REVIEW_STATUS: ReviewStatus = 'pending';

export type ImportRejectionCode =
  | 'not-json'
  | 'wrong-format'
  | 'unsupported-future-version'
  | 'missing-client'
  | 'missing-required-field'
  | 'not-an-object';

export class ImportRefusedError extends Error {
  constructor(
    message: string,
    readonly code: ImportRejectionCode | 'unconfirmed' | 'risk-unacknowledged' | 'stale-preview',
  ) {
    super(message);
    this.name = 'ImportRefusedError';
  }
}

export interface ParsedImport {
  record: PortableClientRecord;
  /** Records dropped during parsing, with the reason shown to the clinician. */
  dropped: Array<{ kind: string; label: string; reason: string }>;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function requireString(v: unknown, field: string, label: string, dropped: ParsedImport['dropped'], kind: string): string | undefined {
  if (typeof v === 'string' && v.trim() !== '') return v;
  dropped.push({ kind, label, reason: `missing or empty required field "${field}"` });
  return undefined;
}

/**
 * Parses and validates a portable file. Throws for a file that cannot be an
 * import at all; drops (and reports) individual records that are malformed.
 */
export function parsePortableFile(text: string): ParsedImport {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new ImportRefusedError(
      'This file is not valid JSON. Cockpit will not attempt to guess its contents.',
      'not-json',
    );
  }
  if (!isObject(raw)) {
    throw new ImportRefusedError('The file does not contain a record object.', 'not-an-object');
  }
  if (raw.format !== PORTABLE_FORMAT) {
    throw new ImportRefusedError(
      `Unrecognised format "${String(raw.format ?? 'none')}". Expected "${PORTABLE_FORMAT}".`,
      'wrong-format',
    );
  }
  const version = typeof raw.version === 'number' ? raw.version : 0;
  if (version > PORTABLE_VERSION) {
    throw new ImportRefusedError(
      `This file was written by a newer version of Cockpit (format v${version}; this build understands up to v${PORTABLE_VERSION}). ` +
        'Importing it could silently discard fields, so it is refused.',
      'unsupported-future-version',
    );
  }
  if (!isObject(raw.client) || typeof raw.client.displayName !== 'string') {
    throw new ImportRefusedError('The file contains no client record.', 'missing-client');
  }

  const dropped: ParsedImport['dropped'] = [];
  const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

  const clinicalInputs = arr(raw.clinicalInputs)
    .filter(isObject)
    .filter((i) => {
      const label = String(i.dateOfInformation ?? i.id ?? 'unnamed input');
      const ok =
        requireString(i.rawText, 'rawText', label, dropped, 'clinical input') !== undefined &&
        requireString(i.inputType, 'inputType', label, dropped, 'clinical input') !== undefined &&
        requireString(i.dateOfInformation, 'dateOfInformation', label, dropped, 'clinical input') !== undefined;
      return ok;
    }) as PortableClientRecord['clinicalInputs'];

  const facts = arr(raw.facts)
    .filter(isObject)
    .filter((f) => {
      const label = String(f.statement ?? f.id ?? 'unnamed fact');
      return (
        requireString(f.statement, 'statement', label, dropped, 'fact') !== undefined &&
        requireString(f.category, 'category', label, dropped, 'fact') !== undefined
      );
    }) as unknown as ExtractedFact[];

  const assessments = arr(raw.assessments)
    .filter(isObject)
    .filter((a) => {
      const label = String(a.name ?? a.id ?? 'unnamed assessment');
      return (
        requireString(a.name, 'name', label, dropped, 'assessment') !== undefined &&
        requireString(a.dateAdministered, 'dateAdministered', label, dropped, 'assessment') !== undefined
      );
    }) as unknown as AssessmentRecord[];

  const hypotheses = arr(raw.hypotheses)
    .filter(isObject)
    .filter((h) => {
      const label = String(h.statement ?? h.id ?? 'unnamed hypothesis');
      return (
        requireString(h.statement, 'statement', label, dropped, 'hypothesis') !== undefined &&
        requireString(h.category, 'category', label, dropped, 'hypothesis') !== undefined
      );
    }) as unknown as ClinicalHypothesis[];

  const record = {
    ...(raw as unknown as PortableClientRecord),
    clinicalInputs,
    facts,
    assessments,
    hypotheses,
  };
  return { record, dropped };
}

export interface ImportPreviewRow {
  kind: 'client' | 'clinical input' | 'fact' | 'assessment' | 'hypothesis';
  label: string;
  detail?: string;
  /** True when this record carries risk content and needs individual review. */
  riskFlagged: boolean;
  /** The status in the file, shown so the downgrade is visible, not hidden. */
  incomingStatus?: string;
  /** What it will actually be written as. */
  resultingStatus?: string;
}

export interface ImportPreview {
  /** Opaque token tying a confirmation to exactly this preview. */
  token: string;
  sourceClientDisplayName: string;
  /** Set when a client with the same display name already exists here. */
  possibleDuplicateOf?: { id: string; displayName: string };
  createsNewClient: true;
  rows: ImportPreviewRow[];
  dropped: ParsedImport['dropped'];
  counts: {
    clinicalInputs: number;
    facts: number;
    assessments: number;
    hypotheses: number;
    riskFlagged: number;
    approvedInFileButResetHere: number;
  };
  warnings: string[];
  /** Risk-flagged rows that must each be acknowledged before committing. */
  riskRowsRequiringAcknowledgement: string[];
}

let previewCounter = 0;

/**
 * Builds the preview. `existingClients` is used only to warn about a possible
 * duplicate — an import always creates a NEW client and never merges into or
 * overwrites an existing one, because a wrong merge silently corrupts a
 * clinical record in a way that is very hard to unpick.
 */
export function buildImportPreview(
  parsed: ParsedImport,
  existingClients: Array<{ id: string; displayName: string }> = [],
): ImportPreview {
  const { record, dropped } = parsed;
  const rows: ImportPreviewRow[] = [];
  const riskRows: string[] = [];
  let approvedInFile = 0;

  const countReset = (status: unknown) => {
    if (status === 'approved' || status === 'edited') approvedInFile++;
  };

  rows.push({
    kind: 'client',
    label: record.client.displayName,
    detail: `${record.client.levelOfCare} · ${record.client.status} · risk: ${record.client.risk?.level ?? 'not-assessed'}`,
    riskFlagged: false,
  });

  for (const input of record.clinicalInputs) {
    const label = `${input.inputType} — ${input.dateOfInformation}`;
    if (input.containsRisk) riskRows.push(label);
    rows.push({
      kind: 'clinical input',
      label,
      detail: `${input.rawText.length} characters${input.attachmentsOmitted ? ' · attachments not included' : ''}`,
      riskFlagged: Boolean(input.containsRisk),
    });
  }

  for (const fact of record.facts) {
    countReset(fact.reviewStatus);
    if (fact.riskRelated) riskRows.push(fact.statement);
    rows.push({
      kind: 'fact',
      label: fact.statement,
      detail: fact.category,
      riskFlagged: Boolean(fact.riskRelated),
      incomingStatus: fact.reviewStatus,
      resultingStatus: IMPORTED_REVIEW_STATUS,
    });
  }

  for (const a of record.assessments) {
    countReset(a.reviewStatus);
    const risky = (a.riskFlags?.length ?? 0) > 0;
    const label = `${a.name} — ${a.dateAdministered}`;
    if (risky) riskRows.push(label);
    rows.push({
      kind: 'assessment',
      label,
      detail: a.totalScore === undefined ? 'no total score' : `total ${a.totalScore}`,
      riskFlagged: risky,
      incomingStatus: a.reviewStatus,
      resultingStatus: IMPORTED_REVIEW_STATUS,
    });
  }

  for (const h of record.hypotheses) {
    countReset(h.reviewStatus);
    rows.push({
      kind: 'hypothesis',
      label: h.statement,
      detail: h.category,
      riskFlagged: false,
      incomingStatus: h.reviewStatus,
      resultingStatus: IMPORTED_REVIEW_STATUS,
    });
  }

  const warnings: string[] = [
    'Review status from the source workspace is not carried over. Every imported record will need review here.',
  ];
  if (riskRows.length > 0) {
    warnings.push(
      `${riskRows.length} record(s) contain risk content and must be acknowledged individually before import.`,
    );
  }
  if (approvedInFile > 0) {
    warnings.push(
      `${approvedInFile} record(s) were approved in the source workspace and will be imported as needing review here.`,
    );
  }
  if (dropped.length > 0) {
    warnings.push(`${dropped.length} malformed record(s) will not be imported. See the list below.`);
  }
  if (record.clinicalInputs.some((i) => i.attachmentsOmitted)) {
    warnings.push('Attachment files are not included in portable exports; only their names were carried over.');
  }

  const duplicate = existingClients.find(
    (c) => c.displayName.trim().toLowerCase() === record.client.displayName.trim().toLowerCase(),
  );
  if (duplicate) {
    warnings.push(
      `A client named "${duplicate.displayName}" already exists in this workspace. Importing creates a SECOND, separate client — it does not merge.`,
    );
  }

  return {
    token: `import-${Date.now()}-${previewCounter++}`,
    sourceClientDisplayName: record.client.displayName,
    possibleDuplicateOf: duplicate,
    createsNewClient: true,
    rows,
    dropped,
    counts: {
      clinicalInputs: record.clinicalInputs.length,
      facts: record.facts.length,
      assessments: record.assessments.length,
      hypotheses: record.hypotheses.length,
      riskFlagged: riskRows.length,
      approvedInFileButResetHere: approvedInFile,
    },
    warnings,
    riskRowsRequiringAcknowledgement: riskRows,
  };
}

export interface ImportConfirmation {
  /** Must equal the preview's token — a confirmation cannot be reused. */
  token: string;
  confirmedByClinician: string;
  /** Explicit acknowledgement that imported content still needs review. */
  acknowledgedNeedsReview: boolean;
  /** Every label from `riskRowsRequiringAcknowledgement`, individually. */
  acknowledgedRiskRows: string[];
}

export interface ImportPlan {
  client: Omit<Client, 'id' | 'createdAt' | 'updatedAt'> & { archived: boolean };
  inputs: Array<Omit<ClinicalInput, 'id' | 'dateEntered' | 'attachments' | 'processingStatus' | 'version' | 'updatedAt'>>;
  facts: Array<Omit<ExtractedFact, 'id' | 'clientId' | 'createdAt' | 'updatedAt' | 'version'>>;
  assessments: Array<Omit<AssessmentRecord, 'id' | 'clientId' | 'createdAt' | 'updatedAt' | 'version'>>;
  hypotheses: Array<Omit<ClinicalHypothesis, 'id' | 'clientId' | 'createdAt' | 'updatedAt' | 'version'>>;
  /** Audit summary the caller writes; states the downgrade explicitly. */
  auditSummary: string;
}

/**
 * Validates the confirmation and produces the concrete write plan. Nothing is
 * persisted here — the caller performs the writes — so a refusal cannot leave a
 * half-imported client behind.
 */
export function commitImport(
  parsed: ParsedImport,
  preview: ImportPreview,
  confirmation: ImportConfirmation,
): ImportPlan {
  if (confirmation.token !== preview.token) {
    throw new ImportRefusedError(
      'This confirmation does not match the preview that was shown. Re-run the preview and confirm again.',
      'stale-preview',
    );
  }
  if (!confirmation.acknowledgedNeedsReview || !confirmation.confirmedByClinician.trim()) {
    throw new ImportRefusedError(
      'Import refused: a named clinician must confirm that imported records will need review in this workspace.',
      'unconfirmed',
    );
  }
  const missing = preview.riskRowsRequiringAcknowledgement.filter(
    (label) => !confirmation.acknowledgedRiskRows.includes(label),
  );
  if (missing.length > 0) {
    throw new ImportRefusedError(
      `Import refused: ${missing.length} risk-flagged record(s) were not individually acknowledged: ${missing
        .slice(0, 3)
        .join('; ')}${missing.length > 3 ? ' …' : ''}`,
      'risk-unacknowledged',
    );
  }

  const { record } = parsed;
  const now = nowIso();

  return {
    client: {
      displayName: record.client.displayName,
      preferredIdentifier: record.client.preferredIdentifier,
      pronouns: record.client.pronouns,
      dateOfBirth: record.client.dateOfBirth,
      contactEnabled: false, // contact details are never auto-enabled on import
      levelOfCare: record.client.levelOfCare,
      status: record.client.status,
      admissionDate: record.client.admissionDate,
      dischargeDate: record.client.dischargeDate,
      assignedTherapist: confirmation.confirmedByClinician,
      presentingProblem: record.client.presentingProblem,
      diagnoses: record.client.diagnoses ?? [],
      medications: record.client.medications ?? [],
      // Risk level is imported as-is but the underlying records still require
      // review; the importing clinician re-assesses.
      risk: record.client.risk ?? { level: 'not-assessed' },
      aiLocalOnly: record.client.aiLocalOnly,
      archived: false,
    },
    inputs: record.clinicalInputs.map((input) => ({
      clientId: '', // filled in by the caller once the client exists
      inputType: input.inputType,
      dateOfInformation: input.dateOfInformation,
      sessionDate: input.sessionDate,
      sessionNumber: input.sessionNumber,
      rawText: input.rawText,
      authorSource: input.authorSource,
      reportedBy: input.reportedBy,
      containsRisk: input.containsRisk,
      // The source workspace's risk sign-off does not transfer.
      riskReview: undefined,
      // Consent does not transfer either: imported records start excluded from
      // AI analysis until the receiving clinician opts them in.
      allowAiAnalysis: false,
      localOnly: input.localOnly,
      archived: input.archived,
    })),
    facts: record.facts.map((fact) => ({
      sourceInputId: fact.sourceInputId,
      sourceInputVersion: fact.sourceInputVersion,
      category: fact.category,
      statement: fact.statement,
      excerpt: fact.excerpt,
      sourceLocation: fact.sourceLocation,
      dateOccurred: fact.dateOccurred,
      dateRecorded: fact.dateRecorded ?? now,
      classification: fact.classification,
      extractionMethod: fact.extractionMethod,
      extractionConfidence: fact.extractionConfidence,
      temporalStatus: fact.temporalStatus,
      reviewStatus: IMPORTED_REVIEW_STATUS,
      clinicianCorrection: undefined,
      riskRelated: Boolean(fact.riskRelated),
    })),
    assessments: record.assessments.map((a) => ({
      definitionKey: a.definitionKey,
      name: a.name,
      dateAdministered: a.dateAdministered,
      totalScore: a.totalScore,
      subscaleScores: a.subscaleScores,
      severityInterpretation: a.severityInterpretation,
      clinicianNotes: a.clinicianNotes,
      sourceInputId: undefined,
      riskFlags: a.riskFlags ?? [],
      riskDisposition: a.riskDisposition,
      reviewStatus: IMPORTED_REVIEW_STATUS,
    })),
    hypotheses: record.hypotheses.map((h) => ({
      category: h.category,
      statement: h.statement,
      confidence: h.confidence,
      alternativeExplanations: h.alternativeExplanations ?? [],
      missingInformation: h.missingInformation ?? [],
      questionsToAssess: h.questionsToAssess ?? [],
      clinicianComments: h.clinicianComments,
      reviewStatus: IMPORTED_REVIEW_STATUS,
      lifecycleStatus: 'active' as const,
    })),
    auditSummary:
      `Imported client "${record.client.displayName}" from ${record.format} v${record.version} ` +
      `(${preview.counts.clinicalInputs} inputs, ${preview.counts.facts} facts, ` +
      `${preview.counts.assessments} assessments, ${preview.counts.hypotheses} hypotheses); ` +
      `all records set to "${IMPORTED_REVIEW_STATUS}"; AI analysis consent not carried over; ` +
      `confirmed by ${confirmation.confirmedByClinician}.`,
  };
}

/** Stable id helper for callers that need to pre-allocate ids. */
export function newImportId(): string {
  return newId();
}
