import { create } from 'zustand';
import type { AiFeedbackRecord, AiOperationRecord } from '../core/ai/aiSchema';
import { authService } from '../core/auth/authService';
import type { AuditEvent } from '../core/db/schema';
import {
  EmbeddingRefusedError,
  generateClientEmbeddings,
  lexicalPreviewSearch,
  semanticPreviewSearch,
  type GenerateEmbeddingsResult,
  type SemanticSearchRow,
} from '../core/embeddings/embeddingService';
import { runEvaluation } from '../core/eval/evalRunner';
import type {
  ClinicianRating,
  CustomEvalCaseDraft,
  EvalCase,
  EvalRun,
  EvalTaskType,
} from '../core/eval/evalSchema';
import type { ApprovalDraft } from '../core/governance/governanceRepository';
import type { ChecklistItem, ProviderApproval } from '../core/governance/governanceSchema';
import {
  generateReadinessReport,
  type ReadinessReport,
} from '../core/governance/readinessReport';
import { useAiStore } from './aiStore';

async function author(): Promise<string> {
  return (await authService.getProfile())?.name ?? 'Clinician';
}

interface GovernanceState {
  cases: EvalCase[];
  runs: EvalRun[];
  approvals: ProviderApproval[];
  checklist: ChecklistItem[];
  auditEvents: AuditEvent[];
  operations: AiOperationRecord[];
  feedback: AiFeedbackRecord[];
  report?: ReadinessReport;
  runningEval: boolean;

  reset: () => void;
  loadEval: () => Promise<void>;
  loadGovernance: () => Promise<void>;
  loadAudit: (limit?: number) => Promise<void>;
  loadFeedback: () => Promise<void>;

  runEval: (
    caseId: string,
    taskType: EvalTaskType,
    providerType: 'deterministic' | 'local' | 'online',
    onlineSendConfirmed?: boolean,
  ) => Promise<EvalRun>;
  rateRun: (id: string, rating: ClinicianRating, comment?: string) => Promise<void>;
  deleteRun: (id: string) => Promise<void>;
  createCustomCase: (draft: CustomEvalCaseDraft) => Promise<EvalCase>;
  deleteCustomCase: (id: string) => Promise<void>;

  saveApproval: (draft: ApprovalDraft & { id?: string }) => Promise<void>;
  deleteApproval: (id: string) => Promise<void>;

  updateChecklistItem: (
    id: string,
    patch: Partial<Pick<ChecklistItem, 'status' | 'notes' | 'evidence' | 'reviewer' | 'nextReviewDate'>>,
  ) => Promise<void>;
  buildReport: () => Promise<ReadinessReport>;

  generateEmbeddings: (clientId: string, onlineSendConfirmed?: boolean) => Promise<GenerateEmbeddingsResult>;
  deleteEmbeddings: (clientId: string) => Promise<number>;
  previewSemantic: (
    clientId: string,
    query: string,
    onlineSendConfirmed?: boolean,
  ) => Promise<{ semantic: SemanticSearchRow[]; lexical: Array<{ refType: string; refId: string; score: number }> }>;
}

export const useGovernanceStore = create<GovernanceState>((set, get) => ({
  cases: [],
  runs: [],
  approvals: [],
  checklist: [],
  auditEvents: [],
  operations: [],
  feedback: [],
  runningEval: false,

  reset: () =>
    set({
      cases: [],
      runs: [],
      approvals: [],
      checklist: [],
      auditEvents: [],
      operations: [],
      feedback: [],
      report: undefined,
      runningEval: false,
    }),

  loadEval: async () => {
    const db = authService.require();
    const [cases, runs] = await Promise.all([db.evaluation.listCases(), db.evaluation.listRuns()]);
    set({ cases, runs });
  },

  loadGovernance: async () => {
    const db = authService.require();
    const [approvals, checklist] = await Promise.all([db.governance.listApprovals(), db.governance.listChecklist()]);
    set({ approvals, checklist });
  },

  loadAudit: async (limit = 500) => {
    const db = authService.require();
    const [auditEvents, operations] = await Promise.all([db.listAudit(limit), db.ai.listOperations(undefined, 1000)]);
    set({ auditEvents, operations });
  },

  loadFeedback: async () => {
    const db = authService.require();
    set({ feedback: await db.ai.listAllFeedback(), operations: await db.ai.listOperations(undefined, 1000) });
  },

  runEval: async (caseId, taskType, providerType, onlineSendConfirmed) => {
    const db = authService.require();
    const evalCase = await db.evaluation.getCase(caseId);
    if (!evalCase) throw new Error('Test case not found');
    set({ runningEval: true });
    try {
      const run = await runEvaluation({
        db,
        settings: useAiStore.getState().settings,
        evalCase,
        taskType,
        providerType,
        onlineSendConfirmed,
      });
      await get().loadEval();
      return run;
    } finally {
      set({ runningEval: false });
    }
  },

  rateRun: async (id, rating, comment) => {
    const db = authService.require();
    await db.evaluation.rateRun(id, rating, comment, await author());
    await get().loadEval();
  },

  deleteRun: async (id) => {
    const db = authService.require();
    await db.evaluation.deleteRun(id);
    await get().loadEval();
  },

  createCustomCase: async (draft) => {
    const db = authService.require();
    const created = await db.evaluation.createCustomCase(draft, await author());
    await get().loadEval();
    return created;
  },

  deleteCustomCase: async (id) => {
    const db = authService.require();
    await db.evaluation.deleteCustomCase(id, await author());
    await get().loadEval();
  },

  saveApproval: async (draft) => {
    const db = authService.require();
    await db.governance.saveApproval(draft, await author());
    await get().loadGovernance();
  },

  deleteApproval: async (id) => {
    const db = authService.require();
    await db.governance.deleteApproval(id, await author());
    await get().loadGovernance();
  },

  updateChecklistItem: async (id, patch) => {
    const db = authService.require();
    await db.governance.updateChecklistItem(id, patch, await author());
    await get().loadGovernance();
  },

  buildReport: async () => {
    const db = authService.require();
    const report = await generateReadinessReport(db);
    set({ report });
    return report;
  },

  generateEmbeddings: async (clientId, onlineSendConfirmed) => {
    const db = authService.require();
    try {
      return await generateClientEmbeddings(db, useAiStore.getState().settings, clientId, { onlineSendConfirmed });
    } catch (err) {
      if (err instanceof EmbeddingRefusedError) throw err;
      throw err;
    }
  },

  deleteEmbeddings: async (clientId) => {
    const db = authService.require();
    return db.governance.deleteEmbeddingsForClient(clientId);
  },

  previewSemantic: async (clientId, query, onlineSendConfirmed) => {
    const db = authService.require();
    const settings = useAiStore.getState().settings;
    const [semantic, lexical] = await Promise.all([
      semanticPreviewSearch(db, settings, clientId, query, { onlineSendConfirmed }),
      lexicalPreviewSearch(db, clientId, query),
    ]);
    return { semantic, lexical };
  },
}));
