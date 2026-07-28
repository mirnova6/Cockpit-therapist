/**
 * Embedding service (§16) — generation, regeneration, semantic preview
 * search, and secure deletion of client-namespaced embeddings.
 *
 * Online embedding of client content passes the SAME gates as online AI:
 * per-input consent + local-only flags, per-client local-only override,
 * master switch, PHI attestation, kill switch, approval registry, and an
 * explicit clinician confirmation. Vectors are stored encrypted, excluded
 * from client exports, and deleted with the client.
 */
import { evaluateConsent } from '../ai/aiGateway';
import { getProviderByType } from '../ai/providerRegistry';
import type { AiSettings } from '../ai/aiSchema';
import type { ClinicalDatabase } from '../db/database';
import {
  buildClientCorpus,
  retrieveClientEvidence,
  type ClientRetrievalResult,
} from '../rag/clientRetrieval';
import { semanticKey, type HybridWeights, type RetrievalMode } from '../rag/hybridRetrieval';
import { rankByLexicalRelevance } from '../rag/lexical';
import {
  activeEmbeddingProvider,
  cosineSimilarity,
} from './embeddingProviders';

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export class EmbeddingRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EmbeddingRefusedError';
  }
}

export interface GenerateEmbeddingsResult {
  generated: number;
  skippedNoConsent: number;
  providerId: string;
  modelId: string;
}

/**
 * (Re)generates embeddings for one client's corpus. Regeneration deletes
 * the namespace first, so vectors are always rebuildable from source.
 */
export async function generateClientEmbeddings(
  db: ClinicalDatabase,
  settings: AiSettings,
  clientId: string,
  opts: { onlineSendConfirmed?: boolean; signal?: AbortSignal } = {},
): Promise<GenerateEmbeddingsResult> {
  const provider = activeEmbeddingProvider(settings);
  if (provider.providerType === 'none') {
    throw new EmbeddingRefusedError(
      'No embedding provider is configured — semantic retrieval is not active and no vectors can be generated.',
    );
  }
  const readiness = await provider.checkReadiness(settings);
  if (!readiness.ready) throw new EmbeddingRefusedError(readiness.detail);

  const { candidates } = await buildClientCorpus(db, clientId);
  const client = await db.getClient(clientId);

  if (provider.providerType === 'online') {
    if (client?.aiLocalOnly) {
      throw new EmbeddingRefusedError('This client is marked local-only; content cannot be sent to an online embeddings endpoint.');
    }
    // Reuse the exact online consent gate (kill switch, master switch, PHI
    // attestation, per-input consent + local-only flags).
    const consent = evaluateConsent(
      settings,
      getProviderByType('online'),
      candidates
        .filter((c) => c.inputId)
        .map((c) => ({ id: c.inputId!, allowAiAnalysis: c.allowAiAnalysis ?? false, localOnly: c.localOnly ?? false })),
    );
    if (!consent.ok) throw new EmbeddingRefusedError(consent.reason ?? 'Online embedding refused.');
    const approval = await db.governance.approvalFor(provider.id);
    if (approval && approval.approvalStatus !== 'approved') {
      throw new EmbeddingRefusedError(`Provider "${approval.providerName}" is ${approval.approvalStatus} in the approval registry.`);
    }
    if (!opts.onlineSendConfirmed) {
      throw new EmbeddingRefusedError('The outbound preview has not been confirmed. Review what will leave the device first.');
    }
  } else {
    // Local embedding still honors per-input AI consent.
    const unconsented = candidates.filter((c) => c.inputId && c.allowAiAnalysis === false);
    if (unconsented.length > 0) {
      throw new EmbeddingRefusedError(
        `${unconsented.length} input(s) lack AI-analysis consent. Update the consent flags or exclude those entries.`,
      );
    }
  }

  await db.governance.deleteEmbeddingsForClient(clientId);

  const embeddable = candidates.filter((c) => c.text.trim().length > 0).slice(0, 300);
  const vectors = await provider.embed(embeddable.map((c) => c.text.slice(0, 2000)), settings, opts.signal);
  const modelId = provider.providerType === 'online' ? settings.embeddingOnlineModel : settings.embeddingLocalModel;

  for (let i = 0; i < embeddable.length; i++) {
    await db.governance.putEmbedding({
      clientId,
      refType: embeddable[i].refType,
      refId: embeddable[i].refId,
      providerId: provider.id,
      modelId,
      dimension: vectors[i].length,
      vector: vectors[i],
      textHash: await sha256Hex(embeddable[i].text),
    });
  }

  await db.ai.logOperation({
    clientId,
    capability: 'knowledge-assistance',
    providerType: provider.providerType === 'online' ? 'online' : 'local',
    providerId: provider.id,
    modelId,
    providerVersion: 'embeddings/v1',
    mode: provider.providerType === 'online' ? 'online' : 'local',
    selectedSources: embeddable.map((c) => `${c.refType}:${c.refId}`).slice(0, 50),
    knowledgeSources: [],
    outputSchemaVersion: 'embedding-record/1',
    phiLeftDevice: provider.providerType === 'online',
    redactionApplied: false,
    consentStatus: provider.providerType === 'online' ? 'verified' : 'not-required-local',
    reviewStatus: 'not-applicable',
    status: 'completed',
  });

  return {
    generated: embeddable.length,
    skippedNoConsent: candidates.length - embeddable.length,
    providerId: provider.id,
    modelId,
  };
}

