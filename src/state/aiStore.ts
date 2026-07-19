import { create } from 'zustand';
import {
  buildSendPreview,
  cancelAiOperation,
  cancelAllAiOperations,
  newOperationToken,
  type SendPreview,
} from '../core/ai/aiGateway';
import type { AiOperationRecord, AiSettings } from '../core/ai/aiSchema';
import { DEFAULT_AI_SETTINGS } from '../core/ai/aiSchema';
import { activeAiProvider, listAiProviders } from '../core/ai/providerRegistry';
import type { EvidenceBlock, ProviderReadiness } from '../core/ai/types';
import { authService } from '../core/auth/authService';
import { createAiDocumentProvider, AI_DOC_PROVIDER_ID } from '../core/documents/aiDocProvider';
import {
  registerDocumentProvider,
  unregisterDocumentProvider,
} from '../core/documents/providerRegistry';
import { createAiExtractionProvider } from '../core/extraction/aiExtractionProvider';
import {
  AI_EXTRACTION_PROVIDER_ID,
  registerExtractionProvider,
  unregisterExtractionProvider,
} from '../core/extraction/registry';

interface AiState {
  settings: AiSettings;
  readiness: Record<string, ProviderReadiness>;
  /** True when the ACTIVE provider is genuinely usable right now. */
  activeReady: boolean;
  operations: AiOperationRecord[];
  loaded: boolean;
  /** Per-run confirmation that the outbound preview was reviewed (online). */
  onlineConfirmed: boolean;

  reset: () => void;
  load: () => Promise<void>;
  saveSettings: (patch: Partial<AiSettings>) => Promise<void>;
  refreshReadiness: () => Promise<void>;
  loadOperations: (clientId?: string) => Promise<void>;
  setOnlineConfirmed: (confirmed: boolean) => void;
  newToken: () => string;
  cancelOperation: (token: string) => void;
  cancelAll: () => void;
  /** Exact-outbound preview for the given texts (redaction applied). */
  buildPreview: (
    clientId: string,
    texts: Array<{ label: string; text: string; date?: string }>,
    knownNames: string[],
  ) => SendPreview;
}

export const useAiStore = create<AiState>((set, get) => {
  /** Registers/unregisters the AI extraction + document providers to match
   *  reality: they exist in the registries ONLY while genuinely usable. */
  const syncRegistries = () => {
    const { settings, activeReady } = get();
    const aiActive = settings.activeProviderType !== 'deterministic' && activeReady;
    if (aiActive) {
      const getContext = () => ({
        db: authService.require(),
        settings: get().settings,
        provider: activeAiProvider(get().settings),
        onlineSendConfirmed: get().onlineConfirmed,
      });
      registerExtractionProvider(createAiExtractionProvider(getContext));
      registerDocumentProvider(createAiDocumentProvider(getContext));
    } else {
      unregisterExtractionProvider(AI_EXTRACTION_PROVIDER_ID);
      unregisterDocumentProvider(AI_DOC_PROVIDER_ID);
    }
  };

  return {
    settings: { ...DEFAULT_AI_SETTINGS },
    readiness: {},
    activeReady: false,
    operations: [],
    loaded: false,
    onlineConfirmed: false,

    reset: () => {
      cancelAllAiOperations();
      unregisterExtractionProvider(AI_EXTRACTION_PROVIDER_ID);
      unregisterDocumentProvider(AI_DOC_PROVIDER_ID);
      set({
        settings: { ...DEFAULT_AI_SETTINGS },
        readiness: {},
        activeReady: false,
        operations: [],
        loaded: false,
        onlineConfirmed: false,
      });
    },

    load: async () => {
      const db = authService.require();
      const settings = await db.ai.getSettings();
      set({ settings, loaded: true });
      await get().refreshReadiness();
    },

    saveSettings: async (patch) => {
      const db = authService.require();
      const settings = await db.ai.saveSettings(patch);
      set({ settings });
      await get().refreshReadiness();
    },

    refreshReadiness: async () => {
      const { settings } = get();
      const readiness: Record<string, ProviderReadiness> = {};
      for (const provider of listAiProviders()) {
        readiness[provider.id] = await provider.checkReadiness(settings);
      }
      const active = activeAiProvider(settings);
      const activeReady = readiness[active.id]?.ready ?? false;
      set({ readiness, activeReady });
      syncRegistries();
    },

    loadOperations: async (clientId) => {
      const db = authService.require();
      set({ operations: await db.ai.listOperations(clientId) });
    },

    setOnlineConfirmed: (confirmed) => set({ onlineConfirmed: confirmed }),

    newToken: () => newOperationToken(),

    cancelOperation: (token) => cancelAiOperation(token),

    cancelAll: () => cancelAllAiOperations(),

    buildPreview: (clientId, texts, knownNames) => {
      const { settings } = get();
      const provider = activeAiProvider(settings);
      const blocks: EvidenceBlock[] = texts.map((t, i) => ({
        ref: `E${i + 1}`,
        refType: 'input',
        refId: `preview-${i}`,
        clientId,
        date: t.date,
        label: t.label,
        text: t.text,
      }));
      return buildSendPreview(settings, provider, blocks, knownNames).preview;
    },
  };
});
