/**
 * DocumentsRepository — Phase 3 data layer for DAP notes, treatment plans,
 * and treatment goals.
 *
 * Rules enforced here (not just in the UI):
 *  - Approval is blocked while any risk-related segment/problem/need is
 *    unacknowledged — there is no bulk path around it.
 *  - The original generated draft is immutable; edits bump versions and
 *    snapshot the prior state.
 *  - Approving a new treatment plan supersedes the previously approved one
 *    (never silently overwrites it).
 *  - All entities are client-scoped; deletion cascades.
 */
import type { EncryptedStore } from '../storage/encryptedStore';
import {
  APPROVED_DOC_STATUSES,
  type DapNote,
  type DocReviewStatus,
  type Objective,
  type TreatmentGoal,
  type TreatmentPlanDoc,
} from './documentSchema';
import { newId, nowIso, type AuditCategory } from './schema';
import type { VersionRecord } from './structuredSchema';

const C = {
  dapNotes: 'dap-notes',
  plans: 'treatment-plans',
  goals: 'goals',
  versions: 'versions', // shared with Phase 2 version history
} as const;

export interface DocumentsHost {
  store: EncryptedStore;
  audit: (category: AuditCategory, action: string, detail?: string) => Promise<void>;
}

export type GoalDraft = Omit<TreatmentGoal, 'id' | 'createdAt' | 'updatedAt' | 'version' | 'order'> & {
  order?: number;
};

function unacknowledgedRisk(items: Array<{ riskRelated: boolean; riskAcknowledged?: boolean }>): number {
  return items.filter((i) => i.riskRelated && !i.riskAcknowledged).length;
}

/**
 * Strips review-workflow fields so risk acknowledgments don't count as
 * content edits when deciding between "approved" and "edited & approved".
 */
function contentOnly<T extends { riskAcknowledged?: boolean; riskNote?: string }>(items: T[]): unknown[] {
  return items.map(({ riskAcknowledged: _ack, riskNote: _note, ...rest }) => rest);
}

export class DocumentsRepository {
  constructor(private host: DocumentsHost) {}

  private get store() {
    return this.host.store;
  }

