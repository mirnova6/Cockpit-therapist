/**
 * StructuredRepository — Phase 2 data layer.
 *
 * Rules enforced here (not just in the UI):
 *  - Every entity belongs to exactly one client; list queries filter by clientId.
 *  - Evidence links are validated so the link, its target, and its source
 *    input all belong to the same client.
 *  - Every mutation snapshots the previous state into the versions collection.
 *  - Risk-related items can never pass through bulk approval.
 *  - Every review decision is written to the audit log.
 */
import { computeRiskFlags, interpretRecord } from '../assessments/definitions';
import type { EncryptedStore } from '../storage/encryptedStore';
import { newId, nowIso, type AuditCategory } from './schema';
import {
  APPROVED_STATUSES,
  bulkApprovalIneligibilityReason,
  type AssessmentRecord,
  type ClinicalHypothesis,
  type Contradiction,
  type ContradictionResolution,
  type EvidenceLink,
  type ExtractedFact,
  type GapStatus,
  type NeedsAssessmentItem,
  type ReviewStatus,
  type VersionRecord,
  type VersionedEntityType,
} from './structuredSchema';

const C = {
  facts: 'facts',
  assessments: 'assessments',
  hypotheses: 'hypotheses',
  evidence: 'evidence',
  contradictions: 'contradictions',
  gaps: 'gaps',
  versions: 'versions',
} as const;

export interface RepositoryHost {
  store: EncryptedStore;
  audit: (category: AuditCategory, action: string, detail?: string) => Promise<void>;
  getInputMeta: (id: string) => Promise<{ clientId: string; version: number } | undefined>;
}

export type FactDraft = Omit<
  ExtractedFact,
  'id' | 'createdAt' | 'updatedAt' | 'version' | 'reviewStatus'
> & { reviewStatus?: ReviewStatus };

export type AssessmentDraft = Omit<
  AssessmentRecord,
  'id' | 'createdAt' | 'updatedAt' | 'version' | 'severityInterpretation' | 'riskFlags' | 'reviewStatus'
> & { reviewStatus?: ReviewStatus };

export type HypothesisDraft = Omit<
  ClinicalHypothesis,
  'id' | 'createdAt' | 'updatedAt' | 'version' | 'reviewStatus' | 'lifecycleStatus'
>;

export type EvidenceDraft = Omit<
  EvidenceLink,
  'id' | 'createdAt' | 'reviewStatus' | 'sourceInputVersion'
> & { reviewStatus?: ReviewStatus };

export type ContradictionDraft = Omit<
  Contradiction,
  'id' | 'createdAt' | 'updatedAt' | 'version' | 'resolutionStatus' | 'dateResolved'
>;

export type GapDraft = Omit<NeedsAssessmentItem, 'id' | 'createdAt' | 'updatedAt' | 'version' | 'status'>;

export type FactDecision = 'approve' | 'reject' | 'needs-clarification' | 'supersede';

export interface QueueItem {
  kind: 'fact' | 'assessment' | 'hypothesis' | 'evidence' | 'contradiction' | 'gap';
  id: string;
  clientId: string;
  title: string;
  detail: string;
  date: string;
  riskRelated: boolean;
  extractionMethod?: string;
  /** True only for facts that pass the bulk-approval policy. */
  bulkEligible: boolean;
  /** Why the item is excluded from bulk approval, when it is. */
  individualReviewReason?: string;
}

export class StructuredRepository {
  constructor(private host: RepositoryHost) {}

  private get store() {
    return this.host.store;
  }

  // ----------------------------------------------------------- versions

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

  async listVersions(
    clientId: string,
    entityType?: VersionedEntityType,
    entityId?: string,
  ): Promise<VersionRecord[]> {
    const all = await this.store.getAll<VersionRecord>(C.versions);
    return all
      .filter(
        (v) =>
          v.clientId === clientId &&
          (!entityType || v.entityType === entityType) &&
          (!entityId || v.entityId === entityId),
      )
      .sort((a, b) => b.at.localeCompare(a.at));
  }

  // -------------------------------------------------------------- facts

  async listFacts(clientId: string): Promise<ExtractedFact[]> {
    const all = await this.store.getAll<ExtractedFact>(C.facts);
    return all
      .filter((f) => f.clientId === clientId)
      .sort((a, b) => b.dateRecorded.localeCompare(a.dateRecorded));
  }

