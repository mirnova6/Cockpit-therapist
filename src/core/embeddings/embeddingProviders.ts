/**
 * Semantic retrieval preparation (§16) — the EmbeddingProvider seam.
 *
 * Three providers:
 *  - deterministic-lexical: the honest default. It produces NO embeddings;
 *    retrieval stays lexical and the UI says so. Selecting it never claims
 *    semantic retrieval is active.
 *  - local-embedding: OpenAI-compatible /v1/embeddings on a local endpoint,
 *    with a genuine readiness check.
 *  - online-embedding: OpenAI-compatible /v1/embeddings at a configured
 *    HTTPS endpoint with an API key. Online embedding of client content
 *    obeys EXACTLY the same consent, attestation, kill-switch, approval-
 *    registry, and confirmation rules as online AI (enforced in
 *    embeddingService, which routes every generation through those gates).
 */
import type { AiSettings } from '../ai/aiSchema';
import { AiProviderError, type ProviderReadiness } from '../ai/types';

export interface EmbeddingProvider {
  readonly id: string;
  readonly label: string;
  readonly providerType: 'none' | 'local' | 'online';
  checkReadiness(settings: AiSettings): Promise<ProviderReadiness>;
  /** Embeds texts in order. Throws for the lexical provider. */
  embed(texts: string[], settings: AiSettings, signal?: AbortSignal): Promise<number[][]>;
}

export const lexicalEmbeddingProvider: EmbeddingProvider = {
  id: 'deterministic-lexical',
  label: 'Deterministic lexical (no embeddings)',
  providerType: 'none',
  async checkReadiness(): Promise<ProviderReadiness> {
    return {
      ready: true,
      detail:
        'Retrieval uses deterministic lexical ranking. No embeddings are generated and semantic retrieval is NOT active.',
    };
  },
  async embed(): Promise<number[][]> {
    throw new AiProviderError('unsupported-capability', 'The lexical provider does not produce embeddings.');
  },
};

function normalizeBase(url: string): string {
  return url.trim().replace(/\/+$/, '');
}

async function openAiCompatibleEmbed(
  base: string,
  model: string,
  texts: string[],
  headers: Record<string, string>,
  signal?: AbortSignal,
): Promise<number[][]> {
  let response: Response;
  try {
    response = await fetch(`${base}/v1/embeddings`, {
      method: 'POST',
      signal,
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify({ model, input: texts }),
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new AiProviderError('aborted', 'The request was cancelled.');
    }
    throw new AiProviderError('network', 'Could not reach the embeddings endpoint.');
  }
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) throw new AiProviderError('auth', 'The endpoint rejected the key.');
    throw new AiProviderError('server', `The embeddings endpoint returned HTTP ${response.status}.`);
  }
  const body = (await response.json()) as { data?: Array<{ index?: number; embedding?: number[] }> };
  const rows = (body.data ?? []).filter((d) => Array.isArray(d.embedding));
  if (rows.length !== texts.length) {
    throw new AiProviderError('invalid-response', 'The endpoint returned the wrong number of embeddings.');
  }
  return rows
    .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
    .map((d) => d.embedding as number[]);
}

export const localEmbeddingProvider: EmbeddingProvider = {
  id: 'local-embedding',
  label: 'Local embeddings (OpenAI-compatible endpoint)',
  providerType: 'local',
  async checkReadiness(settings): Promise<ProviderReadiness> {
    const base = normalizeBase(settings.embeddingLocalEndpoint);
    if (!base) return { ready: false, detail: 'No local embeddings endpoint configured.' };
    if (!settings.embeddingLocalModel.trim()) return { ready: false, detail: 'No local embedding model selected.' };
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 4000);
      const response = await fetch(`${base}/v1/models`, { signal: controller.signal });
      clearTimeout(timer);
      if (!response.ok) return { ready: false, detail: `Endpoint returned HTTP ${response.status}.` };
      const body = (await response.json()) as { data?: Array<{ id?: string }> };
      const models = (body.data ?? []).map((m) => m.id ?? '');
      if (!models.includes(settings.embeddingLocalModel.trim())) {
        return { ready: false, detail: `Endpoint reachable but does not list "${settings.embeddingLocalModel}".` };
      }
      return { ready: true, detail: `Connected to ${settings.embeddingLocalModel}. Embedding stays local.` };
    } catch {
      return { ready: false, detail: 'No local embedding model is connected — the endpoint did not respond.' };
    }
  },
  async embed(texts, settings, signal): Promise<number[][]> {
    const base = normalizeBase(settings.embeddingLocalEndpoint);
    if (!base || !settings.embeddingLocalModel.trim()) {
      throw new AiProviderError('not-configured', 'The local embeddings endpoint is not configured.');
    }
    return openAiCompatibleEmbed(base, settings.embeddingLocalModel.trim(), texts, {}, signal);
  },
};

export const onlineEmbeddingProvider: EmbeddingProvider = {
  id: 'online-embedding',
  label: 'Secure online embeddings (OpenAI-compatible endpoint)',
  providerType: 'online',
  async checkReadiness(settings): Promise<ProviderReadiness> {
    if (!settings.onlineEnabled) return { ready: false, detail: 'Online processing is disabled (the default).' };
    if (settings.onlineKillSwitch) return { ready: false, detail: 'The emergency disable switch is active.' };
    if (!normalizeBase(settings.embeddingOnlineEndpoint)) return { ready: false, detail: 'No online embeddings endpoint configured.' };
    if (!settings.embeddingOnlineModel.trim()) return { ready: false, detail: 'No online embedding model selected.' };
    if (!settings.embeddingOnlineApiKey?.trim()) return { ready: false, detail: 'No API key configured for the embeddings endpoint.' };
    return { ready: true, detail: `Configured for ${settings.embeddingOnlineModel}. Requests leave this device over HTTPS.` };
  },
  async embed(texts, settings, signal): Promise<number[][]> {
    const base = normalizeBase(settings.embeddingOnlineEndpoint);
    const key = settings.embeddingOnlineApiKey?.trim();
    if (!settings.onlineEnabled || settings.onlineKillSwitch) {
      throw new AiProviderError('not-configured', 'Online embedding is disabled.');
    }
    if (!base || !key) throw new AiProviderError('not-configured', 'The online embeddings endpoint is not configured.');
    return openAiCompatibleEmbed(base, settings.embeddingOnlineModel.trim(), texts, { authorization: `Bearer ${key}` }, signal);
  },
};

export function activeEmbeddingProvider(settings: AiSettings): EmbeddingProvider {
  if (settings.embeddingProviderType === 'local') return localEmbeddingProvider;
  if (settings.embeddingProviderType === 'online') return onlineEmbeddingProvider;
  return lexicalEmbeddingProvider;
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
