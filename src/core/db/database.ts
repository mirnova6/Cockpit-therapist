/**
 * ClinicalDatabase — repository facade over the encrypted store.
 * One instance exists per unlocked session; locking discards it.
 */
import { AiRepository } from '../ai/aiRepository';
import { BetaRepository } from '../beta/betaRepository';
import { EvalRepository } from '../eval/evalRepository';
import { GovernanceRepository } from '../governance/governanceRepository';
import { KnowledgeRepository } from '../knowledge/knowledgeRepository';
import { DiagnosticsRepository } from '../observability/diagnostics';
import { OrgRepository } from '../org/orgService';
import { EncryptedStore } from '../storage/encryptedStore';
import type { StorageAdapter } from '../storage/indexedDbAdapter';
import { DocumentsRepository } from './documentsRepository';
import { IntelligenceRepository } from './intelligenceRepository';
import { StructuredRepository } from './structuredRepository';
import {
  DEFAULT_PREFS,
  newId,
  nowIso,
  type AuditCategory,
  type AuditEvent,
  type AttachmentRef,
  type ChangeRecord,
  type Client,
  type ClinicalInput,
  type UserPrefs,
} from './schema';

const COLLECTIONS = {
  clients: 'clients',
  inputs: 'inputs',
  changes: 'changes',
  audit: 'audit',
  prefs: 'prefs',
} as const;

export interface NewAttachment {
  name: string;
  mimeType: string;
  bytes: import('../crypto/cryptoService').Bytes;
}

export type ClientDraft = Omit<Client, 'id' | 'createdAt' | 'updatedAt' | 'archived'>;

export type ClinicalInputDraft = Omit<
  ClinicalInput,
  'id' | 'dateEntered' | 'attachments' | 'processingStatus' | 'version' | 'archived' | 'updatedAt'
>;

export class ClinicalDatabase {
  readonly store: EncryptedStore;
  /** Phase 2 structured clinical data (facts, assessments, hypotheses, …). */
  readonly structured: StructuredRepository;
  /** Phase 3 clinical documents (DAP notes, treatment plans, goals). */
  readonly documents: DocumentsRepository;
  /** Phase 4 AI settings, operations log, and clinician feedback. */
  readonly ai: AiRepository;
  /** Phase 4 clinician-managed clinical knowledge base (workspace-level). */
  readonly knowledge: KnowledgeRepository;
  /** Phase 4 formulations, strategies, update summaries, assistant threads. */
  readonly intelligence: IntelligenceRepository;
  /** Phase 5 evaluation harness (fictional cases + runs; sandboxed execution). */
  readonly evaluation: EvalRepository;
  /** Phase 5 governance: provider approvals, readiness checklist, embeddings. */
  readonly governance: GovernanceRepository;
  /** Phase 8 beta testing: mode state, guided checklist, PHI-free bug reports. */
  readonly beta: BetaRepository;
  /** Phase 9 organizations, workspaces, users, memberships, supervision. */
  readonly org: OrgRepository;
  /** Phase 9 PHI-free operational diagnostics. */
  readonly diagnostics: DiagnosticsRepository;

  constructor(
    readonly adapter: StorageAdapter,
    dek: CryptoKey,
  ) {
    this.store = new EncryptedStore(adapter, dek);
    this.documents = new DocumentsRepository({
      store: this.store,
      audit: (category, action, detail) => this.audit(category, action, detail),
    });
    this.ai = new AiRepository({
      store: this.store,
      audit: (category, action, detail) => this.audit(category, action, detail),
    });
    this.knowledge = new KnowledgeRepository({
      store: this.store,
      audit: (category, action, detail) => this.audit(category, action, detail),
    });
    this.intelligence = new IntelligenceRepository({
      store: this.store,
      audit: (category, action, detail) => this.audit(category, action, detail),
    });
    this.evaluation = new EvalRepository({
      store: this.store,
      audit: (category, action, detail) => this.audit(category, action, detail),
    });
    this.governance = new GovernanceRepository({
      store: this.store,
      audit: (category, action, detail) => this.audit(category, action, detail),
    });
    this.beta = new BetaRepository({
      store: this.store,
      audit: (category, action, detail) => this.audit(category, action, detail),
    });
    this.org = new OrgRepository({
      store: this.store,
      audit: (category, action, detail) => this.audit(category, action, detail),
    });
    this.diagnostics = new DiagnosticsRepository({ store: this.store });
    this.structured = new StructuredRepository({
      store: this.store,
      audit: (category, action, detail) => this.audit(category, action, detail),
      getInputMeta: async (id) => {
        const input = await this.getInput(id);
        return input ? { clientId: input.clientId, version: input.version } : undefined;
      },
    });
  }

