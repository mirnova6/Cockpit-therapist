/**
 * Persistence for Phase 9 beta-feedback triage (§2).
 *
 * The PHI rule from Phase 8 is unchanged and enforced here rather than only in
 * the UI: an item cannot be stored without its no-PHI confirmation, and free
 * text is scrubbed of secret-shaped tokens on the way in. There is no field on
 * a triage item capable of holding a client record, transcript, prompt, model
 * output or key — see `FORBIDDEN_TRIAGE_FIELDS`, asserted by the tests.
 */
import type { EncryptedStore } from '../storage/encryptedStore';
import { newId, nowIso } from '../db/schema';
import { scrubText, type BugReport } from './betaSchema';
import {
  buildDashboard,
  CLOSED_STATUSES,
  type FeedbackPriority,
  type FeedbackStatus,
  type TriageDashboard,
  type TriageDraft,
  type TriageItem,
} from './feedbackTriage';

const COLLECTION = 'beta-triage';

export interface TriageHost {
  store: EncryptedStore;
  audit: (category: 'security' | 'data', action: string, detail?: string) => Promise<void>;
}

export class TriageRepository {
  constructor(private host: TriageHost) {}

  private get store() {
    return this.host.store;
  }

  async list(): Promise<TriageItem[]> {
    return (await this.store.getAll<TriageItem>(COLLECTION)).sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt),
    );
  }

  async dashboard(): Promise<TriageDashboard> {
    return buildDashboard(await this.list());
  }

  /** Next reference in the FB-0001 sequence, based on what already exists. */
  private nextReference(existing: TriageItem[]): string {
    const highest = existing.reduce((max, item) => {
      const n = Number(/^FB-(\d+)$/.exec(item.reference)?.[1] ?? 0);
      return Number.isFinite(n) && n > max ? n : max;
    }, 0);
    return `FB-${String(highest + 1).padStart(4, '0')}`;
  }

  async create(draft: TriageDraft): Promise<TriageItem> {
    if (!draft.noPhiConfirmed) {
      throw new Error('A triage item cannot be saved until the “no PHI” confirmation is checked.');
    }
    const existing = await this.list();
    const item: TriageItem = {
      ...draft,
      description: scrubText(draft.description),
      expectedBehavior: scrubText(draft.expectedBehavior),
      actualBehavior: scrubText(draft.actualBehavior),
      resolutionNotes: draft.resolutionNotes ? scrubText(draft.resolutionNotes) : undefined,
      id: newId(),
      reference: this.nextReference(existing),
      createdAt: nowIso(),
      resolvedAt: CLOSED_STATUSES.includes(draft.status) ? nowIso() : undefined,
    };
    await this.store.put(COLLECTION, item.id, item);
    await this.host.audit(
      'security',
      'beta.triage.created',
      `${item.reference} · ${item.category} · ${item.severity}`,
    );
    return item;
  }

  async update(
    id: string,
    patch: { status?: FeedbackStatus; priority?: FeedbackPriority; resolutionNotes?: string; linkedCommit?: string; linkedRelease?: string },
  ): Promise<TriageItem> {
    const existing = await this.store.get<TriageItem>(COLLECTION, id);
    if (!existing) throw new Error('Triage item not found.');

    const status = patch.status ?? existing.status;
    const nowClosed = CLOSED_STATUSES.includes(status);
    const updated: TriageItem = {
      ...existing,
      ...patch,
      status,
      resolutionNotes: patch.resolutionNotes
        ? scrubText(patch.resolutionNotes)
        : existing.resolutionNotes,
      // Reopening clears the resolution timestamp; the dashboard uses the
      // combination of "was resolved" and "is open" to spot regressions.
      resolvedAt: nowClosed ? existing.resolvedAt ?? nowIso() : undefined,
    };
    await this.store.put(COLLECTION, id, updated);
    await this.host.audit('security', 'beta.triage.updated', `${updated.reference} → ${updated.status}`);
    return updated;
  }

  async remove(id: string): Promise<void> {
    const existing = await this.store.get<TriageItem>(COLLECTION, id);
    await this.store.remove(COLLECTION, id);
    if (existing) await this.host.audit('security', 'beta.triage.deleted', existing.reference);
  }

  /**
   * Promotes a Phase 8 bug report into a triage item. Only the report's own
   * structured fields are carried over — nothing is inferred, and category and
   * priority are left for a human to set rather than guessed from the text.
   */
  async fromBugReport(
    report: BugReport,
    triage: { category: TriageDraft['category']; priority: FeedbackPriority; reproducibility: TriageDraft['reproducibility']; runtime: string },
  ): Promise<TriageItem> {
    return this.create({
      appVersion: report.appVersion,
      platform: report.platform,
      runtime: triage.runtime,
      featureArea: report.screen,
      category: triage.category,
      severity: report.severity,
      reproducibility: triage.reproducibility,
      description: report.stepsToReproduce,
      expectedBehavior: report.expectedBehavior,
      actualBehavior: report.actualBehavior,
      status: 'New',
      priority: triage.priority,
      noPhiConfirmed: report.noPhiConfirmed,
    });
  }
}
