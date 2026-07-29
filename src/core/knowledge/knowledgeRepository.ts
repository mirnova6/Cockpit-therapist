/**
 * KnowledgeRepository — encrypted persistence and approval workflow for the
 * clinician-managed knowledge base.
 *
 * Retrieval-facing reads return ONLY clinician-approved, non-expired
 * sources; the repository enforces that regardless of the UI (§6).
 */
import { newId, nowIso, type AuditCategory } from '../db/schema';
import type { EncryptedStore } from '../storage/encryptedStore';
import {
  chunkKnowledgeText,
  type KnowledgeChunk,
  type KnowledgeSource,
  type KnowledgeStatus,
  type KnowledgeUse,
} from './knowledgeSchema';

const C = {
  sources: 'knowledge-sources',
  chunks: 'knowledge-chunks',
} as const;

export interface KnowledgeHost {
  store: EncryptedStore;
  audit: (category: AuditCategory, action: string, detail?: string) => Promise<void>;
}

export type KnowledgeSourceDraft = Omit<
  KnowledgeSource,
  'id' | 'dateAdded' | 'status' | 'hasText' | 'chunkCount' | 'createdAt' | 'updatedAt' | 'version'
>;

export class KnowledgeRepository {
  constructor(private host: KnowledgeHost) {}

  private get store() {
    return this.host.store;
  }

  // ------------------------------------------------------------- sources

  async listSources(): Promise<KnowledgeSource[]> {
    const all = await this.store.getAll<KnowledgeSource>(C.sources);
    return all.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async getSource(id: string): Promise<KnowledgeSource | undefined> {
    return this.store.get<KnowledgeSource>(C.sources, id);
  }

  /**
   * Creates a source in 'pending-review'; text (when supplied) is chunked
   * immediately but stays unusable until the clinician approves the source.
   */
  async createSource(
    draft: KnowledgeSourceDraft,
    text: string | undefined,
    author: string,
    fileBytes?: { name: string; mimeType: string; bytes: import('../crypto/cryptoService').Bytes },
  ): Promise<KnowledgeSource> {
    const now = nowIso();
    let fileBlobId: string | undefined;
    if (fileBytes) {
      fileBlobId = newId();
      await this.store.putBlob(fileBlobId, fileBytes.bytes);
    }
    const source: KnowledgeSource = {
      ...draft,
      id: newId(),
      dateAdded: now.slice(0, 10),
      status: 'pending-review',
      fileBlobId: fileBlobId ?? draft.fileBlobId,
      fileName: fileBytes?.name ?? draft.fileName,
      hasText: false,
      chunkCount: 0,
      createdAt: now,
      updatedAt: now,
      version: 1,
    };
    await this.store.put(C.sources, source.id, source);
    if (text?.trim()) {
      await this.replaceText(source.id, text, author);
    }
    await this.host.audit('data', 'knowledge.create', `"${source.title}" by ${author}`);
    return (await this.getSource(source.id))!;
  }

  async updateSource(
    id: string,
    patch: Partial<Omit<KnowledgeSource, 'id' | 'createdAt' | 'version' | 'chunkCount' | 'hasText'>>,
    author: string,
  ): Promise<KnowledgeSource> {
    const existing = await this.getSource(id);
    if (!existing) throw new Error('Knowledge source not found');
    const updated: KnowledgeSource = {
      ...existing,
      ...patch,
      id,
      updatedAt: nowIso(),
      version: existing.version + 1,
    };
    await this.store.put(C.sources, id, updated);
    await this.host.audit('data', 'knowledge.update', `"${updated.title}" by ${author}`);
    return updated;
  }

  /** Replaces the retrievable text: re-chunks deterministically. */
  async replaceText(id: string, text: string, author: string): Promise<KnowledgeSource> {
    const existing = await this.getSource(id);
    if (!existing) throw new Error('Knowledge source not found');
    await this.removeChunks(id);
    const { chunks } = chunkKnowledgeText(text);
    for (const chunk of chunks) {
      const record: KnowledgeChunk = { ...chunk, id: newId(), sourceId: id };
      await this.store.put(C.chunks, record.id, record);
    }
    const updated: KnowledgeSource = {
      ...existing,
      hasText: chunks.length > 0,
      chunkCount: chunks.length,
      updatedAt: nowIso(),
      version: existing.version + 1,
    };
    await this.store.put(C.sources, id, updated);
    await this.host.audit('data', 'knowledge.rechunk', `"${existing.title}" → ${chunks.length} chunks by ${author}`);
    return updated;
  }

  /**
   * Status transitions (approval workflow). Approving stamps dateReviewed;
   * superseding links the replacement.
   */
  async setStatus(
    id: string,
    status: KnowledgeStatus,
    author: string,
    opts: { supersededBy?: string; note?: string } = {},
  ): Promise<KnowledgeSource> {
    const existing = await this.getSource(id);
    if (!existing) throw new Error('Knowledge source not found');
    const updated: KnowledgeSource = {
      ...existing,
      status,
      dateReviewed: status === 'approved' ? nowIso().slice(0, 10) : existing.dateReviewed,
      supersededBy: opts.supersededBy ?? existing.supersededBy,
      clinicianNotes: opts.note ?? existing.clinicianNotes,
      updatedAt: nowIso(),
      version: existing.version + 1,
    };
    await this.store.put(C.sources, id, updated);
    await this.host.audit('data', `knowledge.${status}`, `"${existing.title}" by ${author}`);
    return updated;
  }

  async deleteSource(id: string, author: string): Promise<void> {
    const existing = await this.getSource(id);
    if (!existing) return;
    await this.removeChunks(id);
    if (existing.fileBlobId) await this.store.removeBlob(existing.fileBlobId);
    await this.store.remove(C.sources, id);
    await this.host.audit('data', 'knowledge.delete', `"${existing.title}" by ${author}`);
  }

  private async removeChunks(sourceId: string): Promise<void> {
    const chunks = await this.store.getAll<KnowledgeChunk>(C.chunks);
    for (const chunk of chunks.filter((c) => c.sourceId === sourceId)) {
      await this.store.remove(C.chunks, chunk.id);
    }
  }

  // -------------------------------------------------------------- chunks

  async listChunks(sourceId: string): Promise<KnowledgeChunk[]> {
    const all = await this.store.getAll<KnowledgeChunk>(C.chunks);
    return all.filter((c) => c.sourceId === sourceId).sort((a, b) => a.seq - b.seq);
  }

  /**
   * The ONLY read used by retrieval: chunks of clinician-APPROVED sources
   * that are not past their re-review date and whose allowed uses cover the
   * requested purpose. Rejected/outdated/superseded/archived material can
   * never reach a recommendation through this path.
   */
  async listRetrievableChunks(
    use: KnowledgeUse,
    today = nowIso().slice(0, 10),
  ): Promise<Array<{ chunk: KnowledgeChunk; source: KnowledgeSource }>> {
    const [sources, chunks] = await Promise.all([
      this.store.getAll<KnowledgeSource>(C.sources),
      this.store.getAll<KnowledgeChunk>(C.chunks),
    ]);
    const eligible = new Map(
      sources
        .filter(
          (s) =>
            s.status === 'approved' &&
            (!s.reviewDueDate || s.reviewDueDate >= today) &&
            !s.excludedUses.includes(use) &&
            (s.allowedUses.length === 0 || s.allowedUses.includes(use)),
        )
        .map((s) => [s.id, s]),
    );
    return chunks
      .filter((c) => eligible.has(c.sourceId))
      .map((chunk) => ({ chunk, source: eligible.get(chunk.sourceId)! }));
  }
}