  // ------------------------------------------------------------ audit

  async audit(category: AuditCategory, action: string, detail?: string): Promise<void> {
    const event: AuditEvent = { id: newId(), at: nowIso(), category, action, detail };
    await this.store.put(COLLECTIONS.audit, event.id, event);
  }

  async listAudit(limit = 50): Promise<AuditEvent[]> {
    const events = await this.store.getAll<AuditEvent>(COLLECTIONS.audit);
    return events.sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit);
  }

  // ---------------------------------------------------- change history

  private async recordChange(change: Omit<ChangeRecord, 'id' | 'at'>): Promise<void> {
    const record: ChangeRecord = { ...change, id: newId(), at: nowIso() };
    await this.store.put(COLLECTIONS.changes, record.id, record);
  }

  async listChangesForClient(clientId: string, limit = 50): Promise<ChangeRecord[]> {
    const all = await this.store.getAll<ChangeRecord>(COLLECTIONS.changes);
    return all
      .filter((c) => c.clientId === clientId)
      .sort((a, b) => b.at.localeCompare(a.at))
      .slice(0, limit);
  }

  // ---------------------------------------------------------- clients

  async listClients(): Promise<Client[]> {
    return this.store.getAll<Client>(COLLECTIONS.clients);
  }

  async getClient(id: string): Promise<Client | undefined> {
    return this.store.get<Client>(COLLECTIONS.clients, id);
  }

  async createClient(draft: ClientDraft, author: string): Promise<Client> {
    const now = nowIso();
    const client: Client = {
      ...draft,
      id: newId(),
      createdAt: now,
      updatedAt: now,
      archived: false,
    };
    await this.store.put(COLLECTIONS.clients, client.id, client);
    await this.recordChange({
      clientId: client.id,
      entity: 'client',
      entityId: client.id,
      action: 'created',
      summary: `Client record created (${client.displayName})`,
      author,
    });
    await this.audit('data', 'client.create', client.id);
    return client;
  }

  async updateClient(
    id: string,
    patch: Partial<Omit<Client, 'id' | 'createdAt'>>,
    author: string,
    summary: string,
  ): Promise<Client> {
    const existing = await this.getClient(id);
    if (!existing) throw new Error('Client not found');
    const updated: Client = { ...existing, ...patch, id, updatedAt: nowIso() };
    await this.store.put(COLLECTIONS.clients, id, updated);
    await this.recordChange({
      clientId: id,
      entity: 'client',
      entityId: id,
      action: patch.archived === true ? 'archived' : patch.archived === false && existing.archived ? 'restored' : 'updated',
      summary,
      author,
    });
    await this.audit('data', 'client.update', id);
    return updated;
  }

  /** Permanently removes the client and every associated record and blob. */
  async deleteClient(id: string, author: string): Promise<void> {
    await this.governance.deleteAllForClient(id);
    await this.intelligence.deleteAllForClient(id);
    await this.ai.deleteAllForClient(id);
    await this.documents.deleteAllForClient(id);
    await this.structured.deleteAllForClient(id);
    const inputs = await this.listInputsForClient(id, { includeArchived: true });
    for (const input of inputs) {
      for (const attachment of input.attachments) {
        await this.store.removeBlob(attachment.id);
      }
      await this.store.remove(COLLECTIONS.inputs, input.id);
    }
    const changes = await this.store.getAll<ChangeRecord>(COLLECTIONS.changes);
    for (const change of changes.filter((c) => c.clientId === id)) {
      await this.store.remove(COLLECTIONS.changes, change.id);
    }
    await this.store.remove(COLLECTIONS.clients, id);
    await this.audit('data', 'client.delete', `deleted by ${author}`);
  }

  // ---------------------------------------------------------- inputs

  async listInputsForClient(
    clientId: string,
    opts: { includeArchived?: boolean } = {},
  ): Promise<ClinicalInput[]> {
    const all = await this.store.getAll<ClinicalInput>(COLLECTIONS.inputs);
    return all
      .filter((i) => i.clientId === clientId && (opts.includeArchived || !i.archived))
      .sort((a, b) => b.dateOfInformation.localeCompare(a.dateOfInformation) || b.dateEntered.localeCompare(a.dateEntered));
  }

  async listAllInputs(): Promise<ClinicalInput[]> {
    return this.store.getAll<ClinicalInput>(COLLECTIONS.inputs);
  }

  async getInput(id: string): Promise<ClinicalInput | undefined> {
    return this.store.get<ClinicalInput>(COLLECTIONS.inputs, id);
  }

  async createInput(
    draft: ClinicalInputDraft,
    files: NewAttachment[],
    author: string,
  ): Promise<ClinicalInput> {
    const attachments: AttachmentRef[] = [];
    for (const file of files) {
      const blobId = newId();
      await this.store.putBlob(blobId, file.bytes);
      attachments.push({ id: blobId, name: file.name, mimeType: file.mimeType, size: file.bytes.length });
    }
    const input: ClinicalInput = {
      ...draft,
      id: newId(),
      dateEntered: nowIso(),
      attachments,
      processingStatus: 'stored',
      version: 1,
      archived: false,
      updatedAt: nowIso(),
    };
    await this.store.put(COLLECTIONS.inputs, input.id, input);
    await this.recordChange({
      clientId: input.clientId,
      entity: 'clinical-input',
      entityId: input.id,
      action: 'created',
      summary: `Added ${input.inputType.replace(/-/g, ' ')}${input.containsRisk ? ' (flagged: contains risk information)' : ''}`,
      author,
    });
    await this.audit('data', 'input.create', input.id);
    return input;
  }

  async updateInput(
    id: string,
    patch: Partial<Omit<ClinicalInput, 'id' | 'clientId' | 'dateEntered' | 'version'>>,
    author: string,
    summary: string,
  ): Promise<ClinicalInput> {
    const existing = await this.getInput(id);
    if (!existing) throw new Error('Clinical input not found');
    const updated: ClinicalInput = {
      ...existing,
      ...patch,
      id,
      version: existing.version + 1,
      updatedAt: nowIso(),
    };
    await this.store.put(COLLECTIONS.inputs, id, updated);
    await this.recordChange({
      clientId: existing.clientId,
      entity: 'clinical-input',
      entityId: id,
      action: patch.archived === true ? 'archived' : 'updated',
      summary,
      author,
    });
    await this.audit('data', 'input.update', id);
    return updated;
  }

  async markRiskReviewed(id: string, reviewedBy: string, note?: string): Promise<ClinicalInput> {
    const existing = await this.getInput(id);
    if (!existing) throw new Error('Clinical input not found');
    const updated: ClinicalInput = {
      ...existing,
      riskReview: { reviewedBy, reviewedAt: nowIso(), note },
      version: existing.version + 1,
      updatedAt: nowIso(),
    };
    await this.store.put(COLLECTIONS.inputs, id, updated);
    await this.recordChange({
      clientId: existing.clientId,
      entity: 'clinical-input',
      entityId: id,
      action: 'risk-reviewed',
      summary: 'Risk-flagged entry reviewed by clinician',
      author: reviewedBy,
    });
    await this.audit('data', 'input.risk-reviewed', id);
    return updated;
  }

  async deleteInput(id: string, author: string): Promise<void> {
    const existing = await this.getInput(id);
    if (!existing) return;
    for (const attachment of existing.attachments) {
      await this.store.removeBlob(attachment.id);
    }
    await this.store.remove(COLLECTIONS.inputs, id);
    await this.recordChange({
      clientId: existing.clientId,
      entity: 'clinical-input',
      entityId: id,
      action: 'deleted',
      summary: `Deleted ${existing.inputType.replace(/-/g, ' ')} dated ${existing.dateOfInformation}`,
      author,
    });
    await this.audit('data', 'input.delete', id);
  }

  async getAttachmentBytes(blobId: string): Promise<Uint8Array | undefined> {
    return this.store.getBlob(blobId);
  }

  // ----------------------------------------------------------- prefs

  async getPrefs(): Promise<UserPrefs> {
    return (await this.store.get<UserPrefs>(COLLECTIONS.prefs, 'prefs')) ?? DEFAULT_PREFS;
  }

  async setPrefs(prefs: UserPrefs): Promise<void> {
    await this.store.put(COLLECTIONS.prefs, 'prefs', prefs);
  }

  async noteClientViewed(clientId: string): Promise<UserPrefs> {
    const prefs = await this.getPrefs();
    const rest = prefs.recentlyViewed.filter((r) => r.clientId !== clientId);
    const next: UserPrefs = {
      ...prefs,
      recentlyViewed: [{ clientId, at: nowIso() }, ...rest].slice(0, 8),
    };
    await this.setPrefs(next);
    return next;
  }
}