  async getFact(id: string): Promise<ExtractedFact | undefined> {
    return this.store.get<ExtractedFact>(C.facts, id);
  }

  async createFact(draft: FactDraft, author: string): Promise<ExtractedFact> {
    const now = nowIso();
    const fact: ExtractedFact = {
      ...draft,
      id: newId(),
      reviewStatus: draft.reviewStatus ?? 'pending',
      createdAt: now,
      updatedAt: now,
      version: 1,
    };
    await this.store.put(C.facts, fact.id, fact);
    await this.host.audit('data', 'fact.create', `${fact.extractionMethod} by ${author}`);
    return fact;
  }

  async editFact(
    id: string,
    patch: Partial<Pick<ExtractedFact, 'statement' | 'category' | 'classification' | 'temporalStatus' | 'dateOccurred' | 'clinicianCorrection' | 'riskRelated' | 'excerpt'>>,
    author: string,
    reason: string,
  ): Promise<ExtractedFact> {
    const existing = await this.getFact(id);
    if (!existing) throw new Error('Fact not found');
    await this.snapshot('fact', existing, reason, author, 'edited');
    const wasDecided = existing.reviewStatus !== 'pending';
    const updated: ExtractedFact = {
      ...existing,
      ...patch,
      reviewStatus: wasDecided ? 'edited' : existing.reviewStatus,
      updatedAt: nowIso(),
      version: existing.version + 1,
    };
    await this.store.put(C.facts, id, updated);
    await this.host.audit('data', 'fact.edit', `by ${author}: ${reason}`);
    return updated;
  }

  async decideFact(
    id: string,
    decision: FactDecision,
    author: string,
    opts: { correction?: string; note?: string; asEdited?: boolean } = {},
  ): Promise<ExtractedFact> {
    const existing = await this.getFact(id);
    if (!existing) throw new Error('Fact not found');
    await this.snapshot('fact', existing, `Review decision: ${decision}`, author, decision);
    const statusMap: Record<FactDecision, ReviewStatus> = {
      'approve': opts.asEdited ? 'edited' : 'approved',
      'reject': 'rejected',
      'needs-clarification': 'needs-clarification',
      'supersede': 'superseded',
    };
    const updated: ExtractedFact = {
      ...existing,
      reviewStatus: statusMap[decision],
      clinicianCorrection: opts.correction ?? existing.clinicianCorrection,
      updatedAt: nowIso(),
      version: existing.version + 1,
    };
    await this.store.put(C.facts, id, updated);
    await this.host.audit('data', `fact.${decision}`, `by ${author}${opts.note ? `: ${opts.note}` : ''}`);

    // Approved facts retain a reviewable source link in the evidence panel.
    if (APPROVED_STATUSES.includes(updated.reviewStatus) && updated.excerpt) {
      await this.createEvidenceLink(
        {
          clientId: updated.clientId,
          targetType: 'fact',
          targetId: updated.id,
          sourceInputId: updated.sourceInputId,
          excerpt: updated.excerpt,
          sourceLocation: updated.sourceLocation,
          dateOfSource: updated.dateOccurred ?? updated.dateRecorded,
          relationship: 'supports',
          strength: updated.extractionConfidence === 'high' ? 'strong' : 'moderate',
          reviewStatus: updated.reviewStatus,
        },
        author,
      );
    }
    return updated;
  }

  async markFactHistorical(id: string, author: string): Promise<ExtractedFact> {
    const existing = await this.getFact(id);
    if (!existing) throw new Error('Fact not found');
    await this.snapshot('fact', existing, 'Marked historical', author, 'historical');
    const updated: ExtractedFact = {
      ...existing,
      temporalStatus: 'historical',
      updatedAt: nowIso(),
      version: existing.version + 1,
    };
    await this.store.put(C.facts, id, updated);
    await this.host.audit('data', 'fact.mark-historical', `by ${author}`);
    return updated;
  }

