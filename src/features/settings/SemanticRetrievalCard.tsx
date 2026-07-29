import { useEffect, useState } from 'react';
import { Icon } from '../../app/components/Icon';
import { Badge, Card, Field } from '../../app/components/ui';
import { activeEmbeddingProvider } from '../../core/embeddings/embeddingProviders';
import { EmbeddingRefusedError } from '../../core/embeddings/embeddingService';
import type { SemanticSearchRow } from '../../core/embeddings/embeddingService';
import { useAiStore } from '../../state/aiStore';
import { useDataStore } from '../../state/dataStore';
import { useGovernanceStore } from '../../state/governanceStore';

export function SemanticRetrievalCard() {
  const settings = useAiStore((s) => s.settings);
  const saveSettings = useAiStore((s) => s.saveSettings);
  const clients = useDataStore((s) => s.clients);
  const generateEmbeddings = useGovernanceStore((s) => s.generateEmbeddings);
  const deleteEmbeddings = useGovernanceStore((s) => s.deleteEmbeddings);
  const previewSemantic = useGovernanceStore((s) => s.previewSemantic);

  const [providerDetail, setProviderDetail] = useState<string>();
  const [providerReady, setProviderReady] = useState(false);
  const [localEndpoint, setLocalEndpoint] = useState(settings.embeddingLocalEndpoint);
  const [localModel, setLocalModel] = useState(settings.embeddingLocalModel);
  const [onlineEndpoint, setOnlineEndpoint] = useState(settings.embeddingOnlineEndpoint);
  const [onlineModel, setOnlineModel] = useState(settings.embeddingOnlineModel);
  const [onlineKey, setOnlineKey] = useState('');
  const [clientId, setClientId] = useState('');
  const [onlineConfirmed, setOnlineConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();
  const [error, setError] = useState<string>();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<{ semantic: SemanticSearchRow[]; lexical: Array<{ refType: string; refId: string; score: number }> }>();

  useEffect(() => {
    setLocalEndpoint(settings.embeddingLocalEndpoint);
    setLocalModel(settings.embeddingLocalModel);
    setOnlineEndpoint(settings.embeddingOnlineEndpoint);
    setOnlineModel(settings.embeddingOnlineModel);
    let cancelled = false;
    void activeEmbeddingProvider(settings)
      .checkReadiness(settings)
      .then((r) => {
        if (!cancelled) {
          setProviderDetail(r.detail);
          setProviderReady(r.ready && settings.embeddingProviderType !== 'none');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [settings]);

  const semanticActive = settings.embeddingProviderType !== 'none' && providerReady;

  const saveEndpoints = async () => {
    await saveSettings({
      embeddingLocalEndpoint: localEndpoint.trim(),
      embeddingLocalModel: localModel.trim(),
      embeddingOnlineEndpoint: onlineEndpoint.trim(),
      embeddingOnlineModel: onlineModel.trim(),
      ...(onlineKey.trim() ? { embeddingOnlineApiKey: onlineKey.trim() } : {}),
    });
    setOnlineKey('');
  };

  const run = async (action: 'generate' | 'delete' | 'search') => {
    if (!clientId) return;
    setBusy(true);
    setError(undefined);
    setMessage(undefined);
    try {
      if (action === 'generate') {
        const result = await generateEmbeddings(clientId, onlineConfirmed || undefined);
        setMessage(`Generated ${result.generated} vector(s) with ${result.modelId}. Vectors are encrypted, client-namespaced, excluded from exports, and deleted with the client.`);
      } else if (action === 'delete') {
        const removed = await deleteEmbeddings(clientId);
        setMessage(`Securely deleted ${removed} vector(s) for this client.`);
        setResults(undefined);
      } else {
        if (!query.trim()) return;
        setResults(await previewSemantic(clientId, query.trim(), onlineConfirmed || undefined));
      }
    } catch (err) {
      setError(err instanceof EmbeddingRefusedError || err instanceof Error ? err.message : 'Operation failed.');
    } finally {
      setBusy(false);
      setOnlineConfirmed(false);
    }
  };

  return (
    <Card title="Semantic retrieval (preparation)" icon="search">
      <div className="stack-sm">
        <div className="notice notice--info" style={{ display: 'block' }}>
          <div className="cluster" style={{ gap: 8 }}>
            <Badge tone={semanticActive ? 'blue' : 'neutral'} icon={semanticActive ? 'check' : 'x'}>
              {semanticActive ? 'Embedding provider connected' : 'Semantic retrieval NOT active'}
            </Badge>
          </div>
          <p className="small muted" style={{ margin: '6px 0 0' }}>
            {providerDetail}
            {' '}Clinical retrieval currently uses deterministic lexical ranking in all cases; the semantic
            preview search below demonstrates vector ranking side by side and is planned for live retrieval in
            a future phase.
          </p>
        </div>

        <Field label="Embedding provider">
          <select
            className="select"
            style={{ width: 'auto' }}
            value={settings.embeddingProviderType}
            onChange={(e) => void saveSettings({ embeddingProviderType: e.target.value as never })}
          >
            <option value="none">Deterministic lexical — no embeddings (default)</option>
            <option value="local">Local embeddings (OpenAI-compatible endpoint)</option>
            <option value="online">Secure online embeddings (requires online mode + approvals)</option>
          </select>
        </Field>

        {settings.embeddingProviderType === 'local' && (
          <div className="cluster" style={{ alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <Field label="Local endpoint">
              <input className="input" value={localEndpoint} onChange={(e) => setLocalEndpoint(e.target.value)} />
            </Field>
            <Field label="Embedding model">
              <input className="input" value={localModel} onChange={(e) => setLocalModel(e.target.value)} placeholder="e.g. nomic-embed-text" />
            </Field>
            <button className="btn btn--secondary btn--sm" onClick={() => void saveEndpoints()}>
              <Icon name="check" size={13} /> Save & re-check
            </button>
          </div>
        )}
        {settings.embeddingProviderType === 'online' && (
          <div className="stack-sm">
            <div className="cluster" style={{ alignItems: 'flex-end', flexWrap: 'wrap' }}>
              <Field label="HTTPS endpoint (OpenAI-compatible)">
                <input className="input" value={onlineEndpoint} onChange={(e) => setOnlineEndpoint(e.target.value)} placeholder="https://…" />
              </Field>
              <Field label="Embedding model">
                <input className="input" value={onlineModel} onChange={(e) => setOnlineModel(e.target.value)} />
              </Field>
              <Field label="API key (stored encrypted)">
                <input className="input" type="password" value={onlineKey} onChange={(e) => setOnlineKey(e.target.value)} placeholder={settings.embeddingOnlineApiKey ? '•••••••• (on file)' : ''} autoComplete="off" />
              </Field>
              <button className="btn btn--secondary btn--sm" onClick={() => void saveEndpoints()}>
                <Icon name="check" size={13} /> Save & re-check
              </button>
            </div>
            <p className="muted small" style={{ margin: 0 }}>
              Online embeddings follow the SAME rules as online AI: master switch, PHI attestation, per-input
              consent, per-client local-only override, kill switch, approval registry, and a confirmed outbound
              preview for every generation.
            </p>
          </div>
        )}

        <div className="cluster" style={{ alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <Field label="Client (vectors are namespaced per client)">
            <select className="select" value={clientId} onChange={(e) => { setClientId(e.target.value); setResults(undefined); }}>
              <option value="">Select…</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>{c.displayName}</option>
              ))}
            </select>
          </Field>
          <button className="btn btn--secondary btn--sm" disabled={!clientId || busy || !semanticActive} onClick={() => void run('generate')}>
            <Icon name="plus" size={13} /> Generate / regenerate vectors
          </button>
          <button className="btn btn--ghost btn--sm" disabled={!clientId || busy} onClick={() => void run('delete')}>
            <Icon name="trash" size={13} /> Delete this client's vectors
          </button>
        </div>

        {settings.embeddingProviderType === 'online' && clientId && (
          <label className="cluster small" style={{ gap: 8 }}>
            <input type="checkbox" checked={onlineConfirmed} onChange={(e) => setOnlineConfirmed(e.target.checked)} />
            I confirm this client's consented record text (or my search query) may be sent to the configured
            embeddings endpoint.
          </label>
        )}

        <div className="cluster" style={{ alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <Field label="Semantic preview search (compares vector vs lexical ranking)">
            <input className="input" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="e.g. relationship conflict pattern" />
          </Field>
          <button className="btn btn--secondary btn--sm" disabled={!clientId || !query.trim() || busy || !semanticActive} onClick={() => void run('search')}>
            <Icon name="search" size={13} /> Search
          </button>
        </div>

        {message && (
          <div className="notice notice--info" role="status">
            <Icon name="check" size={15} />
            <span className="small">{message}</span>
          </div>
        )}
        {error && (
          <div className="notice notice--danger" role="alert">
            <Icon name="alert" size={15} />
            <span className="small">{error}</span>
          </div>
        )}

        {results && (
          <div className="cluster" style={{ alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
            <div className="soft small" style={{ display: 'block', flex: '1 1 240px' }}>
              <strong>Semantic (cosine)</strong>
              {results.semantic.length === 0 ? (
                <p className="muted" style={{ margin: '4px 0 0' }}>No vectors stored for this client yet.</p>
              ) : (
                <ol style={{ margin: '4px 0 0', paddingLeft: 18 }}>
                  {results.semantic.map((row, i) => (
                    <li key={i}>{row.refType}:{row.refId.slice(0, 8)}… · {row.similarity}</li>
                  ))}
                </ol>
              )}
            </div>
            <div className="soft small" style={{ display: 'block', flex: '1 1 240px' }}>
              <strong>Lexical (current clinical ranking)</strong>
              <ol style={{ margin: '4px 0 0', paddingLeft: 18 }}>
                {results.lexical.map((row, i) => (
                  <li key={i}>{row.refType}:{row.refId.slice(0, 8)}… · {row.score}</li>
                ))}
              </ol>
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}
