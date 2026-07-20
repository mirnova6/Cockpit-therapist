/**
 * GovernanceRepository — provider approval registry, readiness checklist,
 * and client-namespaced embedding storage (all encrypted at rest).
 */
import { newId, nowIso, type AuditCategory } from '../db/schema';
import type { EncryptedStore } from '../storage/encryptedStore';
import {
  CHECKLIST_SEED,
  type ChecklistItem,
  type ChecklistStatus,
  type EmbeddingRecord,
  type ProviderApproval,
} from './governanceSchema';

const C = {
  approvals: 'provider-approvals',
  checklist: 'readiness-checklist',
  embeddings: 'embeddings',
} as const;

export interface GovernanceHost {
  store: EncryptedStore;
  audit: (category: AuditCategory, action: string, detail?: string) => Promise<void>;
}

export type ApprovalDraft = Omit<ProviderApproval, 'id' | 'createdAt' | 'updatedAt' | 'version'>;

export class GovernanceRepository {
  constructor(private host: GovernanceHost) {}

  private get store() {
    return this.host.store;
  }

  // ------------------------------------------------- provider approvals

  async listApprovals(): Promise<ProviderApproval[]> {
    const all = await this.store.getAll<ProviderApproval>(C.approvals);
    return all.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  /** The effective approval entry for a provider id, if one exists. */
  async approvalFor(providerId: string): Promise<ProviderApproval | undefined> {
    return (await this.listApprovals()).find((a) => a.providerId === providerId);
  }

  async saveApproval(draft: ApprovalDraft & { id?: string }, author: string): Promise<ProviderApproval> {
    const now = nowIso();
    const existing = draft.id ? await this.store.get<ProviderApproval>(C.approvals, draft.id) : undefined;
    const record: ProviderApproval = {
      ...draft,
      id: existing?.id ?? newId(),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      version: (existing?.version ?? 0) + 1,
    };
    await this.store.put(C.approvals, record.id, record);
    // Approval changes are security events (never include key material).
    await this.host.audit(
      'security',
      'provider-approval.save',
      `${record.providerName} (${record.providerId}) → ${record.approvalStatus}, BAA ${record.baaStatus} by ${author}`,
    );
    return record;
  }

  async deleteApproval(id: string, author: string): Promise<void> {
    const existing = await this.store.get<ProviderApproval>(C.approvals, id);
    if (!existing) return;
    await this.store.remove(C.approvals, id);
    await this.host.audit('security', 'provider-approval.delete', `${existing.providerName} by ${author}`);
  }

  // ---------------------------------------------------------- checklist

  /** Returns the checklist, seeding it on first access. */
  async listChecklist(): Promise<ChecklistItem[]> {
    const existing = await this.store.getAll<ChecklistItem>(C.checklist);
    if (existing.length > 0) {
      return existing.sort((a, b) => a.category.localeCompare(b.category) || a.item.localeCompare(b.item));
    }
    const seeded: ChecklistItem[] = [];
    for (const group of CHECKLIST_SEED) {
      for (const entry of group.items) {
        const item: ChecklistItem = {
          id: newId(),
          category: group.category,
          item: entry.item,
          status: 'not-started',
          evidence: entry.evidence,
          updatedAt: nowIso(),
        };
        await this.store.put(C.checklist, item.id, item);
        seeded.push(item);
      }
    }
    return seeded;
  }

  async updateChecklistItem(
    id: string,
    patch: Partial<Pick<ChecklistItem, 'status' | 'notes' | 'evidence' | 'reviewer' | 'nextReviewDate'>>,
    author: string,
  ): Promise<ChecklistItem> {
    const existing = await this.store.get<ChecklistItem>(C.checklist, id);
    if (!existing) throw new Error('Checklist item not found');
    const updated: ChecklistItem = {
      ...existing,
      ...patch,
      dateReviewed: patch.status === 'reviewed' ? nowIso().slice(0, 10) : existing.dateReviewed,
      reviewer: patch.reviewer ?? (patch.status === 'reviewed' ? author : existing.reviewer),
      updatedAt: nowIso(),
    };
    await this.store.put(C.checklist, id, updated);
    await this.host.audit('security', 'readiness.update', `"${existing.item.slice(0, 60)}" → ${updated.status} by ${author}`);
    return updated;
  }

  async checklistSummary(): Promise<{ total: number; byStatus: Record<ChecklistStatus, number> }> {
    const items = await this.listChecklist();
    const byStatus: Record<ChecklistStatus, number> = {
      'not-started': 0,
      'in-progress': 0,
      'ready-for-review': 0,
      'reviewed': 0,
      'blocked': 0,
    };
    for (const item of items) byStatus[item.status]++;
    return { total: items.length, byStatus };
  }

  // --------------------------------------------------------- embeddings

  async putEmbedding(record: Omit<EmbeddingRecord, 'id' | 'createdAt'>): Promise<EmbeddingRecord> {
    const full: EmbeddingRecord = { ...record, id: newId(), createdAt: nowIso() };
    await this.store.put(C.embeddings, full.id, full);
    return full;
  }

  /** Namespace read: only ever the given client's embeddings. */
  async listEmbeddings(clientId: string): Promise<EmbeddingRecord[]> {
    const all = await this.store.getAll<EmbeddingRecord>(C.embeddings);
    return all.filter((e) => e.clientId === clientId);
  }

  async countEmbeddings(clientId?: string): Promise<number> {
    const all = await this.store.getAll<EmbeddingRecord>(C.embeddings);
    return all.filter((e) => !clientId || e.clientId === clientId).length;
  }

  /** Secure per-client deletion (also called from client cascade delete). */
  async deleteEmbeddingsForClient(clientId: string): Promise<number> {
    const mine = await this.listEmbeddings(clientId);
    for (const record of mine) await this.store.remove(C.embeddings, record.id);
    if (mine.length > 0) {
      await this.host.audit('security', 'embeddings.delete', `${mine.length} vector(s) for client ${clientId}`);
    }
    return mine.length;
  }

  // --------------------------------------------------- cascade deletion

  async deleteAllForClient(clientId: string): Promise<void> {
    await this.deleteEmbeddingsForClient(clientId);
  }
}
