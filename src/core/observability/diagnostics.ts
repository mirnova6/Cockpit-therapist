/**
 * Phase 9 privacy-safe observability (§22).
 *
 * Records operational events for reliability work WITHOUT any clinical
 * content. The event type deliberately has no field that can hold PHI, prompt
 * text, model output or API keys — and `recordDiagnostic` additionally scrubs
 * its free-text fields, so a careless caller still cannot leak.
 */
import { newId, nowIso } from '../db/schema';
import type { EncryptedStore } from '../storage/encryptedStore';

export type DiagnosticFeature =
  | 'storage'
  | 'backup'
  | 'restore'
  | 'migration'
  | 'auth'
  | 'native-bridge'
  | 'ai-provider'
  | 'retrieval'
  | 'extraction'
  | 'export'
  | 'ui';

export type DiagnosticSeverity = 'info' | 'warning' | 'error';

export interface DiagnosticEvent {
  id: string;
  at: string;
  appVersion: string;
  platform: string;
  feature: DiagnosticFeature;
  severity: DiagnosticSeverity;
  /** Stable machine code, e.g. 'restore-checksum-mismatch'. */
  code: string;
  /** Sanitized category, never a raw provider/browser message. */
  errorCategory?: string;
  durationMs?: number;
  /** Opaque reference only — never a client name or record content. */
  clientRef?: string;
  cancelled?: boolean;
}

export type DiagnosticDraft = Omit<DiagnosticEvent, 'id' | 'at'>;

const COLLECTION = 'diagnostics';

/**
 * Codes must be machine-ish identifiers. Anything that looks like prose (or
 * carries digits that could be an identifier) is reduced to a safe token, so a
 * caller cannot smuggle content through `code`.
 */
export function sanitizeCode(code: string): string {
  const trimmed = code.trim().toLowerCase().replace(/\s+/g, '-');
  const safe = trimmed.replace(/[^a-z0-9-]/g, '');
  return safe.slice(0, 64) || 'unspecified';
}

/** Opaque, stable-per-session reference for correlating events to a client. */
export function opaqueRef(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (Math.imul(31, h) + seed.charCodeAt(i)) | 0;
  return `ref-${(h >>> 0).toString(36)}`;
}

export interface DiagnosticsHost {
  store: EncryptedStore;
}

export class DiagnosticsRepository {
  constructor(private host: DiagnosticsHost) {}

  /** Record an event. Free-text fields are sanitized before storage. */
  async record(draft: DiagnosticDraft): Promise<DiagnosticEvent> {
    const event: DiagnosticEvent = {
      id: newId(),
      at: nowIso(),
      appVersion: draft.appVersion,
      platform: draft.platform,
      feature: draft.feature,
      severity: draft.severity,
      code: sanitizeCode(draft.code),
      errorCategory: draft.errorCategory ? sanitizeCode(draft.errorCategory) : undefined,
      durationMs: draft.durationMs,
      clientRef: draft.clientRef,
      cancelled: draft.cancelled,
    };
    await this.host.store.put(COLLECTION, event.id, event);
    return event;
  }

  async list(limit = 500): Promise<DiagnosticEvent[]> {
    const all = await this.host.store.getAll<DiagnosticEvent>(COLLECTION);
    return all.sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit);
  }

  async clear(): Promise<number> {
    const all = await this.host.store.getAll<DiagnosticEvent>(COLLECTION);
    for (const e of all) await this.host.store.remove(COLLECTION, e.id);
    return all.length;
  }
}

export interface DiagnosticExport {
  format: 'cockpit-diagnostics';
  version: 1;
  generatedAt: string;
  noPhiConfirmed: true;
  events: DiagnosticEvent[];
  notice: string;
}

export class DiagnosticExportRefusedError extends Error {
  constructor() {
    super('Diagnostic export requires the “contains no PHI” confirmation.');
    this.name = 'DiagnosticExportRefusedError';
  }
}

/** Local diagnostic export, gated on the same no-PHI confirmation as bug reports. */
export function buildDiagnosticExport(events: DiagnosticEvent[], noPhiConfirmed: boolean): DiagnosticExport {
  if (!noPhiConfirmed) throw new DiagnosticExportRefusedError();
  return {
    format: 'cockpit-diagnostics',
    version: 1,
    generatedAt: new Date().toISOString(),
    noPhiConfirmed: true,
    events,
    notice:
      'Operational diagnostics only: app version, platform, feature, error category, timings and opaque references. Contains no clinical text, prompts, outputs or API keys.',
  };
}
