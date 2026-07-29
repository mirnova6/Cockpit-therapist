import { create } from 'zustand';
import { askAssistant } from '../core/assistant/assistantService';
import { authService } from '../core/auth/authService';
import type {
  AssistantMessage,
  CaseFormulation,
  ClinicalUpdateSummary,
  FormulationFramework,
  IntelligenceGeneration,
  InterventionSet,
  SafetyTrustStrategy,
} from '../core/db/intelligenceSchema';
import type { KnowledgeSource } from '../core/knowledge/knowledgeSchema';
import type { KnowledgeSourceDraft } from '../core/knowledge/knowledgeRepository';
import {
  DETERMINISTIC_FORMULATION_DISCLOSURE,
  proposeFormulationUpdate,
} from '../core/formulation/formulationEngine';
import {
  DETERMINISTIC_INTERVENTIONS_DISCLOSURE,
  generateInterventionSet,
} from '../core/interventions/interventionEngine';
import {
  applyUpdateItemDecision,
  runAnalyzePipeline,
} from '../core/pipeline/analyzePipeline';
import {
  DETERMINISTIC_STRATEGY_DISCLOSURE,
  generateSafetyTrustStrategy,
} from '../core/strategy/safetyTrustEngine';
import type { AiFeedbackRecord, FeedbackLabel } from '../core/ai/aiSchema';
import { useAiStore } from './aiStore';

async function author(): Promise<string> {
  return (await authService.getProfile())?.name ?? 'Clinician';
}

/** Provenance stamp for deterministic engine runs. */
function deterministicGeneration(disclosure: string): IntelligenceGeneration {
  return {
    providerType: 'deterministic',
    providerId: 'deterministic',
    generatedAt: new Date().toISOString(),
    disclosure,
  };
}

interface ClientIntelligence {
  formulations: CaseFormulation[];
  strategies: SafetyTrustStrategy[];
  interventionSets: InterventionSet[];
  updateSummaries: ClinicalUpdateSummary[];
  assistantMessages: AssistantMessage[];
  feedback: AiFeedbackRecord[];
}

interface IntelligenceState {
  byClient: Record<string, ClientIntelligence | undefined>;
  knowledgeSources: KnowledgeSource[];
  pipelineProgress?: { step: number; name: string };
  pipelineCancelRequested: boolean;

  reset: () => void;
  loadClient: (clientId: string) => Promise<void>;
  loadKnowledge: () => Promise<void>;

  proposeFormulation: (clientId: string, framework: FormulationFramework, reason: string) => Promise<CaseFormulation>;
  decideFormulation: (id: string, clientId: string, decision: 'approve' | 'reject', comment?: string) => Promise<void>;

  generateStrategy: (clientId: string) => Promise<SafetyTrustStrategy>;
  decideStrategy: (id: string, clientId: string, decision: 'approve' | 'reject', comment?: string) => Promise<void>;

  generateInterventions: (clientId: string) => Promise<InterventionSet>;
  markInterventionsReviewed: (id: string, clientId: string) => Promise<void>;

  runAnalyze: (clientId: string, inputId: string, onlineSendConfirmed?: boolean) => Promise<ClinicalUpdateSummary>;
  requestPipelineCancel: () => void;
  decideUpdateItem: (
    summaryId: string,
    clientId: string,
    itemId: string,
    decision: 'approve' | 'edit-approve' | 'reject' | 'save-as-hypothesis' | 'needs-further-assessment' | 'do-not-save',
    opts?: { editedStatement?: string; comment?: string; riskNote?: string },
  ) => Promise<void>;
  dismissSummary: (id: string, clientId: string) => Promise<void>;

  ask: (clientId: string, question: string, onlineSendConfirmed?: boolean) => Promise<void>;
  clearThread: (clientId: string) => Promise<void>;

  addKnowledgeSource: (
    draft: KnowledgeSourceDraft,
    text: string | undefined,
    file?: { name: string; mimeType: string; bytes: Uint8Array<ArrayBuffer> },
  ) => Promise<KnowledgeSource>;
  setKnowledgeStatus: (id: string, status: KnowledgeSource['status'], note?: string) => Promise<void>;
  replaceKnowledgeText: (id: string, text: string) => Promise<void>;
  deleteKnowledgeSource: (id: string) => Promise<void>;

  addFeedback: (
    clientId: string,
    targetType: string,
    targetId: string,
    labels: FeedbackLabel[],
    comment?: string,
    operationId?: string,
  ) => Promise<void>;
}

