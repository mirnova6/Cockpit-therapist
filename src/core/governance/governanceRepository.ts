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
import {
  PHI_GATE_SEED,
  POLICY_SEED,
  THREAT_MODEL_SEED,
  type PhiGateItem,
  type PolicyDraft,
  type ThreatModelItem,
} from './phase7Schema';
import {
  RELEASE_SEED,
  type ReleaseChecklistItem,
  type ReleaseStatus,
} from '../release/releaseSchema';

const C = {
  approvals: 'provider-approvals',
  checklist: 'readiness-checklist',
  embeddings: 'embeddings',
  threats: 'threat-model',
  policies: 'policy-drafts',
  phiGate: 'phi-readiness-gate',
  release: 'release-checklist',
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

  // ------------------------------------------------ Phase 7: threat model

  /** Returns the threat model, seeding/re-syncing new entries by key. */
  async listThreatModel(): Promise<ThreatModelItem[]> {
    const existing = await this.store.getAll<ThreatModelItem>(C.threats);
    const byKey = new Map(existing.map((t) => [t.key, t]));
    for (const seed of THREAT_MODEL_SEED) {
      if (!byKey.has(seed.key)) {
        const item: ThreatModelItem = { ...seed, id: newId(), reviewStatus: 'not-reviewed', updatedAt: nowIso() };
        await this.store.put(C.threats, item.id, item);
        byKey.set(seed.key, item);
      }
    }
    const order = new Map(THREAT_MODEL_SEED.map((s, i) => [s.key, i]));
    return [...byKey.values()].sort((a, b) => (order.get(a.key) ?? 99) - (order.get(b.key) ?? 99));
  }

  async updateThreatItem(
    id: string,
    patch: Partial<
      Pick<
        ThreatModelItem,
        'reviewStatus' | 'notes' | 'reviewer' | 'remainingRisk' | 'currentMitigation' | 'requiredActionBeforeUse'
      >
    >,
    author: string,
  ): Promise<ThreatModelItem> {
    const existing = await this.store.get<ThreatModelItem>(C.threats, id);
    if (!existing) throw new Error('Threat item not found');
    const updated: ThreatModelItem = {
      ...existing,
      ...patch,
      reviewedAt: patch.reviewStatus === 'reviewed' ? nowIso().slice(0, 10) : existing.reviewedAt,
      reviewer: patch.reviewer ?? (patch.reviewStatus === 'reviewed' ? author : existing.reviewer),
      updatedAt: nowIso(),
    };
    await this.store.put(C.threats, id, updated);
    await this.host.audit('security', 'threat-model.update', `"${existing.threat}" → ${updated.reviewStatus} by ${author}`);
    return updated;
  }

  // --------------------------------------------------- Phase 7: policies

  /** Returns policy drafts, seeding/re-syncing new templates by key. */
  async listPolicies(): Promise<PolicyDraft[]> {
    const existing = await this.store.getAll<PolicyDraft>(C.policies);
    const byKey = new Map(existing.map((p) => [p.key, p]));
    for (const seed of POLICY_SEED) {
      if (!byKey.has(seed.key)) {
        const draft: PolicyDraft = { ...seed, id: newId(), status: 'draft', version: 1, updatedAt: nowIso() };
        await this.store.put(C.policies, draft.id, draft);
        byKey.set(seed.key, draft);
      }
    }
    const order = new Map(POLICY_SEED.map((s, i) => [s.key, i]));
    return [...byKey.values()].sort((a, b) => (order.get(a.key) ?? 99) - (order.get(b.key) ?? 99));
  }

  async updatePolicy(
    id: string,
    patch: Partial<Pick<PolicyDraft, 'body' | 'status' | 'reviewer'>>,
    author: string,
  ): Promise<PolicyDraft> {
    const existing = await this.store.get<PolicyDraft>(C.policies, id);
    if (!existing) throw new Error('Policy draft not found');
    const bodyChanged = patch.body !== undefined && patch.body !== existing.body;
    const updated: PolicyDraft = {
      ...existing,
      ...patch,
      version: bodyChanged ? existing.version + 1 : existing.version,
      reviewedAt:
        patch.status === 'reviewed-by-counsel' || patch.status === 'adopted' ? nowIso().slice(0, 10) : existing.reviewedAt,
      updatedAt: nowIso(),
    };
    await this.store.put(C.policies, id, updated);
    await this.host.audit('security', 'policy.update', `"${existing.title}" → ${updated.status} by ${author}`);
    return updated;
  }

  /** Restore a policy body to its seeded template (keeps status/reviewer). */
  async resetPolicy(id: string, author: string): Promise<PolicyDraft> {
    const existing = await this.store.get<PolicyDraft>(C.policies, id);
    if (!existing) throw new Error('Policy draft not found');
    const seed = POLICY_SEED.find((s) => s.key === existing.key);
    if (!seed) return existing;
    const updated: PolicyDraft = { ...existing, body: seed.body, version: existing.version + 1, updatedAt: nowIso() };
    await this.store.put(C.policies, id, updated);
    await this.host.audit('security', 'policy.reset', `"${existing.title}" by ${author}`);
    return updated;
  }

  // ------------------------------------------------- Phase 7: PHI gate

  /** Returns the PHI readiness gate, seeding it. All items start incomplete. */
  async listPhiGate(): Promise<PhiGateItem[]> {
    const existing = await this.store.getAll<PhiGateItem>(C.phiGate);
    const byKey = new Map(existing.map((g) => [g.key, g]));
    for (const seed of PHI_GATE_SEED) {
      if (!byKey.has(seed.key)) {
        const item: PhiGateItem = {
          id: newId(),
          key: seed.key,
          label: seed.label,
          detail: seed.detail,
          requiresNamedApproval: seed.requiresNamedApproval,
          complete: false,
          updatedAt: nowIso(),
        };
        await this.store.put(C.phiGate, item.id, item);
        byKey.set(seed.key, item);
      }
    }
    const order = new Map(PHI_GATE_SEED.map((s, i) => [s.key, i]));
    return [...byKey.values()].sort((a, b) => (order.get(a.key) ?? 99) - (order.get(b.key) ?? 99));
  }

  /**
   * Set a gate item's completion. This is the ONLY way an item becomes
   * complete — an explicit manual review action carrying the reviewer's name
   * for items that require named approval. Nothing derives completion from
   * client data, so the gate cannot be bypassed by record or prompt content.
   */
  async setPhiGateItem(
    id: string,
    patch: { complete: boolean; completedBy?: string; notes?: string },
    author: string,
  ): Promise<PhiGateItem> {
    const existing = await this.store.get<PhiGateItem>(C.phiGate, id);
    if (!existing) throw new Error('Gate item not found');
    if (patch.complete && existing.requiresNamedApproval && !(patch.completedBy ?? '').trim()) {
      throw new Error('Final approval requires the named approver.');
    }
    const updated: PhiGateItem = {
      ...existing,
      complete: patch.complete,
      completedBy: patch.complete ? (patch.completedBy?.trim() || author) : undefined,
      completedAt: patch.complete ? nowIso() : undefined,
      notes: patch.notes ?? existing.notes,
      updatedAt: nowIso(),
    };
    await this.store.put(C.phiGate, id, updated);
    await this.host.audit(
      'security',
      'phi-gate.update',
      `"${existing.label}" → ${updated.complete ? 'complete' : 'incomplete'} by ${updated.completedBy ?? author}`,
    );
    return updated;
  }

  // ------------------------------------------------ Phase 8: release checklist

  async listReleaseChecklist(): Promise<ReleaseChecklistItem[]> {
    const existing = await this.store.getAll<ReleaseChecklistItem>(C.release);
    const byKey = new Map(existing.map((i) => [i.key, i]));
    for (const seed of RELEASE_SEED) {
      if (!byKey.has(seed.key)) {
        const item: ReleaseChecklistItem = { ...seed, id: newId(), status: 'not-started', updatedAt: nowIso() };
        await this.store.put(C.release, item.id, item);
        byKey.set(seed.key, item);
      }
    }
    const order = new Map(RELEASE_SEED.map((s, i) => [s.key, i]));
    return [...byKey.values()].sort((a, b) => (order.get(a.key) ?? 99) - (order.get(b.key) ?? 99));
  }

  async updateReleaseItem(
    id: string,
    patch: { status?: ReleaseStatus; notes?: string },
    author: string,
  ): Promise<ReleaseChecklistItem> {
    const existing = await this.store.get<ReleaseChecklistItem>(C.release, id);
    if (!existing) throw new Error('Release item not found');
    const updated: ReleaseChecklistItem = { ...existing, ...patch, updatedAt: nowIso() };
    await this.store.put(C.release, id, updated);
    await this.host.audit('security', 'release.update', `"${existing.label.slice(0, 50)}" → ${updated.status} by ${author}`);
    return updated;
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
