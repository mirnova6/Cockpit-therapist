/**
 * Phase 8 Beta Testing Mode schema.
 *
 * Beta mode is a clearly-labeled testing mode for FICTIONAL or fully
 * DE-IDENTIFIED data only. It does NOT unlock real-PHI use — the Real PHI
 * Readiness Gate (Phase 7) remains authoritative and blocked by default.
 *
 * Everything here is stored in the encrypted records store. Bug reports and
 * feedback are PHI-free by construction: they capture structured fields only,
 * never client records, notes, transcripts, prompts, API keys, or exports.
 */

/** The exact banner shown whenever beta mode is enabled. */
export const BETA_BANNER =
  'Beta testing mode: use fictional or fully de-identified data only. Real PHI remains blocked until the Real PHI Readiness Gate is completed and reviewed.';

export interface BetaState {
  enabled: boolean;
  enabledAt?: string;
  sampleDataLoaded: boolean;
  sampleClientIds: string[];
  updatedAt: string;
}

// ------------------------------------------------- guided testing checklist

export type BetaCheckStatus = 'pending' | 'pass' | 'fail' | 'blocked' | 'skip';

export const BETA_CHECK_STATUSES: Array<{ value: BetaCheckStatus; label: string }> = [
  { value: 'pending', label: 'Not tested' },
  { value: 'pass', label: 'Pass' },
  { value: 'fail', label: 'Fail' },
  { value: 'blocked', label: 'Blocked' },
  { value: 'skip', label: 'Not applicable' },
];

export interface BetaCheckItem {
  id: string;
  key: string;
  category: string;
  label: string;
  detail: string;
  status: BetaCheckStatus;
  notes?: string;
  updatedAt: string;
}

export type BetaCheckSeed = Pick<BetaCheckItem, 'key' | 'category' | 'label' | 'detail'>;

/** Guided testing checklist covering the Phase 8 acceptance flows. */
export const BETA_CHECK_SEED: BetaCheckSeed[] = [
  { key: 'setup', category: 'Access', label: 'First-run setup', detail: 'Create a workspace with passphrase (and optional PIN).' },
  { key: 'unlock', category: 'Access', label: 'Unlock', detail: 'Lock the workspace and unlock with passphrase, then PIN if set.' },
  { key: 'failed-unlock', category: 'Access', label: 'Failed unlock & lockout', detail: 'Enter a wrong passphrase repeatedly; confirm escalating lockout.' },
  { key: 'auto-lock', category: 'Access', label: 'Auto-lock', detail: 'Leave the app idle past the auto-lock interval; confirm it locks.' },
  { key: 'device-unlock', category: 'Access', label: 'Device unlock (native only)', detail: 'If on a native build with OS key storage, enable device unlock and verify; wipe the key and confirm passphrase is required.' },
  { key: 'client-crud', category: 'Records', label: 'Create/edit/archive/delete client', detail: 'Exercise the full client lifecycle with a fictional client.' },
  { key: 'add-info', category: 'Records', label: 'Add clinical information', detail: 'Add a session transcript and other input types (fictional).' },
  { key: 'attachment', category: 'Records', label: 'Add attachment', detail: 'Attach a fictional file to an input.' },
  { key: 'assessment', category: 'Records', label: 'Add assessment', detail: 'Record a PHQ-9/GAD-7 score and confirm the interpretation band.' },
  { key: 'extract', category: 'Intelligence', label: 'Extract & review facts', detail: 'Run deterministic extraction and approve/reject proposed facts.' },
  { key: 'dap', category: 'Documents', label: 'Generate deterministic DAP note', detail: 'Generate a DAP note from approved information and review it.' },
  { key: 'plan', category: 'Documents', label: 'Generate treatment plan', detail: 'Generate a Master Treatment Plan and confirm risk gating on approval.' },
  { key: 'local-ai', category: 'AI', label: 'Local AI connection (if configured)', detail: 'Configure a local endpoint; confirm the readiness check is honest.' },
  { key: 'online-refusal', category: 'AI', label: 'Online AI refusal without approval', detail: 'Attempt online AI without provider approval; confirm it is refused.' },
  { key: 'local-only-status', category: 'AI', label: 'Local-only status is accurate', detail: 'Confirm the processing-status indicator reflects the real mode.' },
  { key: 'backup', category: 'Data', label: 'Backup', detail: 'Create an encrypted backup and confirm the integrity badge.' },
  { key: 'restore', category: 'Data', label: 'Restore', detail: 'Restore the backup into a fresh workspace and confirm data returns.' },
  { key: 'export', category: 'Data', label: 'Export approved document', detail: 'Export an approved document; confirm drafts are watermarked.' },
  { key: 'secure-deletion', category: 'Data', label: 'Secure deletion', detail: 'Delete a fictional client; confirm the cascade removes all records.' },
  { key: 'offline', category: 'Runtime', label: 'Offline behavior', detail: 'Disconnect the network; confirm the app still works local-only.' },
  { key: 'restart-persistence', category: 'Runtime', label: 'App restart persistence', detail: 'Close and reopen the app; confirm data persists and re-auth is required.' },
  { key: 'crash-reopen', category: 'Runtime', label: 'Crash/reopen behavior', detail: 'Force-quit mid-task and reopen; confirm no corruption or data loss.' },
  { key: 'navigation', category: 'UX', label: 'Navigation usability', detail: 'Move through grouped nav / the mobile More menu; confirm clarity.' },
  { key: 'long-notes', category: 'Performance', label: 'Performance with long notes', detail: 'Paste a very long transcript; confirm the app stays responsive.' },
];

// -------------------------------------------------------- bug reports

export const BUG_ISSUE_TYPES = ['Crash', 'Data', 'UI/Layout', 'Performance', 'Incorrect behavior', 'Confusing UX', 'Other'] as const;
export type BugIssueType = (typeof BUG_ISSUE_TYPES)[number];

export const BUG_SEVERITIES = ['blocker', 'major', 'minor', 'trivial'] as const;
export type BugSeverity = (typeof BUG_SEVERITIES)[number];

/**
 * A bug report. PHI-free by construction: structured fields only. No client
 * records, notes, transcripts, prompts, API keys, or exports are captured. A
 * report can only be saved when `noPhiConfirmed` is true.
 */
export interface BugReport {
  id: string;
  appVersion: string;
  platform: string;
  screen: string;
  issueType: BugIssueType;
  stepsToReproduce: string;
  expectedBehavior: string;
  actualBehavior: string;
  severity: BugSeverity;
  /** Optional filename the tester will attach out-of-band (not stored here). */
  screenshotNote?: string;
  noPhiConfirmed: boolean;
  createdAt: string;
}

export type BugReportDraft = Omit<BugReport, 'id' | 'createdAt'>;

// -------------------------------------------------------- feedback

export interface BetaFeedback {
  id: string;
  area: string;
  /** 1 (poor) – 5 (excellent). */
  rating: number;
  comment: string;
  createdAt: string;
}

export type BetaFeedbackDraft = Omit<BetaFeedback, 'id' | 'createdAt'>;

/**
 * Scrub obvious secret-shaped tokens out of any free text before it is stored
 * in a bug report. This is a defense-in-depth guard, NOT a PHI detector — the
 * primary protection is that reports capture structured fields only and require
 * the no-PHI confirmation. Redacts API-key-looking strings and long digit runs.
 */
export function scrubText(text: string): string {
  return text
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, '[redacted-key]')
    .replace(/\b[A-Za-z0-9_-]{32,}\b/g, '[redacted-token]')
    .replace(/\b\d{9,}\b/g, '[redacted-number]');
}