  /**
   * Bulk approval for ELIGIBLE low-risk factual items only, enforced here
   * regardless of what the UI sends. Ineligible facts — anything
   * risk-related, medication records, diagnoses, risk factors,
   * withdrawal content, or items awaiting clarification — are skipped
   * with a reason so the UI can route them to individual review.
   * Assessments are never bulk-approvable through any path.
   */
  async bulkApproveFacts(
    ids: string[],
    author: string,
  ): Promise<{ approved: string[]; skipped: Array<{ id: string; reason: string }> }> {
    const approved: string[] = [];
    const skipped: Array<{ id: string; reason: string }> = [];
    for (const id of ids) {
      const fact = await this.getFact(id);
      if (!fact) {
        skipped.push({ id, reason: 'Fact not found' });
        continue;
      }
      const reason = bulkApprovalIneligibilityReason(fact);
      if (reason) {
        skipped.push({ id, reason });
        continue;
      }
      await this.decideFact(id, 'approve', author, { note: 'bulk approval' });
      approved.push(id);
    }
    await this.host.audit(
      'data',
      'fact.bulk-approve',
      `by ${author}: ${approved.length} approved, ${skipped.length} skipped as ineligible`,
    );
    return { approved, skipped };
  }

  // -------------------------------------------------------- assessments

  async listAssessments(clientId: string): Promise<AssessmentRecord[]> {
    const all = await this.store.getAll<AssessmentRecord>(C.assessments);
    return all
      .filter((a) => a.clientId === clientId)
      .sort(
        (a, b) =>
          a.dateAdministered.localeCompare(b.dateAdministered) ||
          a.createdAt.localeCompare(b.createdAt),
      );
  }

  async getAssessment(id: string): Promise<AssessmentRecord | undefined> {
    return this.store.get<AssessmentRecord>(C.assessments, id);
  }

  async createAssessment(
    draft: AssessmentDraft,
    author: string,
    extraRiskFlags: string[] = [],
  ): Promise<AssessmentRecord> {
    const now = nowIso();
    const base = { ...draft };
    const riskFlags = [...computeRiskFlags(base), ...extraRiskFlags];
    if (riskFlags.length > 0 && !draft.riskDisposition?.trim()) {
      throw new Error(
        'This assessment raises risk flags. A clinician disposition or follow-up note is required.',
      );
    }
    const record: AssessmentRecord = {
      ...base,
      id: newId(),
      severityInterpretation: interpretRecord(base),
      riskFlags,
      reviewStatus: draft.reviewStatus ?? 'approved',
      createdAt: now,
      updatedAt: now,
      version: 1,
    };
    await this.store.put(C.assessments, record.id, record);
    await this.host.audit(
      'data',
      'assessment.create',
      `${record.name} by ${author}${riskFlags.length ? ' [risk-flagged]' : ''}`,
    );
    return record;
  }

  async updateAssessment(
    id: string,
    patch: Partial<
      Pick<
        AssessmentRecord,
        'totalScore' | 'subscaleScores' | 'dateAdministered' | 'clinicianNotes' | 'riskDisposition' | 'sourceInputId'
      >
    >,
    author: string,
    reason: string,
  ): Promise<AssessmentRecord> {
    const existing = await this.getAssessment(id);
    if (!existing) throw new Error('Assessment not found');
    await this.snapshot('assessment', existing, reason, author, 'edited');
    const merged = { ...existing, ...patch };
    const riskFlags = [
      ...computeRiskFlags(merged),
      ...existing.riskFlags.filter((f) => f === 'self-harm-item-endorsed'),
    ];
    const updated: AssessmentRecord = {
      ...merged,
      severityInterpretation: interpretRecord(merged),
      riskFlags: [...new Set(riskFlags)],
      updatedAt: nowIso(),
      version: existing.version + 1,
    };
    if (updated.riskFlags.length > 0 && !updated.riskDisposition?.trim()) {
      throw new Error('Risk-flagged assessments require a disposition note.');
    }
    await this.store.put(C.assessments, id, updated);
    await this.host.audit('data', 'assessment.edit', `by ${author}: ${reason}`);
    return updated;
  }

  async decideAssessment(
    id: string,
    decision: 'approve' | 'reject',
    author: string,
    dispositionNote?: string,
  ): Promise<AssessmentRecord> {
    const existing = await this.getAssessment(id);
    if (!existing) throw new Error('Assessment not found');
    if (
      decision === 'approve' &&
      existing.riskFlags.length > 0 &&
      !(dispositionNote?.trim() || existing.riskDisposition?.trim())
    ) {
      throw new Error('Risk-flagged assessments require a disposition note before approval.');
    }
    await this.snapshot('assessment', existing, `Review decision: ${decision}`, author, decision);
    const updated: AssessmentRecord = {
      ...existing,
      reviewStatus: decision === 'approve' ? 'approved' : 'rejected',
      riskDisposition: dispositionNote?.trim() || existing.riskDisposition,
      updatedAt: nowIso(),
      version: existing.version + 1,
    };
    await this.store.put(C.assessments, id, updated);
    await this.host.audit('data', `assessment.${decision}`, `by ${author}`);
    return updated;
  }

