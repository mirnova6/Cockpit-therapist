/**
 * AiRepository — encrypted persistence for AI settings, the AI operations
 * log, and clinician feedback. Lives on ClinicalDatabase like the other
 * repositories; all rows ride the same AES-GCM envelope format, so backups
 * and secure deletion work unchanged.
 */
import type { EncryptedStore } from '../storage/encryptedStore';
import { newId, nowIso, type AuditCategory } from '../db/schema';
import {
  DEFAULT_AI_SETTINGS,
  type AiFeedbackRecord,
  type AiOperationRecord,
  type AiSettings,
} from './aiSchema';

const C = {
  settings: 'ai-settings',
  operations: 'ai-operations',
  feedback: 'ai-feedback',
} as const;

const SETTINGS_KEY = 'settings';

export interface AiRepositoryHost {
  store: EncryptedStore;
  audit: (category: AuditCategory, action: string, detail?: string) => Promise<void>;
}

export type OperationDraft = Omit<AiOperationRecord, 'id' | 'at'>;
export type FeedbackDraft = Omit<AiFeedbackRecord, 'id' | 'at'>;

export class AiRepository {
  constructor(private host: AiRepositoryHost) {}

  private get store() {
    return this.host.store;
  }

  // ----------------------------------------------------------- settings

  async getSettings(): Promise<AiSettings> {
    const stored = await this.store.get<AiSettings>(C.settings, SETTINGS_KEY);
    return stored ? { ...DEFAULT_AI_SETTINGS, ...stored } : { ...DEFAULT_AI_SETTINGS };
  }

  async saveSettings(patch: Partial<AiSettings>): Promise<AiSettings> {
    const current = await this.getSettings();
    const next: AiSettings = { ...current, ...patch, updatedAt: nowIso() };
    await this.store.put(C.settings, SETTINGS_KEY, next);
    // Key material never goes to the audit log — only which fields changed.
    await this.host.audit('security', 'ai.settings-updated', Object.keys(patch).join(','));
    return next;
  }

  // ------------------------------------------------------ operations log

  async logOperation(draft: OperationDraft): Promise<AiOperationRecord> {
    const record: AiOperationRecord = { ...draft, id: newId(), at: nowIso() };
    await this.store.put(C.operations, record.id, record);
    await this.host.audit(
      'security',
      `ai.operation.${record.status}`,
      `${record.capability} via ${record.providerId} (${record.mode}${record.phiLeftDevice ? ', PHI left device' : ''})`,
    );
    return record;
  }

  async listOperations(clientId?: string, limit = 100): Promise<AiOperationRecord[]> {
    const all = await this.store.getAll<AiOperationRecord>(C.operations);
    return all
      .filter((op) => !clientId || op.clientId === clientId)
      .sort((a, b) => b.at.localeCompare(a.at))
      .slice(0, limit);
  }

  // ------------------------------------------------------------ feedback

  async addFeedback(draft: FeedbackDraft): Promise<AiFeedbackRecord> {
    const record: AiFeedbackRecord = { ...draft, id: newId(), at: nowIso() };
    await this.store.put(C.feedback, record.id, record);
    await this.host.audit('data', 'ai.feedback', `${record.targetType} · ${record.labels.join(',')}`);
    return record;
  }

  async listFeedback(clientId: string, targetId?: string): Promise<AiFeedbackRecord[]> {
    const all = await this.store.getAll<AiFeedbackRecord>(C.feedback);
    return all
      .filter((f) => f.clientId === clientId && (!targetId || f.targetId === targetId))
      .sort((a, b) => b.at.localeCompare(a.at));
  }

  /**
   * Phase 5 evaluation export hook: feedback plus operation metadata for a
   * single client (or all), with NO clinical plaintext beyond the
   * clinician's own feedback comments. Not wired to any automatic
   * training — export happens only when the clinician invokes it.
   */
  async exportEvaluationData(clientId?: string): Promise<{
    format: 'cockpit-ai-evaluation';
    version: 1;
    exportedAt: string;
    feedback: AiFeedbackRecord[];
    operations: AiOperationRecord[];
  }> {
    const [feedback, operations] = await Promise.all([
      this.store.getAll<AiFeedbackRecord>(C.feedback),
      this.store.getAll<AiOperationRecord>(C.operations),
    ]);
    await this.host.audit('security', 'ai.evaluation-export', clientId ?? 'all clients');
    return {
      format: 'cockpit-ai-evaluation',
      version: 1,
      exportedAt: nowIso(),
      feedback: feedback.filter((f) => !clientId || f.clientId === clientId),
      operations: operations.filter((o) => !clientId || o.clientId === clientId),
    };
  }

  // --------------------------------------------------- cascade deletion

  async deleteAllForClient(clientId: string): Promise<void> {
    for (const collection of [C.operations, C.feedback]) {
      const items = await this.store.getAll<{ id: string; clientId?: string }>(collection);
      for (const item of items.filter((i) => i.clientId === clientId)) {
        await this.store.remove(collection, item.id);
      }
    }
  }
}
