import { create } from 'zustand';
import { authService } from '../core/auth/authService';
import type { ClientDraft, ClinicalInputDraft, NewAttachment } from '../core/db/database';
import {
  DEFAULT_PREFS,
  type ChangeRecord,
  type Client,
  type ClinicalInput,
  type RiskStatus,
  type UserPrefs,
} from '../core/db/schema';
import type { ClientDerived } from '../features/clients/clientFilters';

interface DataState {
  loaded: boolean;
  clients: Client[];
  derived: Record<string, ClientDerived | undefined>;
  inputs: Record<string, ClinicalInput[] | undefined>; // by clientId (non-archived)
  changes: Record<string, ChangeRecord[] | undefined>; // by clientId
  prefs: UserPrefs;

  reset: () => void;
  loadAll: () => Promise<void>;
  refreshClient: (clientId: string) => Promise<void>;

  createClient: (draft: ClientDraft) => Promise<Client>;
  updateClient: (id: string, patch: Partial<Client>, summary: string) => Promise<void>;
  setClientRisk: (id: string, risk: RiskStatus) => Promise<void>;
  setClientArchived: (id: string, archived: boolean) => Promise<void>;
  deleteClient: (id: string) => Promise<void>;
  noteClientViewed: (id: string) => Promise<void>;

  addInput: (draft: ClinicalInputDraft, files: NewAttachment[]) => Promise<ClinicalInput>;
  updateInput: (id: string, patch: Partial<ClinicalInput>, summary: string) => Promise<void>;
  markRiskReviewed: (id: string, note?: string) => Promise<void>;
  deleteInput: (id: string) => Promise<void>;

  exportClientRecord: (clientId: string) => Promise<object>;
}

// Author attribution for change history — resolved from the auth profile at
// unlock time so every write is stamped with the clinician's name.
let cachedAuthor = 'Clinician';
export function setCachedAuthor(name: string) {
  cachedAuthor = name || 'Clinician';
}
function authorName(): string {
  return cachedAuthor;
}

function deriveForClient(inputs: ClinicalInput[]): ClientDerived {
  const sessions = inputs
    .map((i) => i.sessionDate)
    .filter((d): d is string => Boolean(d))
    .sort();
  const entered = inputs.map((i) => i.dateEntered).sort();
  return {
    lastSessionDate: sessions[sessions.length - 1],
    lastInputAt: entered[entered.length - 1],
    riskReviewPending: inputs.filter((i) => i.containsRisk && !i.riskReview && !i.archived).length,
    inputCount: inputs.filter((i) => !i.archived).length,
  };
}

