/**
 * EvalRepository — encrypted persistence for custom fictional cases and
 * evaluation runs (main workspace database; all content fictional).
 */
import { newId, nowIso, type AuditCategory } from '../db/schema';
import type { EncryptedStore } from '../storage/encryptedStore';
import { FICTIONAL_CASES } from './fictionalCases';
import type { ClinicianRating, CustomEvalCaseDraft, EvalCase, EvalRun } from './evalSchema';

const C = {
  cases: 'eval-cases',
  runs: 'eval-runs',
} as const;

export interface EvalHost {
  store: EncryptedStore;
  audit: (category: AuditCategory, action: string, detail?: string) => Promise<void>;
}

export class EvalRepository {
  constructor(private host: EvalHost) {}

  private get store() {
    return this.host.store;
  }

  /** Built-in library + custom cases. */
  async listCases(): Promise<EvalCase[]> {
    const custom = await this.store.getAll<EvalCase>(C.cases);
    return [...FICTIONAL_CASES, ...custom.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))];
  }

  async getCase(id: string): Promise<EvalCase | undefined> {
    return (await this.listCases()).find((c) => c.id === id);
  }

  async createCustomCase(draft: CustomEvalCaseDraft, author: string): Promise<EvalCase> {
    const now = nowIso();
    const record: EvalCase = { ...draft, id: newId(), source: 'custom', createdAt: now, updatedAt: now };
    await this.store.put(C.cases, record.id, record);
    await this.host.audit('data', 'eval.case-create', `"${record.title}" by ${author}`);
    return record;
  }

  async deleteCustomCase(id: string, author: string): Promise<void> {
    const existing = await this.store.get<EvalCase>(C.cases, id);
    if (!existing) return; // built-in cases cannot be deleted
    await this.store.remove(C.cases, id);
    await this.host.audit('data', 'eval.case-delete', `"${existing.title}" by ${author}`);
  }

  async saveRun(run: Omit<EvalRun, 'id' | 'createdAt'>): Promise<EvalRun> {
    const record: EvalRun = { ...run, id: newId(), createdAt: nowIso() };
    await this.store.put(C.runs, record.id, record);
    await this.host.audit(
      'data',
      'eval.run',
      `${record.taskType} on "${record.caseTitle}" via ${record.providerType} — score ${record.score}`,
    );
    return record;
  }

  async listRuns(filter: { caseId?: string; taskType?: string } = {}): Promise<EvalRun[]> {
    const all = await this.store.getAll<EvalRun>(C.runs);
    return all
      .filter((r) => (!filter.caseId || r.caseId === filter.caseId) && (!filter.taskType || r.taskType === filter.taskType))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async getRun(id: string): Promise<EvalRun | undefined> {
    return this.store.get<EvalRun>(C.runs, id);
  }

  async rateRun(id: string, rating: ClinicianRating, comment: string | undefined, author: string): Promise<EvalRun> {
    const existing = await this.getRun(id);
    if (!existing) throw new Error('Evaluation run not found');
    const updated: EvalRun = { ...existing, clinicianRating: rating, clinicianComment: comment };
    await this.store.put(C.runs, id, updated);
    await this.host.audit('data', 'eval.rate', `${rating} by ${author}`);
    return updated;
  }

  async deleteRun(id: string): Promise<void> {
    await this.store.remove(C.runs, id);
  }
}
