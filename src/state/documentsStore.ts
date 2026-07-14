import { create } from 'zustand';
import { authService } from '../core/auth/authService';
import type {
  DapNote,
  DapStyle,
  SourceSelection,
  TreatmentGoal,
  TreatmentPlanDoc,
} from '../core/db/documentSchema';
import type { GoalDraft } from '../core/db/documentsRepository';
import { assembleGenerationContext } from '../core/documents/contextAssembler';
import { getDocumentProvider, DEFAULT_DOCUMENT_PROVIDER_ID } from '../core/documents/providerRegistry';

async function author(): Promise<string> {
  return (await authService.getProfile())?.name ?? 'Clinician';
}

interface ClientDocs {
  dapNotes: DapNote[];
  plans: TreatmentPlanDoc[];
  goals: TreatmentGoal[];
}

type DocDecision = 'approve' | 'reject' | 'archive' | 'supersede' | 'submit-for-review' | 'needs-more-info';

interface DocumentsState {
  byClient: Record<string, ClientDocs | undefined>;

  reset: () => void;
  loadClient: (clientId: string) => Promise<void>;

  generateDapNote: (
    clientId: string,
    selection: SourceSelection,
    meta: { sessionDate: string; sessionNumber?: number; levelOfCare: string; style: DapStyle },
  ) => Promise<DapNote>;
  updateDapNote: (id: string, clientId: string, patch: Partial<DapNote>, reason: string) => Promise<void>;
  decideDapNote: (id: string, clientId: string, decision: DocDecision, comment?: string) => Promise<void>;
  acknowledgeDapRisk: (id: string, clientId: string, segmentId: string, note?: string) => Promise<void>;
  deleteDapNote: (id: string, clientId: string) => Promise<void>;

  generatePlan: (clientId: string, selection: SourceSelection, planDate: string) => Promise<TreatmentPlanDoc>;
  updatePlan: (id: string, clientId: string, patch: Partial<TreatmentPlanDoc>, reason: string) => Promise<void>;
  decidePlan: (id: string, clientId: string, decision: DocDecision, comment?: string) => Promise<void>;
  acknowledgePlanRisk: (id: string, clientId: string, itemId: string, note?: string) => Promise<void>;
  deletePlan: (id: string, clientId: string) => Promise<void>;

  createGoal: (draft: GoalDraft) => Promise<TreatmentGoal>;
  updateGoal: (id: string, clientId: string, patch: Partial<TreatmentGoal>, reason: string) => Promise<void>;
  duplicateGoal: (id: string, clientId: string) => Promise<void>;
  reorderGoal: (id: string, clientId: string, direction: 'up' | 'down') => Promise<void>;
  deleteGoal: (id: string, clientId: string) => Promise<void>;
  addObjectiveProgressNote: (goalId: string, clientId: string, objectiveId: string, note: string) => Promise<void>;

  auditExport: (clientId: string, what: string) => Promise<void>;
}