  // --------------------------------------------------------- hypotheses

  async listHypotheses(clientId: string): Promise<ClinicalHypothesis[]> {
    const all = await this.store.getAll<ClinicalHypothesis>(C.hypotheses);
    return all
      .filter((h) => h.clientId === clientId)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async getHypothesis(id: string): Promise<ClinicalHypothesis | undefined> {
    return this.store.get<ClinicalHypothesis>(C.hypotheses, id);
  }

  async createHypothesis(draft: HypothesisDraft, author: string): Promise<ClinicalHypothesis> {
    const now = nowIso();
    const hypothesis: ClinicalHypothesis = {
      ...draft,
      id: newId(),
      reviewStatus: 'approved', // clinician-authored; AI drafts in Phase 4 arrive as pending
      lifecycleStatus: 'active',
      createdAt: now,
      updatedAt: now,
      version: 1,
    };
    await this.store.put(C.hypotheses, hypothesis.id, hypothesis);
    await this.host.audit('data', 'hypothesis.create', `by ${author}`);
    return hypothesis;
  }

  async updateHypothesis(
    id: string,
    patch: Partial<
      Pick<
        ClinicalHypothesis,
        | 'statement'
        | 'category'
        | 'confidence'
        | 'alternativeExplanations'
        | 'missingInformation'
        | 'questionsToAssess'
        | 'clinicianComments'
      >
    >,
    author: string,
    reason: string,
  ): Promise<ClinicalHypothesis> {
    const existing = await this.getHypothesis(id);
    if (!existing) throw new Error('Hypothesis not found');
    await this.snapshot('hypothesis', existing, reason, author, 'edited');
    const updated: ClinicalHypothesis = {
      ...existing,
      ...patch,
      updatedAt: nowIso(),
      version: existing.version + 1,
    };
    await this.store.put(C.hypotheses, id, updated);
    await this.host.audit('data', 'hypothesis.edit', `by ${author}: ${reason}`);
    return updated;
  }

  async setHypothesisLifecycle(
    id: string,
    lifecycle: 'active' | 'rejected' | 'superseded',
    author: string,
    note?: string,
  ): Promise<ClinicalHypothesis> {
    const existing = await this.getHypothesis(id);
    if (!existing) throw new Error('Hypothesis not found');
    await this.snapshot('hypothesis', existing, `Lifecycle → ${lifecycle}`, author, lifecycle);
    const updated: ClinicalHypothesis = {
      ...existing,
      lifecycleStatus: lifecycle,
      reviewStatus: lifecycle === 'rejected' ? 'rejected' : lifecycle === 'superseded' ? 'superseded' : existing.reviewStatus,
      clinicianComments: note ?? existing.clinicianComments,
      updatedAt: nowIso(),
      version: existing.version + 1,
    };
    await this.store.put(C.hypotheses, id, updated);
    await this.host.audit('data', `hypothesis.${lifecycle}`, `by ${author}`);
    return updated;
  }

  // ----------------------------------------------------------- evidence

  async listEvidence(
    clientId: string,
    target?: { type: string; id: string },
  ): Promise<EvidenceLink[]> {
    const all = await this.store.getAll<EvidenceLink>(C.evidence);
    return all
      .filter(
        (e) =>
          e.clientId === clientId &&
          (!target || (e.targetType === target.type && e.targetId === target.id)),
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  private async getTargetClientId(
    targetType: EvidenceLink['targetType'],
    targetId: string,
  ): Promise<string | undefined> {
    switch (targetType) {
      case 'fact':
        return (await this.getFact(targetId))?.clientId;
      case 'hypothesis':
        return (await this.getHypothesis(targetId))?.clientId;
      case 'assessment':
        return (await this.getAssessment(targetId))?.clientId;
      case 'contradiction':
        return (await this.store.get<Contradiction>(C.contradictions, targetId))?.clientId;
      case 'gap':
        return (await this.store.get<NeedsAssessmentItem>(C.gaps, targetId))?.clientId;
    }
  }

  /**
   * Creates an evidence link after validating that the link, its target
   * entity, and its source clinical input all belong to the same client.
   */
  async createEvidenceLink(draft: EvidenceDraft, author: string): Promise<EvidenceLink> {
    const sourceMeta = await this.host.getInputMeta(draft.sourceInputId);
    if (!sourceMeta) throw new Error('Evidence source input not found');
    if (sourceMeta.clientId !== draft.clientId) {
      throw new Error('Cross-client evidence link rejected: source input belongs to another client');
    }
    const targetClientId = await this.getTargetClientId(draft.targetType, draft.targetId);
    if (!targetClientId) throw new Error('Evidence target not found');
    if (targetClientId !== draft.clientId) {
      throw new Error('Cross-client evidence link rejected: target belongs to another client');
    }
    const link: EvidenceLink = {
      ...draft,
      id: newId(),
      sourceInputVersion: sourceMeta.version,
      reviewStatus: draft.reviewStatus ?? 'approved',
      createdAt: nowIso(),
    };
    await this.store.put(C.evidence, link.id, link);
    await this.host.audit('data', 'evidence.create', `${link.targetType} by ${author}`);
    return link;
  }

  async deleteEvidenceLink(id: string, author: string): Promise<void> {
    await this.store.remove(C.evidence, id);
    await this.host.audit('data', 'evidence.delete', `by ${author}`);
  }

  // ------------------------------------------------------ contradictions

  async listContradictions(clientId: string): Promise<Contradiction[]> {
    const all = await this.store.getAll<Contradiction>(C.contradictions);
    return all
      .filter((c) => c.clientId === clientId)
      .sort((a, b) => b.dateIdentified.localeCompare(a.dateIdentified));
  }

  async createContradiction(draft: ContradictionDraft, author: string): Promise<Contradiction> {
    const now = nowIso();
    const contradiction: Contradiction = {
      ...draft,
      id: newId(),
      resolutionStatus: 'unresolved',
      createdAt: now,
      updatedAt: now,
      version: 1,
    };
    await this.store.put(C.contradictions, contradiction.id, contradiction);
    await this.host.audit('data', 'contradiction.create', `by ${author}`);
    return contradiction;
  }

  async resolveContradiction(
    id: string,
    resolution: ContradictionResolution,
    author: string,
    note?: string,
  ): Promise<Contradiction> {
    const existing = await this.store.get<Contradiction>(C.contradictions, id);
    if (!existing) throw new Error('Contradiction not found');
    await this.snapshot('contradiction', existing, `Resolution → ${resolution}`, author, resolution);
    const updated: Contradiction = {
      ...existing,
      resolutionStatus: resolution,
      clinicianNote: note ?? existing.clinicianNote,
      dateResolved: resolution === 'unresolved' ? undefined : nowIso(),
      updatedAt: nowIso(),
      version: existing.version + 1,
    };
    await this.store.put(C.contradictions, id, updated);
    await this.host.audit('data', 'contradiction.resolve', `${resolution} by ${author}`);
    return updated;
  }

  // ---------------------------------------------------------------- gaps

  async listGaps(clientId: string): Promise<NeedsAssessmentItem[]> {
    const all = await this.store.getAll<NeedsAssessmentItem>(C.gaps);
    return all
      .filter((g) => g.clientId === clientId)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async createGap(draft: GapDraft, author: string): Promise<NeedsAssessmentItem> {
    const now = nowIso();
    const gap: NeedsAssessmentItem = {
      ...draft,
      id: newId(),
      status: 'open',
      createdAt: now,
      updatedAt: now,
      version: 1,
    };
    await this.store.put(C.gaps, gap.id, gap);
    await this.host.audit('data', 'gap.create', `by ${author}`);
    return gap;
  }

  async updateGapStatus(
    id: string,
    status: GapStatus,
    author: string,
    note?: string,
  ): Promise<NeedsAssessmentItem> {
    const existing = await this.store.get<NeedsAssessmentItem>(C.gaps, id);
    if (!existing) throw new Error('Item not found');
    await this.snapshot('gap', existing, `Status → ${status}`, author, status);
    const updated: NeedsAssessmentItem = {
      ...existing,
      status,
      clinicianNote: note ?? existing.clinicianNote,
      updatedAt: nowIso(),
      version: existing.version + 1,
    };
    await this.store.put(C.gaps, id, updated);
    await this.host.audit('data', 'gap.update', `${status} by ${author}`);
    return updated;
  }

  // ----------------------------------------------------------- queue

  async listQueue(clientId?: string): Promise<QueueItem[]> {
    const [facts, assessments, hypotheses, evidence, contradictions, gaps] = await Promise.all([
      this.store.getAll<ExtractedFact>(C.facts),
      this.store.getAll<AssessmentRecord>(C.assessments),
      this.store.getAll<ClinicalHypothesis>(C.hypotheses),
      this.store.getAll<EvidenceLink>(C.evidence),
      this.store.getAll<Contradiction>(C.contradictions),
      this.store.getAll<NeedsAssessmentItem>(C.gaps),
    ]);
    const inClient = <T extends { clientId: string }>(items: T[]) =>
      clientId ? items.filter((i) => i.clientId === clientId) : items;

    const queue: QueueItem[] = [
      ...inClient(facts)
        .filter((f) => f.reviewStatus === 'pending' || f.reviewStatus === 'needs-clarification')
        .map((f) => {
          const ineligibleReason = bulkApprovalIneligibilityReason(f);
          return {
            kind: 'fact' as const,
            id: f.id,
            clientId: f.clientId,
            title: f.statement,
            detail: `Extracted fact · ${f.category}`,
            date: f.updatedAt,
            riskRelated: f.riskRelated,
            extractionMethod: f.extractionMethod,
            bulkEligible: ineligibleReason === null,
            individualReviewReason: ineligibleReason ?? undefined,
          };
        }),
      ...inClient(assessments)
        .filter((a) => a.reviewStatus === 'pending')
        .map((a) => ({
          kind: 'assessment' as const,
          id: a.id,
          clientId: a.clientId,
          title: `${a.name}${a.totalScore !== undefined ? `: ${a.totalScore}` : ''}`,
          detail: `Assessment · ${a.dateAdministered}`,
          date: a.updatedAt,
          riskRelated: a.riskFlags.length > 0,
          bulkEligible: false,
          individualReviewReason: 'Assessments always require individual review',
        })),
      ...inClient(hypotheses)
        .filter((h) => h.reviewStatus === 'pending')
        .map((h) => ({
          kind: 'hypothesis' as const,
          id: h.id,
          clientId: h.clientId,
          title: h.statement,
          detail: `Hypothesis · ${h.category}`,
          date: h.updatedAt,
          riskRelated: false,
          bulkEligible: false,
        })),
      ...inClient(evidence)
        .filter((e) => e.reviewStatus === 'pending')
        .map((e) => ({
          kind: 'evidence' as const,
          id: e.id,
          clientId: e.clientId,
          title: e.excerpt.slice(0, 120),
          detail: `Evidence link · ${e.relationship}`,
          date: e.createdAt,
          riskRelated: false,
          bulkEligible: false,
        })),
      ...inClient(contradictions)
        .filter((c) => c.resolutionStatus === 'unresolved')
        .map((c) => ({
          kind: 'contradiction' as const,
          id: c.id,
          clientId: c.clientId,
          title: c.topic,
          detail: 'Contradiction · unresolved',
          date: c.updatedAt,
          riskRelated: false,
          bulkEligible: false,
        })),
      ...inClient(gaps)
        .filter((g) => g.status === 'open')
        .map((g) => ({
          kind: 'gap' as const,
          id: g.id,
          clientId: g.clientId,
          title: g.topic,
          detail: `Needs further assessment · ${g.priority} priority`,
          date: g.updatedAt,
          riskRelated: false,
          bulkEligible: false,
        })),
    ];
    return queue.sort(
      (a, b) => Number(b.riskRelated) - Number(a.riskRelated) || b.date.localeCompare(a.date),
    );
  }

  // --------------------------------------------------- cascade deletion

  /** Removes every Phase 2 record belonging to a client. */
  async deleteAllForClient(clientId: string): Promise<void> {
    for (const collection of Object.values(C)) {
      const items = await this.store.getAll<{ id: string; clientId: string }>(collection);
      for (const item of items.filter((i) => i.clientId === clientId)) {
        await this.store.remove(collection, item.id);
      }
    }
  }
}