export interface SemanticSearchRow {
  refType: string;
  refId: string;
  similarity: number;
}

/**
 * Semantic preview search over ONE client's stored vectors. Verifies every
 * returned row belongs to the requested namespace.
 */
export async function semanticPreviewSearch(
  db: ClinicalDatabase,
  settings: AiSettings,
  clientId: string,
  query: string,
  opts: { onlineSendConfirmed?: boolean } = {},
): Promise<SemanticSearchRow[]> {
  const provider = activeEmbeddingProvider(settings);
  if (provider.providerType === 'none') {
    throw new EmbeddingRefusedError('No embedding provider is configured — semantic search is not active.');
  }
  if (provider.providerType === 'online' && !opts.onlineSendConfirmed) {
    throw new EmbeddingRefusedError('Confirm the outbound preview: the query text would leave this device.');
  }
  const stored = await db.governance.listEmbeddings(clientId);
  if (stored.length === 0) return [];
  const [queryVector] = await provider.embed([query], settings);
  return stored
    .filter((e) => e.clientId === clientId) // namespace re-verified
    .map((e) => ({ refType: e.refType, refId: e.refId, similarity: Math.round(cosineSimilarity(queryVector, e.vector) * 1000) / 1000 }))
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, 10);
}

/** Lexical comparison rows for the preview panel (same corpus, no vectors). */
export async function lexicalPreviewSearch(
  db: ClinicalDatabase,
  clientId: string,
  query: string,
): Promise<Array<{ refType: string; refId: string; score: number }>> {
  const { candidates } = await buildClientCorpus(db, clientId);
  return rankByLexicalRelevance(query, candidates, (c) => c.text)
    .slice(0, 10)
    .map(({ doc, score }) => ({ refType: doc.refType, refId: doc.refId, score: Math.round(score * 1000) / 1000 }));
}

// ------------------------------------------------- Phase 9 hybrid retrieval

export interface HybridRetrievalOptions {
  mode?: RetrievalMode;
  weights?: Partial<HybridWeights>;
  limit?: number;
  today?: string;
  includePendingFactIds?: string[];
  organizationId?: string;
  /**
   * Clinician activation gate. Hybrid/semantic ranking stays OFF until this is
   * true, even when a provider is configured — activation is a deliberate act
   * taken after reviewing evaluation results.
   */
  activated?: boolean;
  onlineSendConfirmed?: boolean;
}

/**
 * Retrieve with hybrid ranking. Computes semantic similarity ONLY when a real
 * embedding provider is configured, vectors exist for the client, and the
 * clinician has activated hybrid/semantic mode; otherwise it retrieves
 * lexically and reports the downgrade honestly in `debug.modeDowngradedReason`.
 *
 * Semantic scores are joined to candidates by (refType, refId), so lexical
 * ranking still covers candidates that have no vector — exact wording, dates,
 * medications, assessment names and quotations remain discoverable.
 */
export async function retrieveHybrid(
  db: ClinicalDatabase,
  settings: AiSettings,
  clientId: string,
  query: string,
  opts: HybridRetrievalOptions = {},
): Promise<ClientRetrievalResult> {
  const requested: RetrievalMode = opts.mode ?? 'lexical';
  let semanticScores: Map<string, number> | undefined;

  if (requested !== 'lexical' && opts.activated) {
    const provider = activeEmbeddingProvider(settings);
    if (provider.providerType !== 'none') {
      // Online embedding of the QUERY obeys the same outbound gate as any send.
      if (provider.providerType !== 'online' || opts.onlineSendConfirmed) {
        const stored = await db.governance.listEmbeddings(clientId);
        // Post-retrieval namespace check: a vector from another client (or
        // another organization) must never influence ranking.
        const foreign = stored.filter((e) => e.clientId !== clientId);
        if (foreign.length > 0) {
          await db.audit(
            'security',
            'ai.embedding-isolation-violation',
            `blocked ${foreign.length} foreign vector(s) for client ${clientId}`,
          );
          throw new EmbeddingRefusedError(
            'Semantic retrieval blocked: a stored vector belonged to another client.',
          );
        }
        if (stored.length > 0) {
          const [queryVector] = await provider.embed([query], settings);
          semanticScores = new Map(
            stored.map((e) => [semanticKey(e.refType, e.refId), cosineSimilarity(queryVector, e.vector)]),
          );
        }
      }
    }
  }

  return retrieveClientEvidence(db, clientId, query, {
    limit: opts.limit,
    today: opts.today,
    includePendingFactIds: opts.includePendingFactIds,
    organizationId: opts.organizationId,
    mode: requested,
    weights: opts.weights,
    semanticScores,
  });
}
