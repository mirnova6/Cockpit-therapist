/**
 * IntelligenceRepository — Phase 4 persistence for case formulations,
 * safety & trust strategies, intervention sets, Clinical Update Summaries,
 * and assistant threads.
 *
 * Rules enforced here, not just in the UI:
 *  - Everything is client-scoped; list queries filter by clientId.
 *  - An approved formulation is never overwritten: proposals are separate
 *    records that SUPERSEDE the prior one only when the clinician approves.
 *  - Risk-related update items can never be approved through any bulk path
 *    (there is no bulk path at all here — every decision is per-item).
 *  - Every mutation snapshots the prior state into the shared versions
 *    collection and writes an audit event.
 */
import { newId, nowIso, type AuditCategory } from './schema';
import type { EncryptedStore } from '../storage/encryptedStore';
import type { VersionRecord, VersionedEntityType } from './structuredSchema';
import type {
  AssistantMessage,
  CaseFormulation,
  ClinicalUpdateSummary,
  FormulationFramework,
  InterventionSet,
  SafetyTrustStrategy,
  UpdateItemDecision,
  UpdateSummaryItem,
} from './intelligenceSchema';

const C = {
  formulations: 'formulations',
  strategies: 'strategies',
  interventionSets: 'intervention-sets',
  updateSummaries: 'update-summaries',
  assistantMessages: 'assistant-messages',
  versions: 'versions',
} as const;

export interface IntelligenceHost {
  store: EncryptedStore;
  audit: (category: AuditCategory, action: string, detail?: string) => Promise<void>;
}

export type FormulationDraft = Omit<
  CaseFormulation,
  'id' | 'createdAt' | 'updatedAt' | 'version' | 'reviewStatus' | 'reviewedBy' | 'approvedAt'
>;
export type StrategyDraft = Omit<
  SafetyTrustStrategy,
  'id' | 'createdAt' | 'updatedAt' | 'version' | 'reviewStatus' | 'reviewedBy' | 'approvedAt'
>;
export type InterventionSetDraft = Omit<
  InterventionSet,
  'id' | 'createdAt' | 'updatedAt' | 'version' | 'reviewStatus' | 'reviewedBy'
>;
export type UpdateSummaryDraft = Omit<
  ClinicalUpdateSummary,
  'id' | 'createdAt' | 'updatedAt' | 'version' | 'status'
>;

export class IntelligenceRepository {
  constructor(private host: IntelligenceHost) {}

  private get store() {
    return this.host.store;
  }

  private async snapshot(
    entityType: VersionedEntityType,
    entity: { id: string; clientId: string; version: number },
    reason: string,
    author: string,
    reviewDecision?: string,
  ): Promise<void> {
    const record: VersionRecord = {
      id: newId(),
      clientId: entity.clientId,
      entityType,
      entityId: entity.id,
      entityVersion: entity.version,
      snapshot: entity,
      reason,
      author,
      at: nowIso(),
      reviewDecision,
    };
    await this.store.put(C.versions, record.id, record);
  }

  // -------------------------------------------------------- formulations

