import { useState } from 'react';
import { Icon } from '../../app/components/Icon';
import { Badge, Card, Field, Modal } from '../../app/components/ui';
import { LOCAL_CONTEXT_WARNING_THRESHOLD } from '../../core/ai/providers/localProvider';
import { useAiStore } from '../../state/aiStore';

/**
 * In-app Local AI setup guide (§9). Honest about the "no local model
 * connected" state — the connect button runs the SAME real readiness check
 * the provider uses, and never claims a model is active unless it passes.
 */
export function LocalAiGuide({ onClose }: { onClose: () => void }) {
  const settings = useAiStore((s) => s.settings);
  const readiness = useAiStore((s) => s.readiness);
  const saveSettings = useAiStore((s) => s.saveSettings);
  const refreshReadiness = useAiStore((s) => s.refreshReadiness);

  const [endpoint, setEndpoint] = useState(settings.localEndpointUrl || 'http://localhost:11434');
  const [model, setModel] = useState(settings.localModel);
  const [contextWindow, setContextWindow] = useState(settings.localContextWindow?.toString() ?? '');
  const [testing, setTesting] = useState(false);

  const local = readiness['local-endpoint'];
  const connected = local?.ready ?? false;
  const smallContext =
    settings.localContextWindow !== undefined && settings.localContextWindow < LOCAL_CONTEXT_WARNING_THRESHOLD;

  const testConnection = async () => {
    setTesting(true);
    try {
      await saveSettings({
        localEndpointUrl: endpoint.trim(),
        localModel: model.trim(),
        localContextWindow: contextWindow.trim() ? Number(contextWindow) : undefined,
      });
      await refreshReadiness();
    } finally {
      setTesting(false);
    }
  };

  return (
    <Modal title="Local AI setup guide" subtitle="Run an AI model on this machine — nothing leaves the device." onClose={onClose}>
      <div className="stack-sm" style={{ maxHeight: '68vh', overflowY: 'auto', paddingRight: 4 }}>
        <div className="notice notice--info" style={{ display: 'block' }}>
          <strong className="small"><Icon name="shield" size={14} /> Privacy</strong>
          <p className="small" style={{ margin: '4px 0 0' }}>
            Local AI sends your selected clinical text ONLY to the endpoint you configure here — normally a
            program running on this same computer. No data goes to any company's servers, and the app works
            fully offline once the local model is running. The per-entry AI-analysis consent flag still applies.
          </p>
        </div>

        <Card title="1 · Install an OpenAI-compatible local server" icon="download">
          <ul className="small" style={{ margin: 0, paddingLeft: 18, lineHeight: 1.7 }}>
            <li>
              <strong>Ollama</strong> — install from ollama.com, then run a model:{' '}
              <code>ollama run llama3.1:8b</code>. Endpoint: <code>http://localhost:11434</code>.
            </li>
            <li>
              <strong>LM Studio</strong> — enable the local server in the Developer tab. Endpoint is typically{' '}
              <code>http://localhost:1234</code>.
            </li>
            <li>
              <strong>llama.cpp server</strong> — run <code>./server -m model.gguf --port 8080</code>. Endpoint:{' '}
              <code>http://localhost:8080</code>.
            </li>
          </ul>
          <p className="muted small" style={{ margin: '8px 0 0' }}>
            Any endpoint exposing the OpenAI-compatible <code>/v1/models</code> and{' '}
            <code>/v1/chat/completions</code> routes works.
          </p>
        </Card>

        <Card title="2 · Point Cockpit at it" icon="settings">
          <div className="stack-sm">
            <Field label="Endpoint URL">
              <input className="input" value={endpoint} onChange={(e) => setEndpoint(e.target.value)} placeholder="http://localhost:11434" />
            </Field>
            <Field label="Model name (must match a model the server actually serves)">
              <input className="input" value={model} onChange={(e) => setModel(e.target.value)} placeholder="e.g. llama3.1:8b" />
            </Field>
            <Field label="Context window in tokens (optional — used only for the capacity warning)">
              <input className="input" value={contextWindow} onChange={(e) => setContextWindow(e.target.value)} placeholder="e.g. 8192" />
            </Field>
            <button className="btn btn--primary btn--sm" style={{ alignSelf: 'flex-start' }} disabled={testing || !model.trim()} onClick={() => void testConnection()}>
              <Icon name="activity" size={13} /> {testing ? 'Checking…' : 'Run readiness check'}
            </button>
          </div>
        </Card>

        <Card title="3 · Readiness" icon={connected ? 'check' : 'alert'}>
          <div className="stack-sm">
            <Badge tone={connected ? 'green' : 'red'} icon={connected ? 'check' : 'x'}>
              {connected ? 'Local model connected' : 'No local model connected'}
            </Badge>
            {local?.detail && <p className="small" style={{ margin: 0 }}>{local.detail}</p>}
            {!connected && (
              <p className="muted small" style={{ margin: 0 }}>
                The app will NOT use a local model until this check passes. Until then, AI features fall back to
                deterministic mode and say so.
              </p>
            )}
            {smallContext && (
              <div className="notice notice--warn">
                <Icon name="alert" size={15} />
                <span className="small">
                  Small context window ({settings.localContextWindow} tokens). Long transcripts and full-record
                  analysis may be truncated — results can omit older material. Prefer a model with a larger
                  context window for whole-record work.
                </span>
              </div>
            )}
            <div className="notice notice--info">
              <Icon name="info" size={15} />
              <span className="small">
                <strong>Performance:</strong> local models are slower than cloud models and vary widely in
                quality. Smaller models raise unsupported-claim rates — use the Clinical AI Evaluation harness to
                measure a model before relying on it.
              </span>
            </div>
          </div>
        </Card>

        <Card title="Troubleshooting" icon="search">
          <ul className="small" style={{ margin: 0, paddingLeft: 18, lineHeight: 1.7 }}>
            <li><strong>"Endpoint did not respond"</strong> — is the server running? Try the URL in a browser.</li>
            <li><strong>"Does not list model X"</strong> — the model name must match exactly (e.g. <code>llama3.1:8b</code>, not <code>llama3</code>). Run <code>ollama list</code>.</li>
            <li><strong>Blocked by CORS</strong> — some servers need permissive CORS for browser requests; the native desktop build avoids this. Ollama allows localhost by default.</li>
            <li><strong>Wrong port</strong> — LM Studio and llama.cpp use different default ports than Ollama.</li>
          </ul>
        </Card>

        <button className="btn btn--secondary" onClick={onClose}>Done</button>
      </div>
    </Modal>
  );
}