export const useDocumentsStore = create<DocumentsState>((set, get) => {
  const reload = async (clientId: string) => get().loadClient(clientId);

  return {
    byClient: {},

    reset: () => set({ byClient: {} }),

    loadClient: async (clientId) => {
      const db = authService.require();
      const [dapNotes, plans, goals] = await Promise.all([
        db.documents.listDapNotes(clientId),
        db.documents.listPlans(clientId),
        db.documents.listGoals(clientId),
      ]);
      set((state) => ({ byClient: { ...state.byClient, [clientId]: { dapNotes, plans, goals } } }));
    },

    generateDapNote: async (clientId, selection, meta) => {
      const db = authService.require();
      const provider = getDocumentProvider(DEFAULT_DOCUMENT_PROVIDER_ID)!;
      const context = await assembleGenerationContext(db, clientId, 'dap-note', selection, {
        sessionDate: meta.sessionDate,
        sessionNumber: meta.sessionNumber,
      });
      const result = provider.generateDapNote(context);
      const note = await db.documents.createDapNote(
        {
          clientId,
          sessionDate: meta.sessionDate,
          sessionNumber: meta.sessionNumber,
          levelOfCare: meta.levelOfCare,
          style: meta.style,
          segments: result.segments,
          sourceSelection: selection,
          generation: result.generation,
        },
        await author(),
      );
      await reload(clientId);
      return note;
    },

    updateDapNote: async (id, clientId, patch, reason) => {
      const db = authService.require();
      await db.documents.updateDapNote(id, patch, await author(), reason);
      await reload(clientId);
    },

    decideDapNote: async (id, clientId, decision, comment) => {
      const db = authService.require();
      await db.documents.decideDapNote(id, decision, await author(), comment);
      await reload(clientId);
    },

    acknowledgeDapRisk: async (id, clientId, segmentId, note) => {
      const db = authService.require();
      await db.documents.acknowledgeDapRisk(id, segmentId, await author(), note);
      await reload(clientId);
    },

    deleteDapNote: async (id, clientId) => {
      const db = authService.require();
      await db.documents.deleteDapNote(id, await author());
      await reload(clientId);
    },

    generatePlan: async (clientId, selection, planDate) => {
      const db = authService.require();
      const provider = getDocumentProvider(DEFAULT_DOCUMENT_PROVIDER_ID)!;
      const context = await assembleGenerationContext(db, clientId, 'treatment-plan', selection, {
        sessionDate: planDate,
      });
      const client = context.client;
      const result = provider.generateTreatmentPlan(context);
      const plan = await db.documents.createPlan(
        {
          clientId,
          planDate,
          diagnosesSnapshot: selection.includeDiagnoses
            ? client.diagnoses.map((d) => `${d.label}${d.kind === 'impression' ? ' (impression)' : ''}`)
            : [],
          problems: result.problems,
          segments: result.segments,
          hierarchy: result.hierarchy,
          goalIds: selection.goalIds,
          goalPlanRationale: result.goalPlanRationale,
          expectedImprovement: result.expectedImprovement,
          proposedObjectives: result.proposedObjectives,
          sourceSelection: selection,
          generation: result.generation,
        },
        await author(),
      );
      await reload(clientId);
      return plan;
    },

    updatePlan: async (id, clientId, patch, reason) => {
      const db = authService.require();
      await db.documents.updatePlan(id, patch, await author(), reason);
      await reload(clientId);
    },

    decidePlan: async (id, clientId, decision, comment) => {
      const db = authService.require();
      await db.documents.decidePlan(id, decision, await author(), comment);
      await reload(clientId);
    },

    acknowledgePlanRisk: async (id, clientId, itemId, note) => {
      const db = authService.require();
      await db.documents.acknowledgePlanRisk(id, itemId, await author(), note);
      await reload(clientId);
    },

    deletePlan: async (id, clientId) => {
      const db = authService.require();
      await db.documents.deletePlan(id, await author());
      await reload(clientId);
    },

    createGoal: async (draft) => {
      const db = authService.require();
      const goal = await db.documents.createGoal(draft, await author());
      await reload(draft.clientId);
      return goal;
    },

    updateGoal: async (id, clientId, patch, reason) => {
      const db = authService.require();
      await db.documents.updateGoal(id, patch, await author(), reason);
      await reload(clientId);
    },

    duplicateGoal: async (id, clientId) => {
      const db = authService.require();
      await db.documents.duplicateGoal(id, await author());
      await reload(clientId);
    },

    reorderGoal: async (id, clientId, direction) => {
      const db = authService.require();
      await db.documents.reorderGoal(id, direction, await author());
      await reload(clientId);
    },

    deleteGoal: async (id, clientId) => {
      const db = authService.require();
      await db.documents.deleteGoal(id, await author());
      await reload(clientId);
    },

    addObjectiveProgressNote: async (goalId, clientId, objectiveId, note) => {
      const db = authService.require();
      await db.documents.addObjectiveProgressNote(goalId, objectiveId, note, await author());
      await reload(clientId);
    },

    auditExport: async (_clientId, what) => {
      const db = authService.require();
      await db.audit('export', 'document.export', what);
    },
  };
});