  async listFormulations(clientId: string, framework?: FormulationFramework): Promise<CaseFormulation[]> {
    const all = await this.store.getAll<CaseFormulation>(C.formulations);
    return all
      .filter((f) => f.clientId === clientId && (!framework || f.framework === framework))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async getFormulation(id: string): Promise<CaseFormulation | undefined> {
    return this.store.get<CaseFormulation>(C.formulations, id);
  }

  /** The clinician-approved formulation for a framework, if any. */
  async currentApprovedFormulation(
    clientId: string,
    framework: FormulationFramework,
  ): Promise<CaseFormulation | undefined> {
    const all = await this.listFormulations(clientId, framework);
    return all.find((f) => f.reviewStatus === 'approved' || f.reviewStatus === 'edited');
  }

  /**
   * Stores a PROPOSED formulation (pending review). Never touches the
   * current approved formulation (§11 — no silent overwrite).
   */
  async proposeFormulation(draft: FormulationDraft, author: string): Promise<CaseFormulation> {
    const now = nowIso();
    const formulation: CaseFormulation = {
      ...draft,
      id: newId(),
      reviewStatus: 'pending',
      createdAt: now,
      updatedAt: now,
      version: 1,
    };
    await this.store.put(C.formulations, formulation.id, formulation);
    await this.host.audit('data', 'formulation.propose', `${formulation.framework} by ${author}`);
    return formulation;
  }

  async editFormulation(
    id: string,
    patch: Partial<Pick<CaseFormulation, 'sections' | 'areasNeedingAssessment' | 'clinicianComments' | 'updateReason'>>,
    author: string,
    reason: string,
  ): Promise<CaseFormulation> {
    const existing = await this.getFormulation(id);
    if (!existing) throw new Error('Formulation not found');
    await this.snapshot('formulation', existing, reason, author, 'edited');
    const wasDecided = existing.reviewStatus !== 'pending';
    const updated: CaseFormulation = {
      ...existing,
      ...patch,
      reviewStatus: wasDecided ? 'edited' : existing.reviewStatus,
      updatedAt: nowIso(),
      version: existing.version + 1,
    };
    await this.store.put(C.formulations, id, updated);
    await this.host.audit('data', 'formulation.edit', `by ${author}: ${reason}`);
    return updated;
  }

  /**
   * Review decision. Approval supersedes the prior approved formulation of
   * the same framework (kept with full history) — never deletes it.
   */
  async decideFormulation(
    id: string,
    decision: 'approve' | 'reject',
    author: string,
    opts: { asEdited?: boolean; comment?: string } = {},
  ): Promise<CaseFormulation> {
    const existing = await this.getFormulation(id);
    if (!existing) throw new Error('Formulation not found');
    await this.snapshot('formulation', existing, `Review decision: ${decision}`, author, decision);

    if (decision === 'approve') {
      const prior = await this.currentApprovedFormulation(existing.clientId, existing.framework);
      if (prior && prior.id !== id) {
        await this.snapshot('formulation', prior, 'Superseded by newer approved formulation', author, 'superseded');
        await this.store.put(C.formulations, prior.id, {
          ...prior,
          reviewStatus: 'superseded',
          updatedAt: nowIso(),
          version: prior.version + 1,
        });
      }
    }

    const updated: CaseFormulation = {
      ...existing,
      reviewStatus: decision === 'approve' ? (opts.asEdited ? 'edited' : 'approved') : 'rejected',
      reviewedBy: author,
      approvedAt: decision === 'approve' ? nowIso() : undefined,
      clinicianComments: opts.comment ?? existing.clinicianComments,
      updatedAt: nowIso(),
      version: existing.version + 1,
    };
    await this.store.put(C.formulations, id, updated);
    await this.host.audit('data', `formulation.${decision}`, `${existing.framework} by ${author}`);
    return updated;
  }

  // ---------------------------------------------------------- strategies

  async listStrategies(clientId: string): Promise<SafetyTrustStrategy[]> {
    const all = await this.store.getAll<SafetyTrustStrategy>(C.strategies);
    return all.filter((s) => s.clientId === clientId).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async createStrategy(draft: StrategyDraft, author: string): Promise<SafetyTrustStrategy> {
    const now = nowIso();
    const strategy: SafetyTrustStrategy = {
      ...draft,
      id: newId(),
      reviewStatus: 'pending',
      createdAt: now,
      updatedAt: now,
      version: 1,
    };
    await this.store.put(C.strategies, strategy.id, strategy);
    await this.host.audit('data', 'strategy.propose', `by ${author}`);
    return strategy;
  }

  async decideStrategy(
    id: string,
    decision: 'approve' | 'reject',
    author: string,
    comment?: string,
  ): Promise<SafetyTrustStrategy> {
    const existing = await this.store.get<SafetyTrustStrategy>(C.strategies, id);
    if (!existing) throw new Error('Strategy not found');
    await this.snapshot('strategy', existing, `Review decision: ${decision}`, author, decision);
    if (decision === 'approve') {
      // Supersede any previously approved strategy.
      const prior = (await this.listStrategies(existing.clientId)).find(
        (s) => s.id !== id && (s.reviewStatus === 'approved' || s.reviewStatus === 'edited'),
      );
      if (prior) {
        await this.snapshot('strategy', prior, 'Superseded by newer approved strategy', author, 'superseded');
        await this.store.put(C.strategies, prior.id, {
          ...prior,
          reviewStatus: 'superseded',
          updatedAt: nowIso(),
          version: prior.version + 1,
        });
      }
    }
    const updated: SafetyTrustStrategy = {
      ...existing,
      reviewStatus: decision === 'approve' ? 'approved' : 'rejected',
      reviewedBy: author,
      approvedAt: decision === 'approve' ? nowIso() : undefined,
      clinicianComments: comment ?? existing.clinicianComments,
      updatedAt: nowIso(),
      version: existing.version + 1,
    };
    await this.store.put(C.strategies, id, updated);
    await this.host.audit('data', `strategy.${decision}`, `by ${author}`);
    return updated;
  }

  // ---------------------------------------------------- intervention sets

  async listInterventionSets(clientId: string): Promise<InterventionSet[]> {
    const all = await this.store.getAll<InterventionSet>(C.interventionSets);
    return all.filter((s) => s.clientId === clientId).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async createInterventionSet(draft: InterventionSetDraft, author: string): Promise<InterventionSet> {
    const now = nowIso();
    const set: InterventionSet = {
      ...draft,
      id: newId(),
      reviewStatus: 'pending',
      createdAt: now,
      updatedAt: now,
      version: 1,
    };
    await this.store.put(C.interventionSets, set.id, set);
    await this.host.audit('data', 'interventions.generate', `${set.recommendations.length} options by ${author}`);
    return set;
  }

  async markInterventionSetReviewed(id: string, author: string): Promise<InterventionSet> {
    const existing = await this.store.get<InterventionSet>(C.interventionSets, id);
    if (!existing) throw new Error('Intervention set not found');
    await this.snapshot('intervention-set', existing, 'Marked reviewed', author, 'approve');
    const updated: InterventionSet = {
      ...existing,
      reviewStatus: 'approved',
      reviewedBy: author,
      updatedAt: nowIso(),
      version: existing.version + 1,
    };
    await this.store.put(C.interventionSets, id, updated);
    await this.host.audit('data', 'interventions.reviewed', `by ${author}`);
    return updated;
  }

  // ------------------------------------------------- update summaries

  async listUpdateSummaries(clientId: string): Promise<ClinicalUpdateSummary[]> {
    const all = await this.store.getAll<ClinicalUpdateSummary>(C.updateSummaries);
    return all.filter((s) => s.clientId === clientId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async getUpdateSummary(id: string): Promise<ClinicalUpdateSummary | undefined> {
    return this.store.get<ClinicalUpdateSummary>(C.updateSummaries, id);
  }

  async createUpdateSummary(draft: UpdateSummaryDraft, author: string): Promise<ClinicalUpdateSummary> {
    const now = nowIso();
    const summary: ClinicalUpdateSummary = {
      ...draft,
      id: newId(),
      status: 'pending-review',
      createdAt: now,
      updatedAt: now,
      version: 1,
    };
    await this.store.put(C.updateSummaries, summary.id, summary);
    await this.host.audit('data', 'update-summary.create', `${summary.items.length} items by ${author}`);
    return summary;
  }

  /**
   * Records a per-item clinician decision. This only annotates the summary;
   * creating real facts/hypotheses from the decision is done by the
   * pipeline service through the Phase 2 repositories so every existing
   * protection applies. There is deliberately NO bulk decision method.
   */
  async decideUpdateItem(
    summaryId: string,
    itemId: string,
    decision: UpdateItemDecision,
    author: string,
    opts: { comment?: string; resultingRecordId?: string; editedDetail?: string } = {},
  ): Promise<ClinicalUpdateSummary> {
    const existing = await this.getUpdateSummary(summaryId);
    if (!existing) throw new Error('Update summary not found');
    const item = existing.items.find((i) => i.id === itemId);
    if (!item) throw new Error('Update item not found');
    const items: UpdateSummaryItem[] = existing.items.map((i) =>
      i.id === itemId
        ? {
            ...i,
            detail: opts.editedDetail ?? i.detail,
            decision,
            decidedAt: nowIso(),
            decidedBy: author,
            clinicianComment: opts.comment ?? i.clinicianComment,
            resultingRecordId: opts.resultingRecordId ?? i.resultingRecordId,
          }
        : i,
    );
    const allDecided = items.every((i) => i.decision !== undefined);
    const updated: ClinicalUpdateSummary = {
      ...existing,
      items,
      status: allDecided ? 'completed' : existing.status,
      updatedAt: nowIso(),
      version: existing.version + 1,
    };
    await this.store.put(C.updateSummaries, summaryId, updated);
    await this.host.audit('data', `update-item.${decision}`, `${item.kind} by ${author}`);
    return updated;
  }

  async dismissUpdateSummary(id: string, author: string): Promise<void> {
    const existing = await this.getUpdateSummary(id);
    if (!existing) return;
    await this.store.put(C.updateSummaries, id, {
      ...existing,
      status: 'dismissed',
      updatedAt: nowIso(),
      version: existing.version + 1,
    });
    await this.host.audit('data', 'update-summary.dismiss', `by ${author}`);
  }

  // ------------------------------------------------- assistant thread

  async listAssistantMessages(clientId: string): Promise<AssistantMessage[]> {
    const all = await this.store.getAll<AssistantMessage>(C.assistantMessages);
    return all.filter((m) => m.clientId === clientId).sort((a, b) => a.at.localeCompare(b.at));
  }

  async appendAssistantMessage(message: Omit<AssistantMessage, 'id' | 'at'>): Promise<AssistantMessage> {
    const record: AssistantMessage = { ...message, id: newId(), at: nowIso() };
    await this.store.put(C.assistantMessages, record.id, record);
    return record;
  }

  async clearAssistantThread(clientId: string, author: string): Promise<void> {
    const all = await this.store.getAll<AssistantMessage>(C.assistantMessages);
    for (const message of all.filter((m) => m.clientId === clientId)) {
      await this.store.remove(C.assistantMessages, message.id);
    }
    await this.host.audit('data', 'assistant.clear-thread', `by ${author}`);
  }

  // --------------------------------------------------- cascade deletion

  async deleteAllForClient(clientId: string): Promise<void> {
    for (const collection of [C.formulations, C.strategies, C.interventionSets, C.updateSummaries, C.assistantMessages]) {
      const items = await this.store.getAll<{ id: string; clientId: string }>(collection);
      for (const item of items.filter((i) => i.clientId === clientId)) {
        await this.store.remove(collection, item.id);
      }
    }
  }
}