export const useIntelligenceStore = create<IntelligenceState>((set, get) => {
  const reload = async (clientId: string) => get().loadClient(clientId);

  return {
    byClient: {},
    knowledgeSources: [],
    pipelineCancelRequested: false,

    reset: () =>
      set({ byClient: {}, knowledgeSources: [], pipelineProgress: undefined, pipelineCancelRequested: false }),

    loadClient: async (clientId) => {
      const db = authService.require();
      const [formulations, strategies, interventionSets, updateSummaries, assistantMessages, feedback] =
        await Promise.all([
          db.intelligence.listFormulations(clientId),
          db.intelligence.listStrategies(clientId),
          db.intelligence.listInterventionSets(clientId),
          db.intelligence.listUpdateSummaries(clientId),
          db.intelligence.listAssistantMessages(clientId),
          db.ai.listFeedback(clientId),
        ]);
      set((state) => ({
        byClient: {
          ...state.byClient,
          [clientId]: { formulations, strategies, interventionSets, updateSummaries, assistantMessages, feedback },
        },
      }));
    },

    loadKnowledge: async () => {
      const db = authService.require();
      set({ knowledgeSources: await db.knowledge.listSources() });
    },

    proposeFormulation: async (clientId, framework, reason) => {
      const db = authService.require();
      const formulation = await proposeFormulationUpdate(
        db,
        clientId,
        framework,
        await author(),
        deterministicGeneration(DETERMINISTIC_FORMULATION_DISCLOSURE),
        reason,
      );
      await reload(clientId);
      return formulation;
    },

    decideFormulation: async (id, clientId, decision, comment) => {
      const db = authService.require();
      await db.intelligence.decideFormulation(id, decision, await author(), { comment });
      await reload(clientId);
    },

    generateStrategy: async (clientId) => {
      const db = authService.require();
      const strategy = await generateSafetyTrustStrategy(
        db,
        clientId,
        await author(),
        deterministicGeneration(DETERMINISTIC_STRATEGY_DISCLOSURE),
      );
      await reload(clientId);
      return strategy;
    },

    decideStrategy: async (id, clientId, decision, comment) => {
      const db = authService.require();
      await db.intelligence.decideStrategy(id, decision, await author(), comment);
      await reload(clientId);
    },

    generateInterventions: async (clientId) => {
      const db = authService.require();
      const setRecord = await generateInterventionSet(
        db,
        clientId,
        await author(),
        deterministicGeneration(DETERMINISTIC_INTERVENTIONS_DISCLOSURE),
      );
      await reload(clientId);
      return setRecord;
    },

    markInterventionsReviewed: async (id, clientId) => {
      const db = authService.require();
      await db.intelligence.markInterventionSetReviewed(id, await author());
      await reload(clientId);
    },

    runAnalyze: async (clientId, inputId, onlineSendConfirmed) => {
      const db = authService.require();
      const ai = useAiStore.getState();
      set({ pipelineCancelRequested: false, pipelineProgress: undefined });
      try {
        const summary = await runAnalyzePipeline(db, ai.settings, clientId, inputId, await author(), {
          onlineSendConfirmed,
          onProgress: (step, name) => set({ pipelineProgress: { step, name } }),
          isCancelled: () => get().pipelineCancelRequested,
        });
        await reload(clientId);
        return summary;
      } finally {
        set({ pipelineProgress: undefined, pipelineCancelRequested: false });
      }
    },

    requestPipelineCancel: () => {
      set({ pipelineCancelRequested: true });
      useAiStore.getState().cancelAll();
    },

    decideUpdateItem: async (summaryId, clientId, itemId, decision, opts) => {
      const db = authService.require();
      await applyUpdateItemDecision(db, summaryId, itemId, decision, await author(), opts);
      await reload(clientId);
    },

    dismissSummary: async (id, clientId) => {
      const db = authService.require();
      await db.intelligence.dismissUpdateSummary(id, await author());
      await reload(clientId);
    },

    ask: async (clientId, question, onlineSendConfirmed) => {
      const db = authService.require();
      const ai = useAiStore.getState();
      await askAssistant(db, ai.settings, clientId, question, { onlineSendConfirmed });
      await reload(clientId);
    },

    clearThread: async (clientId) => {
      const db = authService.require();
      await db.intelligence.clearAssistantThread(clientId, await author());
      await reload(clientId);
    },

    addKnowledgeSource: async (draft, text, file) => {
      const db = authService.require();
      const source = await db.knowledge.createSource(draft, text, await author(), file);
      await get().loadKnowledge();
      return source;
    },

    setKnowledgeStatus: async (id, status, note) => {
      const db = authService.require();
      await db.knowledge.setStatus(id, status, await author(), { note });
      await get().loadKnowledge();
    },

    replaceKnowledgeText: async (id, text) => {
      const db = authService.require();
      await db.knowledge.replaceText(id, text, await author());
      await get().loadKnowledge();
    },

    deleteKnowledgeSource: async (id) => {
      const db = authService.require();
      await db.knowledge.deleteSource(id, await author());
      await get().loadKnowledge();
    },

    addFeedback: async (clientId, targetType, targetId, labels, comment, operationId) => {
      const db = authService.require();
      await db.ai.addFeedback({
        clientId,
        targetType,
        targetId,
        labels,
        comment,
        operationId,
        author: await author(),
      });
      await reload(clientId);
    },
  };
});
