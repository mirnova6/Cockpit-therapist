/**
 * BetaRepository (Phase 8) — beta-mode state, the guided testing checklist,
 * PHI-free bug reports, and beta feedback. All encrypted at rest. Bug reports
 * and feedback capture structured fields only — never client records.
 */
import { newId, nowIso, type AuditCategory } from '../db/schema';
import type { EncryptedStore } from '../storage/encryptedStore';
import {
  BETA_CHECK_SEED,
  scrubText,
  type BetaCheckItem,
  type BetaCheckStatus,
  type BetaFeedback,
  type BetaFeedbackDraft,
  type BetaState,
  type BugReport,
  type BugReportDraft,
} from './betaSchema';

const C = {
  state: 'beta-state',
  checklist: 'beta-checklist',
  bugs: 'bug-reports',
  feedback: 'beta-feedback',
} as const;

const STATE_ID = 'singleton';

export interface BetaHost {
  store: EncryptedStore;
  audit: (category: AuditCategory, action: string, detail?: string) => Promise<void>;
}

export class BetaRepository {
  constructor(private host: BetaHost) {}
  private get store() {
    return this.host.store;
  }

  // --------------------------------------------------------------- state

  async getState(): Promise<BetaState> {
    const existing = await this.store.get<BetaState>(C.state, STATE_ID);
    return (
      existing ?? { enabled: false, sampleDataLoaded: false, sampleClientIds: [], updatedAt: nowIso() }
    );
  }

  async setEnabled(enabled: boolean): Promise<BetaState> {
    const current = await this.getState();
    const next: BetaState = {
      ...current,
      enabled,
      enabledAt: enabled ? current.enabledAt ?? nowIso() : current.enabledAt,
      updatedAt: nowIso(),
    };
    await this.store.put(C.state, STATE_ID, next);
    await this.host.audit('security', 'beta.mode', enabled ? 'enabled' : 'disabled');
    return next;
  }

  async markSampleLoaded(clientIds: string[]): Promise<BetaState> {
    const current = await this.getState();
    const next: BetaState = {
      ...current,
      sampleDataLoaded: true,
      sampleClientIds: [...new Set([...current.sampleClientIds, ...clientIds])],
      updatedAt: nowIso(),
    };
    await this.store.put(C.state, STATE_ID, next);
    return next;
  }

  // ----------------------------------------------------------- checklist

  async listChecklist(): Promise<BetaCheckItem[]> {
    const existing = await this.store.getAll<BetaCheckItem>(C.checklist);
    const byKey = new Map(existing.map((i) => [i.key, i]));
    for (const seed of BETA_CHECK_SEED) {
      if (!byKey.has(seed.key)) {
        const item: BetaCheckItem = { ...seed, id: newId(), status: 'pending', updatedAt: nowIso() };
        await this.store.put(C.checklist, item.id, item);
        byKey.set(seed.key, item);
      }
    }
    const order = new Map(BETA_CHECK_SEED.map((s, i) => [s.key, i]));
    return [...byKey.values()].sort((a, b) => (order.get(a.key) ?? 99) - (order.get(b.key) ?? 99));
  }

  async updateCheck(id: string, patch: { status?: BetaCheckStatus; notes?: string }): Promise<BetaCheckItem> {
    const existing = await this.store.get<BetaCheckItem>(C.checklist, id);
    if (!existing) throw new Error('Checklist item not found');
    const updated: BetaCheckItem = { ...existing, ...patch, updatedAt: nowIso() };
    await this.store.put(C.checklist, id, updated);
    return updated;
  }

  // --------------------------------------------------------- bug reports

  /**
   * Save a bug report. Refuses unless the tester confirmed it contains no PHI.
   * Free-text fields are scrubbed of secret-shaped tokens as defense in depth.
   */
  async addBugReport(draft: BugReportDraft): Promise<BugReport> {
    if (!draft.noPhiConfirmed) {
      throw new Error('A bug report cannot be saved until the “no PHI” confirmation is checked.');
    }
    const report: BugReport = {
      ...draft,
      stepsToReproduce: scrubText(draft.stepsToReproduce),
      expectedBehavior: scrubText(draft.expectedBehavior),
      actualBehavior: scrubText(draft.actualBehavior),
      screenshotNote: draft.screenshotNote ? scrubText(draft.screenshotNote) : undefined,
      id: newId(),
      createdAt: nowIso(),
    };
    await this.store.put(C.bugs, report.id, report);
    await this.host.audit('security', 'beta.bug-report', `${report.severity} · ${report.issueType} · ${report.screen}`);
    return report;
  }

  async listBugReports(): Promise<BugReport[]> {
    return (await this.store.getAll<BugReport>(C.bugs)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async deleteBugReport(id: string): Promise<void> {
    await this.store.remove(C.bugs, id);
  }

  // ----------------------------------------------------------- feedback

  async addFeedback(draft: BetaFeedbackDraft): Promise<BetaFeedback> {
    const record: BetaFeedback = {
      ...draft,
      comment: scrubText(draft.comment),
      id: newId(),
      createdAt: nowIso(),
    };
    await this.store.put(C.feedback, record.id, record);
    await this.host.audit('security', 'beta.feedback', `${record.area} · ${record.rating}/5`);
    return record;
  }

  async listFeedback(): Promise<BetaFeedback[]> {
    return (await this.store.getAll<BetaFeedback>(C.feedback)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
}
