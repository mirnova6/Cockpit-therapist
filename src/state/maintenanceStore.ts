import { create } from 'zustand';
import { authService } from '../core/auth/authService';
import {
  type FeedbackPriority,
  type FeedbackStatus,
  type TriageDashboard,
  type TriageDraft,
  type TriageItem,
} from '../core/beta/feedbackTriage';
import {
  buildDiagnosticExport,
  type DiagnosticEvent,
  type DiagnosticExport,
} from '../core/observability/diagnostics';
import {
  CURRENT_SCHEMA_VERSION,
  readSchemaVersion,
  runMigrations,
  validateEnvelopes,
  type MigrationPlanResult,
} from '../core/storage/migrations';

interface MaintenanceState {
  triage: TriageItem[];
  dashboard?: TriageDashboard;
  diagnostics: DiagnosticEvent[];
  schemaVersion?: number;
  currentSchemaVersion: number;
  migrationPlan?: MigrationPlanResult;
  envelopeCheck?: { checked: number; invalid: string[] };

  loadAll: () => Promise<void>;

  createTriage: (draft: TriageDraft) => Promise<TriageItem>;
  updateTriage: (
    id: string,
    patch: { status?: FeedbackStatus; priority?: FeedbackPriority; resolutionNotes?: string; linkedCommit?: string; linkedRelease?: string },
  ) => Promise<void>;
  deleteTriage: (id: string) => Promise<void>;

  previewMigrations: () => Promise<MigrationPlanResult>;
  applyMigrations: (backupConfirmed: boolean) => Promise<MigrationPlanResult>;
  checkEnvelopes: () => Promise<{ checked: number; invalid: string[] }>;

  exportDiagnostics: (noPhiConfirmed: boolean) => DiagnosticExport;
  clearDiagnostics: () => Promise<number>;
}

export const useMaintenanceStore = create<MaintenanceState>((set, get) => ({
  triage: [],
  diagnostics: [],
  currentSchemaVersion: CURRENT_SCHEMA_VERSION,

  loadAll: async () => {
    const db = authService.require();
    const [triage, dashboard, diagnostics, schemaVersion] = await Promise.all([
      db.triage.list(),
      db.triage.dashboard(),
      db.diagnostics.list(),
      readSchemaVersion(db.adapter),
    ]);
    set({ triage, dashboard, diagnostics, schemaVersion });
  },

  createTriage: async (draft) => {
    const db = authService.require();
    const item = await db.triage.create(draft);
    await get().loadAll();
    return item;
  },

  updateTriage: async (id, patch) => {
    const db = authService.require();
    await db.triage.update(id, patch);
    await get().loadAll();
  },

  deleteTriage: async (id) => {
    const db = authService.require();
    await db.triage.remove(id);
    await get().loadAll();
  },

  previewMigrations: async () => {
    const db = authService.require();
    const plan = await runMigrations(db.adapter, { dryRun: true });
    set({ migrationPlan: plan });
    return plan;
  },

  applyMigrations: async (backupConfirmed) => {
    const db = authService.require();
    const plan = await runMigrations(db.adapter, { dryRun: false, backupConfirmed });
    await db.audit(
      'data',
      'schema.migrated',
      `${plan.fromVersion} → ${plan.toVersion} (${plan.migrations.length} migration(s), ${plan.totalChanges} record change(s))`,
    );
    await get().loadAll();
    set({ migrationPlan: plan });
    return plan;
  },

  checkEnvelopes: async () => {
    const db = authService.require();
    const result = await validateEnvelopes(db.adapter);
    set({ envelopeCheck: result });
    return result;
  },

  exportDiagnostics: (noPhiConfirmed) => buildDiagnosticExport(get().diagnostics, noPhiConfirmed),

  clearDiagnostics: async () => {
    const db = authService.require();
    const removed = await db.diagnostics.clear();
    await get().loadAll();
    return removed;
  },
}));