export const useDataStore = create<DataState>((set, get) => ({
  loaded: false,
  clients: [],
  derived: {},
  inputs: {},
  changes: {},
  prefs: DEFAULT_PREFS,

  reset: () =>
    set({ loaded: false, clients: [], derived: {}, inputs: {}, changes: {}, prefs: DEFAULT_PREFS }),

  loadAll: async () => {
    const db = authService.require();
    const profile = await authService.getProfile();
    setCachedAuthor(profile?.name ?? 'Clinician');
    const [clients, allInputs, prefs] = await Promise.all([
      db.listClients(),
      db.listAllInputs(),
      db.getPrefs(),
    ]);
    const derived: Record<string, ClientDerived> = {};
    const inputsByClient: Record<string, ClinicalInput[]> = {};
    for (const client of clients) {
      const clientInputs = allInputs
        .filter((i) => i.clientId === client.id)
        .sort(
          (a, b) =>
            b.dateOfInformation.localeCompare(a.dateOfInformation) ||
            b.dateEntered.localeCompare(a.dateEntered),
        );
      derived[client.id] = deriveForClient(clientInputs);
      inputsByClient[client.id] = clientInputs.filter((i) => !i.archived);
    }
    set({ loaded: true, clients, derived, inputs: inputsByClient, prefs });
  },

  refreshClient: async (clientId) => {
    const db = authService.require();
    const [client, clientInputs, changes] = await Promise.all([
      db.getClient(clientId),
      db.listInputsForClient(clientId, { includeArchived: true }),
      db.listChangesForClient(clientId),
    ]);
    set((state) => ({
      clients: client
        ? state.clients.some((c) => c.id === clientId)
          ? state.clients.map((c) => (c.id === clientId ? client : c))
          : [...state.clients, client]
        : state.clients.filter((c) => c.id !== clientId),
      derived: { ...state.derived, [clientId]: deriveForClient(clientInputs) },
      inputs: { ...state.inputs, [clientId]: clientInputs.filter((i) => !i.archived) },
      changes: { ...state.changes, [clientId]: changes },
    }));
  },

  createClient: async (draft) => {
    const db = authService.require();
    const client = await db.createClient(draft, authorName());
    await get().refreshClient(client.id);
    return client;
  },

  updateClient: async (id, patch, summary) => {
    const db = authService.require();
    await db.updateClient(id, patch, authorName(), summary);
    await get().refreshClient(id);
  },

  setClientRisk: async (id, risk) => {
    const db = authService.require();
    await db.updateClient(
      id,
      { risk },
      authorName(),
      `Risk status set to "${risk.level}"${risk.note ? ` — ${risk.note}` : ''}`,
    );
    await get().refreshClient(id);
  },

  setClientArchived: async (id, archived) => {
    const db = authService.require();
    await db.updateClient(
      id,
      { archived },
      authorName(),
      archived ? 'Client archived' : 'Client restored from archive',
    );
    await get().refreshClient(id);
  },

  deleteClient: async (id) => {
    const db = authService.require();
    await db.deleteClient(id, authorName());
    set((state) => {
      const { [id]: _inputs, ...inputs } = state.inputs;
      const { [id]: _derived, ...derived } = state.derived;
      const { [id]: _changes, ...changes } = state.changes;
      return {
        clients: state.clients.filter((c) => c.id !== id),
        inputs,
        derived,
        changes,
        prefs: {
          ...state.prefs,
          recentlyViewed: state.prefs.recentlyViewed.filter((r) => r.clientId !== id),
        },
      };
    });
    await db.setPrefs(get().prefs);
  },

  noteClientViewed: async (id) => {
    const db = authService.require();
    const prefs = await db.noteClientViewed(id);
    set({ prefs });
  },

  addInput: async (draft, files) => {
    const db = authService.require();
    const input = await db.createInput(draft, files, authorName());
    await get().refreshClient(draft.clientId);
    return input;
  },

  updateInput: async (id, patch, summary) => {
    const db = authService.require();
    const updated = await db.updateInput(id, patch, authorName(), summary);
    await get().refreshClient(updated.clientId);
  },

  markRiskReviewed: async (id, note) => {
    const db = authService.require();
    const updated = await db.markRiskReviewed(id, authorName(), note);
    await get().refreshClient(updated.clientId);
  },

  deleteInput: async (id) => {
    const db = authService.require();
    const existing = await db.getInput(id);
    await db.deleteInput(id, authorName());
    if (existing) await get().refreshClient(existing.clientId);
  },

  exportClientRecord: async (clientId) => {
    const db = authService.require();
    const [client, clientInputs, changes] = await Promise.all([
      db.getClient(clientId),
      db.listInputsForClient(clientId, { includeArchived: true }),
      db.listChangesForClient(clientId, 1000),
    ]);
    await db.audit('export', 'client.export', clientId);
    return {
      format: 'cockpit-client-export',
      version: 1,
      exportedAt: new Date().toISOString(),
      note: 'Unencrypted clinical export. Handle according to your confidentiality obligations.',
      client,
      clinicalInputs: clientInputs.map((i) => ({
        ...i,
        attachments: i.attachments.map((a) => ({ name: a.name, mimeType: a.mimeType, size: a.size })),
      })),
      changeHistory: changes,
    };
  },
}));
