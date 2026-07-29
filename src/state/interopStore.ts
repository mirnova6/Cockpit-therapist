import { create } from 'zustand';
import { authService } from '../core/auth/authService';
import {
  buildImportPreview,
  commitImport,
  parsePortableFile,
  type ImportConfirmation,
  type ImportPlan,
  type ImportPreview,
  type ParsedImport,
} from '../core/interop/importPreview';
import {
  buildPortableRecord,
  type BuildExportOptions,
  type PortableClientRecord,
} from '../core/interop/portableRecord';
import { useDataStore } from './dataStore';

interface InteropState {
  parsed?: ParsedImport;
  preview?: ImportPreview;
  /** Last import that was actually written, for the confirmation panel. */
  lastImport?: { clientId: string; displayName: string; summary: string };
  reset: () => void;

  buildExport: (
    clientId: string,
    acknowledgedPlaintext: boolean,
    opts?: BuildExportOptions,
  ) => Promise<PortableClientRecord>;

  loadImportFile: (text: string) => Promise<ImportPreview>;
  applyImport: (confirmation: ImportConfirmation) => Promise<{ clientId: string; plan: ImportPlan }>;
}

export const useInteropStore = create<InteropState>((set, get) => ({
  reset: () => set({ parsed: undefined, preview: undefined }),

  buildExport: async (clientId, acknowledgedPlaintext, opts) => {
    const db = authService.require();
    const [client, inputs, facts, assessments, hypotheses] = await Promise.all([
      db.getClient(clientId),
      db.listInputsForClient(clientId, { includeArchived: true }),
      db.structured.listFacts(clientId),
      db.structured.listAssessments(clientId),
      db.structured.listHypotheses(clientId),
    ]);
    if (!client) throw new Error('Client not found.');

    const record = buildPortableRecord(
      { client, inputs, facts, assessments, hypotheses },
      acknowledgedPlaintext,
      opts,
    );
    await db.audit(
      'export',
      'client.portable-export',
      `${clientId} · ${record.counts.clinicalInputs} inputs · ${record.counts.localOnlyExcluded} local-only excluded`,
    );
    return record;
  },

  loadImportFile: async (text) => {
    const parsed = parsePortableFile(text);
    const existing = useDataStore.getState().clients.map((c) => ({ id: c.id, displayName: c.displayName }));
    const preview = buildImportPreview(parsed, existing);
    set({ parsed, preview });
    return preview;
  },

  applyImport: async (confirmation) => {
    const { parsed, preview } = get();
    if (!parsed || !preview) throw new Error('Load and preview a file before importing.');

    // Validates the confirmation. Throws before anything is written.
    const plan = commitImport(parsed, preview, confirmation);

    const db = authService.require();
    const author = confirmation.confirmedByClinician;
    const client = await db.createClient(plan.client, author);

    // Source-input ids are remapped as inputs are created, so imported facts
    // keep real provenance instead of pointing at ids from another workspace.
    const inputIdMap = new Map<string, string>();
    const sourceInputIds = parsed.record.clinicalInputs.map((i) => i.id);
    for (let i = 0; i < plan.inputs.length; i++) {
      const created = await db.createInput({ ...plan.inputs[i], clientId: client.id }, [], author);
      const sourceId = sourceInputIds[i];
      if (sourceId) inputIdMap.set(sourceId, created.id);
    }

    for (const fact of plan.facts) {
      const mapped = inputIdMap.get(fact.sourceInputId);
      // A fact whose source input did not come across has no provenance here.
      if (!mapped) continue;
      await db.structured.createFact({ ...fact, clientId: client.id, sourceInputId: mapped }, author);
    }
    for (const assessment of plan.assessments) {
      await db.structured.createAssessment({ ...assessment, clientId: client.id }, author);
    }
    for (const h of plan.hypotheses) {
      await db.structured.createHypothesis({ ...h, clientId: client.id }, author);
    }

    await db.audit('data', 'client.portable-import', plan.auditSummary);
    await useDataStore.getState().loadAll();
    set({
      parsed: undefined,
      preview: undefined,
      lastImport: { clientId: client.id, displayName: client.displayName, summary: plan.auditSummary },
    });
    return { clientId: client.id, plan };
  },
}));
