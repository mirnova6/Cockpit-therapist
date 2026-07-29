import { create } from 'zustand';
import { authService } from '../core/auth/authService';
import { generateBetaReport, type BetaTestReport } from '../core/beta/betaReport';
import type {
  BetaCheckItem,
  BetaCheckStatus,
  BetaFeedback,
  BetaFeedbackDraft,
  BetaState,
  BugReport,
  BugReportDraft,
} from '../core/beta/betaSchema';
import { seedBetaWorkspace } from '../core/beta/sampleData';
import { measureWorkspace, type PerfSample } from '../core/perf/perfHarness';
import { useDataStore } from './dataStore';

interface BetaStoreState {
  state?: BetaState;
  checklist: BetaCheckItem[];
  bugReports: BugReport[];
  feedback: BetaFeedback[];
  report?: BetaTestReport;
  perf?: PerfSample[];
  busy: boolean;

  reset: () => void;
  load: () => Promise<void>;
  setEnabled: (enabled: boolean) => Promise<void>;
  loadSampleData: () => Promise<number>;
  updateCheck: (id: string, patch: { status?: BetaCheckStatus; notes?: string }) => Promise<void>;
  addBugReport: (draft: BugReportDraft) => Promise<void>;
  deleteBugReport: (id: string) => Promise<void>;
  addFeedback: (draft: BetaFeedbackDraft) => Promise<void>;
  buildReport: () => Promise<BetaTestReport>;
  measurePerformance: () => Promise<PerfSample[]>;
}

export const useBetaStore = create<BetaStoreState>((set) => ({
  checklist: [],
  bugReports: [],
  feedback: [],
  busy: false,

  reset: () =>
    set({ state: undefined, checklist: [], bugReports: [], feedback: [], report: undefined, perf: undefined, busy: false }),

  load: async () => {
    const db = authService.current();
    if (!db) return;
    const [state, checklist, bugReports, feedback] = await Promise.all([
      db.beta.getState(),
      db.beta.listChecklist(),
      db.beta.listBugReports(),
      db.beta.listFeedback(),
    ]);
    set({ state, checklist, bugReports, feedback });
  },

  setEnabled: async (enabled) => {
    const db = authService.require();
    const state = await db.beta.setEnabled(enabled);
    set({ state });
  },

  loadSampleData: async () => {
    const db = authService.require();
    set({ busy: true });
    try {
      const { clientIds } = await seedBetaWorkspace(db);
      const state = await db.beta.markSampleLoaded(clientIds);
      set({ state });
      // Refresh the client list so the seeded fictional clients appear.
      await useDataStore.getState().loadAll();
      return clientIds.length;
    } finally {
      set({ busy: false });
    }
  },

  updateCheck: async (id, patch) => {
    const db = authService.require();
    await db.beta.updateCheck(id, patch);
    set({ checklist: await db.beta.listChecklist() });
  },

  addBugReport: async (draft) => {
    const db = authService.require();
    await db.beta.addBugReport(draft);
    set({ bugReports: await db.beta.listBugReports() });
  },

  deleteBugReport: async (id) => {
    const db = authService.require();
    await db.beta.deleteBugReport(id);
    set({ bugReports: await db.beta.listBugReports() });
  },

  addFeedback: async (draft) => {
    const db = authService.require();
    await db.beta.addFeedback(draft);
    set({ feedback: await db.beta.listFeedback() });
  },

  buildReport: async () => {
    const db = authService.require();
    const report = await generateBetaReport(db);
    set({ report });
    return report;
  },

  measurePerformance: async () => {
    const db = authService.require();
    set({ busy: true });
    try {
      const perf = await measureWorkspace(db);
      set({ perf });
      return perf;
    } finally {
      set({ busy: false });
    }
  },
}));