  private async snapshot(
    entityType: 'dap-note' | 'treatment-plan' | 'goal',
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

  // ------------------------------------------------------------ DAP notes

  async listDapNotes(clientId: string): Promise<DapNote[]> {
    const all = await this.store.getAll<DapNote>(C.dapNotes);
    return all
      .filter((n) => n.clientId === clientId)
      .sort((a, b) => b.sessionDate.localeCompare(a.sessionDate) || b.createdAt.localeCompare(a.createdAt));
  }

  async getDapNote(id: string): Promise<DapNote | undefined> {
    return this.store.get<DapNote>(C.dapNotes, id);
  }

  async createDapNote(
    draft: Omit<DapNote, 'id' | 'createdAt' | 'updatedAt' | 'version' | 'reviewStatus' | 'originalSegments'>,
    author: string,
  ): Promise<DapNote> {
    const now = nowIso();
    const note: DapNote = {
      ...draft,
      id: newId(),
      originalSegments: structuredClone(draft.segments),
      reviewStatus: 'draft',
      createdAt: now,
      updatedAt: now,
      version: 1,
    };
    await this.store.put(C.dapNotes, note.id, note);
    await this.host.audit('data', 'dap.create', `${note.generation.method} by ${author}`);
    return note;
  }

  async updateDapNote(
    id: string,
    patch: Partial<Pick<DapNote, 'segments' | 'sessionDate' | 'sessionNumber' | 'style' | 'clinicianComments' | 'levelOfCare'>>,
    author: string,
    reason: string,
  ): Promise<DapNote> {
    const existing = await this.getDapNote(id);
    if (!existing) throw new Error('DAP note not found');
    if (existing.reviewStatus === 'rejected' || existing.reviewStatus === 'superseded') {
      throw new Error('Rejected or superseded notes cannot be edited.');
    }
    await this.snapshot('dap-note', existing, reason, author, 'edited');
    const wasApproved = APPROVED_DOC_STATUSES.includes(existing.reviewStatus);
    const updated: DapNote = {
      ...existing,
      ...patch,
      // Editing an approved note reopens review — it must be re-approved.
      reviewStatus: wasApproved ? 'pending-review' : existing.reviewStatus,
      updatedAt: nowIso(),
      version: existing.version + 1,
    };
    await this.store.put(C.dapNotes, id, updated);
    await this.host.audit('data', 'dap.edit', `by ${author}: ${reason}`);
    return updated;
  }

  async decideDapNote(
    id: string,
    decision: 'approve' | 'reject' | 'archive' | 'supersede' | 'submit-for-review' | 'needs-more-info',
    author: string,
    comment?: string,
  ): Promise<DapNote> {
    const existing = await this.getDapNote(id);
    if (!existing) throw new Error('DAP note not found');

    if (decision === 'approve') {
      const pendingRisk = unacknowledgedRisk(existing.segments);
      if (pendingRisk > 0) {
        throw new Error(
          `${pendingRisk} risk-related segment(s) require individual clinician confirmation before this note can be approved.`,
        );
      }
    }

    await this.snapshot('dap-note', existing, `Review decision: ${decision}`, author, decision);
    const edited =
      JSON.stringify(contentOnly(existing.segments)) !==
      JSON.stringify(contentOnly(existing.originalSegments));
    const statusMap: Record<typeof decision, DocReviewStatus> = {
      'approve': edited ? 'edited' : 'approved',
      'reject': 'rejected',
      'archive': 'archived',
      'supersede': 'superseded',
      'submit-for-review': 'pending-review',
      'needs-more-info': 'draft',
    };
    const updated: DapNote = {
      ...existing,
      reviewStatus: statusMap[decision],
      clinicianComments: comment ?? existing.clinicianComments,
      reviewedBy: decision === 'approve' ? author : existing.reviewedBy,
      approvedAt: decision === 'approve' ? nowIso() : existing.approvedAt,
      updatedAt: nowIso(),
      version: existing.version + 1,
    };
    await this.store.put(C.dapNotes, id, updated);
    await this.host.audit('data', `dap.${decision}`, `by ${author}`);
    return updated;
  }

  async acknowledgeDapRisk(
    id: string,
    segmentId: string,
    author: string,
    note?: string,
  ): Promise<DapNote> {
    const existing = await this.getDapNote(id);
    if (!existing) throw new Error('DAP note not found');
    const segments = existing.segments.map((s) =>
      s.id === segmentId ? { ...s, riskAcknowledged: true, riskNote: note ?? s.riskNote } : s,
    );
    const updated: DapNote = { ...existing, segments, updatedAt: nowIso() };
    await this.store.put(C.dapNotes, id, updated);
    await this.host.audit('data', 'dap.risk-acknowledged', `segment by ${author}`);
    return updated;
  }

  async deleteDapNote(id: string, author: string): Promise<void> {
    await this.store.remove(C.dapNotes, id);
    await this.host.audit('data', 'dap.delete', `by ${author}`);
  }

  // ------------------------------------------------------ treatment plans

  async listPlans(clientId: string): Promise<TreatmentPlanDoc[]> {
    const all = await this.store.getAll<TreatmentPlanDoc>(C.plans);
    return all
      .filter((p) => p.clientId === clientId)
      .sort((a, b) => b.planDate.localeCompare(a.planDate) || b.createdAt.localeCompare(a.createdAt));
  }

  async getPlan(id: string): Promise<TreatmentPlanDoc | undefined> {
    return this.store.get<TreatmentPlanDoc>(C.plans, id);
  }

  async createPlan(
    draft: Omit<TreatmentPlanDoc, 'id' | 'createdAt' | 'updatedAt' | 'version' | 'reviewStatus' | 'originalDraft'>,
    author: string,
  ): Promise<TreatmentPlanDoc> {
    const now = nowIso();
    const plan: TreatmentPlanDoc = {
      ...draft,
      id: newId(),
      originalDraft: structuredClone({
        problems: draft.problems,
        segments: draft.segments,
        hierarchy: draft.hierarchy,
        goalPlanRationale: draft.goalPlanRationale,
        expectedImprovement: draft.expectedImprovement,
        proposedObjectives: draft.proposedObjectives,
      }),
      reviewStatus: 'draft',
      createdAt: now,
      updatedAt: now,
      version: 1,
    };
    await this.store.put(C.plans, plan.id, plan);
    await this.host.audit('data', 'plan.create', `${plan.generation.method} by ${author}`);
    return plan;
  }

  async updatePlan(
    id: string,
    patch: Partial<
      Pick<
        TreatmentPlanDoc,
        | 'problems'
        | 'segments'
        | 'hierarchy'
        | 'goalIds'
        | 'goalPlanRationale'
        | 'expectedImprovement'
        | 'proposedObjectives'
        | 'reviewDate'
        | 'clinicianComments'
      >
    >,
    author: string,
    reason: string,
  ): Promise<TreatmentPlanDoc> {
    const existing = await this.getPlan(id);
    if (!existing) throw new Error('Treatment plan not found');
    if (existing.reviewStatus === 'rejected' || existing.reviewStatus === 'superseded') {
      throw new Error('Rejected or superseded plans cannot be edited.');
    }
    await this.snapshot('treatment-plan', existing, reason, author, 'edited');
    const wasApproved = APPROVED_DOC_STATUSES.includes(existing.reviewStatus);
    const updated: TreatmentPlanDoc = {
      ...existing,
      ...patch,
      reviewStatus: wasApproved ? 'pending-review' : existing.reviewStatus,
      updatedAt: nowIso(),
      version: existing.version + 1,
    };
    await this.store.put(C.plans, id, updated);
    await this.host.audit('data', 'plan.edit', `by ${author}: ${reason}`);
    return updated;
  }

  async acknowledgePlanRisk(
    id: string,
    itemId: string,
    author: string,
    note?: string,
  ): Promise<TreatmentPlanDoc> {
    const existing = await this.getPlan(id);
    if (!existing) throw new Error('Treatment plan not found');
    const ack = <T extends { id: string; riskRelated: boolean; riskAcknowledged?: boolean; riskNote?: string }>(items: T[]): T[] =>
      items.map((i) => (i.id === itemId ? { ...i, riskAcknowledged: true, riskNote: note ?? i.riskNote } : i));
    const updated: TreatmentPlanDoc = {
      ...existing,
      problems: ack(existing.problems),
      hierarchy: ack(existing.hierarchy),
      segments: existing.segments.map((s) =>
        s.id === itemId ? { ...s, riskAcknowledged: true, riskNote: note ?? s.riskNote } : s,
      ),
      updatedAt: nowIso(),
    };
    await this.store.put(C.plans, id, updated);
    await this.host.audit('data', 'plan.risk-acknowledged', `item by ${author}`);
    return updated;
  }

  async decidePlan(
    id: string,
    decision: 'approve' | 'reject' | 'archive' | 'supersede' | 'submit-for-review' | 'needs-more-info',
    author: string,
    comment?: string,
  ): Promise<TreatmentPlanDoc> {
    const existing = await this.getPlan(id);
    if (!existing) throw new Error('Treatment plan not found');

    if (decision === 'approve') {
      const pendingRisk =
        unacknowledgedRisk(existing.segments) +
        unacknowledgedRisk(existing.problems) +
        unacknowledgedRisk(existing.hierarchy);
      if (pendingRisk > 0) {
        throw new Error(
          `${pendingRisk} risk-related item(s) require individual clinician confirmation before this plan can be approved.`,
        );
      }
    }

    await this.snapshot('treatment-plan', existing, `Review decision: ${decision}`, author, decision);
    const edited =
      JSON.stringify({
        problems: contentOnly(existing.problems),
        segments: contentOnly(existing.segments),
        hierarchy: contentOnly(existing.hierarchy),
        goalPlanRationale: existing.goalPlanRationale,
        expectedImprovement: existing.expectedImprovement,
        proposedObjectives: existing.proposedObjectives,
      }) !==
      JSON.stringify({
        problems: contentOnly(existing.originalDraft.problems),
        segments: contentOnly(existing.originalDraft.segments),
        hierarchy: contentOnly(existing.originalDraft.hierarchy),
        goalPlanRationale: existing.originalDraft.goalPlanRationale,
        expectedImprovement: existing.originalDraft.expectedImprovement,
        proposedObjectives: existing.originalDraft.proposedObjectives,
      });
    const statusMap: Record<typeof decision, DocReviewStatus> = {
      'approve': edited ? 'edited' : 'approved',
      'reject': 'rejected',
      'archive': 'archived',
      'supersede': 'superseded',
      'submit-for-review': 'pending-review',
      'needs-more-info': 'draft',
    };

    let goalsSnapshot = existing.goalsSnapshot;
    if (decision === 'approve') {
      const goals = await this.listGoals(existing.clientId);
      goalsSnapshot = structuredClone(goals.filter((g) => existing.goalIds.includes(g.id)));
    }

    const updated: TreatmentPlanDoc = {
      ...existing,
      reviewStatus: statusMap[decision],
      clinicianComments: comment ?? existing.clinicianComments,
      reviewedBy: decision === 'approve' ? author : existing.reviewedBy,
      approvedAt: decision === 'approve' ? nowIso() : existing.approvedAt,
      goalsSnapshot,
      updatedAt: nowIso(),
      version: existing.version + 1,
    };
    await this.store.put(C.plans, id, updated);

    // A newly approved plan supersedes the previously approved plan.
    if (decision === 'approve') {
      const others = (await this.listPlans(existing.clientId)).filter(
        (p) => p.id !== id && APPROVED_DOC_STATUSES.includes(p.reviewStatus),
      );
      for (const other of others) {
        await this.snapshot('treatment-plan', other, 'Superseded by newly approved plan', author, 'supersede');
        await this.store.put(C.plans, other.id, {
          ...other,
          reviewStatus: 'superseded' as const,
          supersededBy: id,
          updatedAt: nowIso(),
          version: other.version + 1,
        });
      }
    }

    await this.host.audit('data', `plan.${decision}`, `by ${author}`);
    return updated;
  }

  async deletePlan(id: string, author: string): Promise<void> {
    await this.store.remove(C.plans, id);
    await this.host.audit('data', 'plan.delete', `by ${author}`);
  }

  // ---------------------------------------------------------------- goals

  async listGoals(clientId: string): Promise<TreatmentGoal[]> {
    const all = await this.store.getAll<TreatmentGoal>(C.goals);
    return all.filter((g) => g.clientId === clientId).sort((a, b) => a.order - b.order);
  }

  async getGoal(id: string): Promise<TreatmentGoal | undefined> {
    return this.store.get<TreatmentGoal>(C.goals, id);
  }

  async createGoal(draft: GoalDraft, author: string): Promise<TreatmentGoal> {
    const now = nowIso();
    const existing = await this.listGoals(draft.clientId);
    const goal: TreatmentGoal = {
      ...draft,
      id: newId(),
      order: draft.order ?? existing.length,
      createdAt: now,
      updatedAt: now,
      version: 1,
    };
    await this.store.put(C.goals, goal.id, goal);
    await this.host.audit('data', 'goal.create', `by ${author}`);
    return goal;
  }

  async updateGoal(
    id: string,
    patch: Partial<Pick<TreatmentGoal, 'title' | 'rationale' | 'kind' | 'status' | 'objectives' | 'order'>>,
    author: string,
    reason: string,
  ): Promise<TreatmentGoal> {
    const existing = await this.getGoal(id);
    if (!existing) throw new Error('Goal not found');
    await this.snapshot('goal', existing, reason, author);
    const updated: TreatmentGoal = {
      ...existing,
      ...patch,
      updatedAt: nowIso(),
      version: existing.version + 1,
    };
    await this.store.put(C.goals, id, updated);
    await this.host.audit('data', 'goal.edit', `by ${author}: ${reason}`);
    return updated;
  }

  async addObjectiveProgressNote(
    goalId: string,
    objectiveId: string,
    note: string,
    author: string,
  ): Promise<TreatmentGoal> {
    const existing = await this.getGoal(goalId);
    if (!existing) throw new Error('Goal not found');
    const objectives: Objective[] = existing.objectives.map((o) =>
      o.id === objectiveId
        ? { ...o, progressNotes: [...o.progressNotes, { at: nowIso(), note, author }] }
        : o,
    );
    return this.updateGoal(goalId, { objectives }, author, 'Progress note added');
  }

  async duplicateGoal(id: string, author: string): Promise<TreatmentGoal> {
    const existing = await this.getGoal(id);
    if (!existing) throw new Error('Goal not found');
    return this.createGoal(
      {
        clientId: existing.clientId,
        kind: existing.kind,
        title: `${existing.title} (copy)`,
        rationale: existing.rationale,
        status: 'active',
        objectives: existing.objectives.map((o) => ({
          ...o,
          id: newId(),
          progress: 'not-started' as const,
          progressNotes: [],
        })),
      },
      author,
    );
  }

  async reorderGoal(id: string, direction: 'up' | 'down', author: string): Promise<void> {
    const goal = await this.getGoal(id);
    if (!goal) return;
    const siblings = await this.listGoals(goal.clientId);
    const index = siblings.findIndex((g) => g.id === id);
    const swapWith = direction === 'up' ? index - 1 : index + 1;
    if (swapWith < 0 || swapWith >= siblings.length) return;
    const other = siblings[swapWith];
    await this.store.put(C.goals, goal.id, { ...goal, order: other.order, updatedAt: nowIso() });
    await this.store.put(C.goals, other.id, { ...other, order: goal.order, updatedAt: nowIso() });
    await this.host.audit('data', 'goal.reorder', `by ${author}`);
  }

  async deleteGoal(id: string, author: string): Promise<void> {
    await this.store.remove(C.goals, id);
    await this.host.audit('data', 'goal.delete', `by ${author}`);
  }

  // ------------------------------------------------------------ cascade

  async deleteAllForClient(clientId: string): Promise<void> {
    for (const collection of [C.dapNotes, C.plans, C.goals]) {
      const items = await this.store.getAll<{ id: string; clientId: string }>(collection);
      for (const item of items.filter((i) => i.clientId === clientId)) {
        await this.store.remove(collection, item.id);
      }
    }
  }
}
