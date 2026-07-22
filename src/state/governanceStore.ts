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
import type {
  PhiGateItem,
  PolicyDraft,
  ThreatModelItem,
} from '../core/governance/phase7Schema';
import { buildDataFlowMap, type DataFlowMap } from '../core/governance/dataFlowMap';
import {
  buildSecurityReviewPacket,
  type SecurityReviewPacket,
} from '../core/governance/securityPacket';
import type { ReleaseChecklistItem, ReleaseStatus } from '../core/release/releaseSchema';
import {
  generateDeploymentReport,
  type DeploymentReport,
} from '../core/release/deploymentReport';
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
  // Phase 7 governance state
  threatModel: ThreatModelItem[];
  policies: PolicyDraft[];
  phiGate: PhiGateItem[];
  securityPacket?: SecurityReviewPacket;
  dataFlowMap?: DataFlowMap;
  // Phase 8 release + deployment
  releaseChecklist: ReleaseChecklistItem[];
  deploymentReport?: DeploymentReport;
  runningEval: boolean;

  reset: () => void;
  loadEval: () => Promise<void>;
  loadGovernance: () => Promise<void>;
  loadAudit: (limit?: number) => Promise<void>;
  loadFeedback: () => Promise<void>;
  loadPhase7: () => Promise<void>;

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

  // Phase 7 actions
  updateThreatItem: (
    id: string,
    patch: Partial<Pick<ThreatModelItem, 'reviewStatus' | 'notes' | 'reviewer' | 'remainingRisk' | 'currentMitigation' | 'requiredActionBeforeUse'>>,
  ) => Promise<void>;
  updatePolicy: (id: string, patch: Partial<Pick<PolicyDraft, 'body' | 'status' | 'reviewer'>>) => Promise<void>;
  resetPolicy: (id: string) => Promise<void>;
  setPhiGateItem: (id: string, patch: { complete: boolean; completedBy?: string; notes?: string }) => Promise<void>;
  buildSecurityPacket: () => Promise<SecurityReviewPacket>;
  buildDataFlow: () => DataFlowMap;

  // Phase 8 actions
  loadRelease: () => Promise<void>;
  updateReleaseItem: (id: string, patch: { status?: ReleaseStatus; notes?: string }) => Promise<void>;
  buildDeploymentReport: () => Promise<DeploymentReport>;

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
  threatModel: [],
  policies: [],
  phiGate: [],
  releaseChecklist: [],
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
      threatModel: [],
      policies: [],
      phiGate: [],
      securityPacket: undefined,
      dataFlowMap: undefined,
      releaseChecklist: [],
      deploymentReport: undefined,
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

  loadPhase7: async () => {
    const db = authService.require();
    const [threatModel, policies, phiGate] = await Promise.all([
      db.governance.listThreatModel(),
      db.governance.listPolicies(),
      db.governance.listPhiGate(),
    ]);
    set({ threatModel, policies, phiGate });
  },

  updateThreatItem: async (id, patch) => {
    const db = authService.require();
    await db.governance.updateThreatItem(id, patch, await author());
    set({ threatModel: await db.governance.listThreatModel() });
  },

  updatePolicy: async (id, patch) => {
    const db = authService.require();
    await db.governance.updatePolicy(id, patch, await author());
    set({ policies: await db.governance.listPolicies() });
  },

  resetPolicy: async (id) => {
    const db = authService.require();
    await db.governance.resetPolicy(id, await author());
    set({ policies: await db.governance.listPolicies() });
  },

  setPhiGateItem: async (id, patch) => {
    const db = authService.require();
    await db.governance.setPhiGateItem(id, patch, await author());
    set({ phiGate: await db.governance.listPhiGate() });
  },

  buildSecurityPacket: async () => {
    const db = authService.require();
    const securityPacket = await buildSecurityReviewPacket(db);
    set({ securityPacket });
    return securityPacket;
  },

  buildDataFlow: () => {
    const dataFlowMap = buildDataFlowMap();
    set({ dataFlowMap });
    return dataFlowMap;
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

  loadRelease: async () => {
    const db = authService.require();
    set({ releaseChecklist: await db.governance.listReleaseChecklist() });
  },

  updateReleaseItem: async (id, patch) => {
    const db = authService.require();
    await db.governance.updateReleaseItem(id, patch, await author());
    set({ releaseChecklist: await db.governance.listReleaseChecklist() });
  },

  buildDeploymentReport: async () => {
    const db = authService.require();
    const deploymentReport = await generateDeploymentReport(db);
    set({ deploymentReport });
    return deploymentReport;
  },
}));
