import { create } from 'zustand';
import { authService } from '../core/auth/authService';
import type {
  AssessmentDraft,
  ContradictionDraft,
  EvidenceDraft,
  FactDecision,
  FactDraft,
  GapDraft,
  HypothesisDraft,
  QueueItem,
} from '../core/db/structuredRepository';
import type {
  AssessmentRecord,
  ClinicalHypothesis,
  Contradiction,
  ContradictionResolution,
  EvidenceLink,
  ExtractedFact,
  GapStatus,
  NeedsAssessmentItem,
  VersionRecord,
} from '../core/db/structuredSchema';

let cachedAuthor = 'Clinician';

async function author(): Promise<string> {
  const profile = await authService.getProfile();
  cachedAuthor = profile?.name ?? cachedAuthor;
  return cachedAuthor;
}

interface ClientStructuredData {
  facts: ExtractedFact[];
  assessments: AssessmentRecord[];
  hypotheses: ClinicalHypothesis[];
  evidence: EvidenceLink[];
  contradictions: Contradiction[];
  gaps: NeedsAssessmentItem[];
  versions: VersionRecord[];
}

interface StructuredState {
  byClient: Record<string, ClientStructuredData | undefined>;
  globalQueue: QueueItem[];

  reset: () => void;
  loadClient: (clientId: string) => Promise<void>;
  loadGlobalQueue: () => Promise<void>;

  createFact: (draft: FactDraft) => Promise<ExtractedFact>;
  decideFact: (
    id: string,
    clientId: string,
    decision: FactDecision,
    opts?: { correction?: string; note?: string; asEdited?: boolean },
  ) => Promise<void>;
  editFact: (id: string, clientId: string, patch: Partial<ExtractedFact>, reason: string) => Promise<void>;
  markFactHistorical: (id: string, clientId: string) => Promise<void>;
  bulkApproveFacts: (
    ids: string[],
    clientId: string,
  ) => Promise<{ approved: string[]; skipped: Array<{ id: string; reason: string }> }>;

  createAssessment: (draft: AssessmentDraft, extraRiskFlags?: string[]) => Promise<AssessmentRecord>;
  decideAssessment: (id: string, clientId: string, decision: 'approve' | 'reject', note?: string) => Promise<void>;
  updateAssessment: (id: string, clientId: string, patch: Partial<AssessmentRecord>, reason: string) => Promise<void>;

  createHypothesis: (draft: HypothesisDraft) => Promise<ClinicalHypothesis>;
  updateHypothesis: (id: string, clientId: string, patch: Partial<ClinicalHypothesis>, reason: string) => Promise<void>;
  setHypothesisLifecycle: (
    id: string,
    clientId: string,
    lifecycle: 'active' | 'rejected' | 'superseded',
    note?: string,
  ) => Promise<void>;

  createEvidenceLink: (draft: EvidenceDraft) => Promise<EvidenceLink>;
  deleteEvidenceLink: (id: string, clientId: string) => Promise<void>;

  createContradiction: (draft: ContradictionDraft) => Promise<Contradiction>;
  resolveContradiction: (
    id: string,
    clientId: string,
    resolution: ContradictionResolution,
    note?: string,
  ) => Promise<void>;

  createGap: (draft: GapDraft) => Promise<NeedsAssessmentItem>;
  updateGapStatus: (id: string, clientId: string, status: GapStatus, note?: string) => Promise<void>;
}

export const useStructuredStore = create<StructuredState>((set, get) => {
  const reload = async (clientId: string) => {
    await get().loadClient(clientId);
    await get().loadGlobalQueue();
  };

  return {
    byClient: {},
    globalQueue: [],

    reset: () => set({ byClient: {}, globalQueue: [] }),

    loadClient: async (clientId) => {
      const db = authService.require();
      const [facts, assessments, hypotheses, evidence, contradictions, gaps, versions] =
        await Promise.all([
          db.structured.listFacts(clientId),
          db.structured.listAssessments(clientId),
          db.structured.listHypotheses(clientId),
          db.structured.listEvidence(clientId),
          db.structured.listContradictions(clientId),
          db.structured.listGaps(clientId),
          db.structured.listVersions(clientId),
        ]);
      set((state) => ({
        byClient: {
          ...state.byClient,
          [clientId]: { facts, assessments, hypotheses, evidence, contradictions, gaps, versions },
        },
      }));
    },

    loadGlobalQueue: async () => {
      const db = authService.require();
      set({ globalQueue: await db.structured.listQueue() });
    },

    createFact: async (draft) => {
      const db = authService.require();
      const fact = await db.structured.createFact(draft, await author());
      await reload(draft.clientId);
      return fact;
    },

    decideFact: async (id, clientId, decision, opts) => {
      const db = authService.require();
      await db.structured.decideFact(id, decision, await author(), opts);
      await reload(clientId);
    },

    editFact: async (id, clientId, patch, reason) => {
      const db = authService.require();
      await db.structured.editFact(id, patch, await author(), reason);
      await reload(clientId);
    },

    markFactHistorical: async (id, clientId) => {
      const db = authService.require();
      await db.structured.markFactHistorical(id, await author());
      await reload(clientId);
    },

    bulkApproveFacts: async (ids, clientId) => {
      const db = authService.require();
      const result = await db.structured.bulkApproveFacts(ids, await author());
      await reload(clientId);
      return result;
    },

    createAssessment: async (draft, extraRiskFlags = []) => {
      const db = authService.require();
      const record = await db.structured.createAssessment(draft, await author(), extraRiskFlags);
      await reload(draft.clientId);
      return record;
    },

    decideAssessment: async (id, clientId, decision, note) => {
      const db = authService.require();
      await db.structured.decideAssessment(id, decision, await author(), note);
      await reload(clientId);
    },

    updateAssessment: async (id, clientId, patch, reason) => {
      const db = authService.require();
      await db.structured.updateAssessment(id, patch, await author(), reason);
      await reload(clientId);
    },

    createHypothesis: async (draft) => {
      const db = authService.require();
      const hypothesis = await db.structured.createHypothesis(draft, await author());
      await reload(draft.clientId);
      return hypothesis;
    },

    updateHypothesis: async (id, clientId, patch, reason) => {
      const db = authService.require();
      await db.structured.updateHypothesis(id, patch, await author(), reason);
      await reload(clientId);
    },

    setHypothesisLifecycle: async (id, clientId, lifecycle, note) => {
      const db = authService.require();
      await db.structured.setHypothesisLifecycle(id, lifecycle, await author(), note);
      await reload(clientId);
    },

    createEvidenceLink: async (draft) => {
      const db = authService.require();
      const link = await db.structured.createEvidenceLink(draft, await author());
      await reload(draft.clientId);
      return link;
    },

    deleteEvidenceLink: async (id, clientId) => {
      const db = authService.require();
      await db.structured.deleteEvidenceLink(id, await author());
      await reload(clientId);
    },

    createContradiction: async (draft) => {
      const db = authService.require();
      const contradiction = await db.structured.createContradiction(draft, await author());
      await reload(draft.clientId);
      return contradiction;
    },

    resolveContradiction: async (id, clientId, resolution, note) => {
      const db = authService.require();
      await db.structured.resolveContradiction(id, resolution, await author(), note);
      await reload(clientId);
    },

    createGap: async (draft) => {
      const db = authService.require();
      const gap = await db.structured.createGap(draft, await author());
      await reload(draft.clientId);
      return gap;
    },

    updateGapStatus: async (id, clientId, status, note) => {
      const db = authService.require();
      await db.structured.updateGapStatus(id, status, await author(), note);
      await reload(clientId);
    },
  };
});
