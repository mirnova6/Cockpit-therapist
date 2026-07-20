import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Icon } from '../../app/components/Icon';
import { Badge, Card, Field } from '../../app/components/ui';
import { PROVIDER_TYPE_LABELS, type AiProviderType } from '../../core/ai/aiSchema';
import { fmtDateTime } from '../../lib/format';
import { useAiStore } from '../../state/aiStore';
import { LocalAiGuide } from './LocalAiGuide';

export function AiSettingsCard() {
  const settings = useAiStore((s) => s.settings);
  const readiness = useAiStore((s) => s.readiness);
  const activeReady = useAiStore((s) => s.activeReady);
  const operations = useAiStore((s) => s.operations);
  const saveSettings = useAiStore((s) => s.saveSettings);
  const refreshReadiness = useAiStore((s) => s.refreshReadiness);
  const loadOperations = useAiStore((s) => s.loadOperations);

  const [localUrl, setLocalUrl] = useState(settings.localEndpointUrl);
  const [localModel, setLocalModel] = useState(settings.localModel);
  const [localContext, setLocalContext] = useState(settings.localContextWindow?.toString() ?? '');
  const [apiKey, setApiKey] = useState('');
  const [onlineModel, setOnlineModel] = useState(settings.onlineModel);
  const [testing, setTesting] = useState(false);
  const [showOps, setShowOps] = useState(false);
  const [showGuide, setShowGuide] = useState(false);

  useEffect(() => {
    setLocalUrl(settings.localEndpointUrl);
    setLocalModel(settings.localModel);
    setLocalContext(settings.localContextWindow?.toString() ?? '');
    setOnlineModel(settings.onlineModel);
  }, [settings]);

  const activeProviderId =
    settings.activeProviderType === 'online'
      ? 'anthropic-online'
      : settings.activeProviderType === 'local'
        ? 'local-endpoint'
        : 'deterministic';
  const activeDetail = readiness[activeProviderId]?.detail;

  const saveLocal = async () => {
    setTesting(true);
    try {
      await saveSettings({
        localEndpointUrl: localUrl.trim(),
        localModel: localModel.trim(),
        localContextWindow: localContext.trim() ? Number(localContext) : undefined,
      });
    } finally {
      setTesting(false);
    }
  };

  const saveOnline = async () => {
    await saveSettings({
      onlineModel: onlineModel.trim() || 'claude-sonnet-5',
      ...(apiKey.trim() ? { onlineApiKey: apiKey.trim() } : {}),
    });
    setApiKey('');
  };

  return (
    <Card title="AI processing" icon="activity">
      <div className="stack-sm">
        <div className="notice notice--info" style={{ display: 'block' }}>
          <div className="cluster" style={{ gap: 8 }}>
            <Badge
              tone={settings.activeProviderType === 'online' ? 'amber' : settings.activeProviderType === 'local' ? 'blue' : 'green'}
              icon={settings.activeProviderType === 'online' ? 'upload' : 'shield'}
            >
              Active: {PROVIDER_TYPE_LABELS[settings.activeProviderType]}
            </Badge>
            <Badge tone={activeReady ? 'green' : 'red'} icon={activeReady ? 'check' : 'x'}>
              {activeReady ? 'Ready' : 'Not ready'}
            </Badge>
          </div>
          {activeDetail && <p className="small muted" style={{ margin: '6px 0 0' }}>{activeDetail}</p>}
        </div>

        <Field label="Processing mode">
          <select
            className="select"
            value={settings.activeProviderType}
            onChange={(e) => void saveSettings({ activeProviderType: e.target.value as AiProviderType })}
          >
            {(Object.keys(PROVIDER_TYPE_LABELS) as AiProviderType[]).map((type) => (
              <option key={type} value={type}>{PROVIDER_TYPE_LABELS[type]}</option>
            ))}
          </select>
        </Field>
        <p className="muted small" style={{ margin: 0 }}>
          Deterministic mode is always available and never simulates AI output. Local and online modes activate
          only when genuinely connected — the app never claims a model is connected when it is not.
        </p>

        {/* ------------------------------------------------ local provider */}
        <details open={settings.activeProviderType === 'local'}>
          <summary className="small" style={{ cursor: 'pointer', fontWeight: 600 }}>
            Local AI endpoint (Ollama / OpenAI-compatible)
          </summary>
          <div className="stack-sm" style={{ marginTop: 8 }}>
            <p className="muted small" style={{ margin: 0 }}>
              Clinical text goes only to this endpoint (typically on this machine). No external telemetry.
              Readiness is a live connectivity check that also verifies the model is actually served.
            </p>
            <div className="cluster">
              <Field label="Endpoint URL">
                <input className="input" value={localUrl} onChange={(e) => setLocalUrl(e.target.value)} placeholder="http://localhost:11434" />
              </Field>
              <Field label="Model name">
                <input className="input" value={localModel} onChange={(e) => setLocalModel(e.target.value)} placeholder="e.g. llama3.1:8b" />
              </Field>
              <Field label="Context window (tokens, optional)">
                <input className="input" value={localContext} onChange={(e) => setLocalContext(e.target.value)} placeholder="e.g. 8192" />
              </Field>
            </div>
            <div className="cluster">
              <button className="btn btn--secondary btn--sm" disabled={testing} onClick={() => void saveLocal()}>
                <Icon name="check" size={13} /> Save & test connection
              </button>
              <button className="btn btn--ghost btn--sm" onClick={() => setShowGuide(true)}>
                <Icon name="info" size={13} /> Local AI setup guide
              </button>
              {readiness['local-endpoint'] && (
                <span className={`small ${readiness['local-endpoint'].ready ? '' : 'muted'}`}>
                  {readiness['local-endpoint'].ready ? '✓ ' : ''}{readiness['local-endpoint'].detail}
                </span>
              )}
            </div>
          </div>
        </details>

        {/* ----------------------------------------------- online provider */}
        <details open={settings.activeProviderType === 'online'}>
          <summary className="small" style={{ cursor: 'pointer', fontWeight: 600 }}>
            Secure online AI (Anthropic API) — disabled by default
          </summary>
          <div className="stack-sm" style={{ marginTop: 8 }}>
            <label className="cluster small" style={{ gap: 8 }}>
              <input
                type="checkbox"
                checked={settings.onlineEnabled}
                onChange={(e) => void saveSettings({ onlineEnabled: e.target.checked })}
              />
              Enable online AI processing (content leaves this device over HTTPS when you confirm each send)
            </label>
            <div className="cluster">
              <Field label="API key (stored AES-256 encrypted; never shown again)">
                <input
                  className="input"
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder={settings.onlineApiKey ? '•••••••• (key on file — enter to replace)' : 'sk-ant-…'}
                  autoComplete="off"
                />
              </Field>
              <Field label="Model">
                <input className="input" value={onlineModel} onChange={(e) => setOnlineModel(e.target.value)} />
              </Field>
            </div>
            <button className="btn btn--secondary btn--sm" style={{ alignSelf: 'flex-start' }} onClick={() => void saveOnline()}>
              <Icon name="check" size={13} /> Save online settings
            </button>

            <label className="cluster small" style={{ gap: 8, alignItems: 'flex-start' }}>
              <input
                type="checkbox"
                checked={settings.baaConfirmed}
                onChange={(e) => void saveSettings({ baaConfirmed: e.target.checked })}
                style={{ marginTop: 3 }}
              />
              <span>
                I attest that an appropriate contractual arrangement / Business Associate Agreement covering this
                provider is in place for my practice.
              </span>
            </label>
            <label className="cluster small" style={{ gap: 8, alignItems: 'flex-start' }}>
              <input
                type="checkbox"
                checked={settings.onlinePhiApproved}
                onChange={(e) => void saveSettings({ onlinePhiApproved: e.target.checked })}
                style={{ marginTop: 3 }}
              />
              <span>
                I attest that this provider relationship is approved for protected health information. Without
                this attestation the app REFUSES to send protected information online.
              </span>
            </label>
            <label className="cluster small" style={{ gap: 8 }}>
              <input
                type="checkbox"
                checked={settings.redactBeforeSend}
                onChange={(e) => void saveSettings({ redactBeforeSend: e.target.checked })}
              />
              Apply best-effort redaction before sending (transformed text is always shown first; redaction is
              never perfect)
            </label>
            <div className={`notice ${settings.onlineKillSwitch ? 'notice--danger' : 'notice--info'}`} style={{ display: 'block' }}>
              <label className="cluster small" style={{ gap: 8 }}>
                <input
                  type="checkbox"
                  checked={settings.onlineKillSwitch}
                  onChange={(e) => void saveSettings({ onlineKillSwitch: e.target.checked })}
                />
                <span>
                  <strong>Emergency disable switch.</strong> While active, EVERY online send is refused
                  immediately — regardless of attestations, approvals, or per-run confirmations.
                </span>
              </label>
            </div>
            <p className="muted small" style={{ margin: 0 }}>
              These settings and attestations do not, by themselves, make your practice HIPAA-compliant —
              compliance also depends on your policies, agreements, and legal review. Clinical data is never used
              for advertising or unrelated analytics by this app.
            </p>
          </div>
        </details>

        <div className="cluster" style={{ flexWrap: 'wrap' }}>
          <Link className="btn btn--secondary btn--sm" to="/knowledge">
            <Icon name="file" size={13} /> Clinical knowledge library
          </Link>
          <Link className="btn btn--secondary btn--sm" to="/evaluation">
            <Icon name="activity" size={13} /> Clinical AI Evaluation
          </Link>
          <Link className="btn btn--secondary btn--sm" to="/providers">
            <Icon name="shield" size={13} /> Provider approvals
          </Link>
          <Link className="btn btn--secondary btn--sm" to="/audit">
            <Icon name="list" size={13} /> Audit & AI operations
          </Link>
          <Link className="btn btn--secondary btn--sm" to="/feedback">
            <Icon name="edit" size={13} /> Feedback dashboard
          </Link>
          <Link className="btn btn--secondary btn--sm" to="/readiness">
            <Icon name="check" size={13} /> Readiness checklist & report
          </Link>
          <button
            className="btn btn--ghost btn--sm"
            onClick={() => {
              setShowOps((v) => !v);
              if (!showOps) void loadOperations();
            }}
          >
            <Icon name="list" size={13} /> AI operations log
          </button>
          <button className="btn btn--ghost btn--sm" onClick={() => void refreshReadiness()}>
            <Icon name="activity" size={13} /> Re-check providers
          </button>
        </div>

        {showOps && (
          <div className="soft small" style={{ display: 'block', maxHeight: 260, overflowY: 'auto' }}>
            {operations.length === 0 ? (
              <p className="muted" style={{ margin: 0 }}>No AI operations recorded yet.</p>
            ) : (
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                {operations.map((op) => (
                  <li key={op.id}>
                    {fmtDateTime(op.at)} · {op.capability} · {op.providerId} ({op.mode}) · {op.status}
                    {op.phiLeftDevice ? ' · PHI left device' : ' · on-device'}
                    {op.redactionApplied ? ' · redacted' : ''}
                    {op.errorKind ? ` · ${op.errorKind}` : ''}
                  </li>
                ))}
              </ul>
            )}
            <p className="muted" style={{ margin: '6px 0 0' }}>
              The log stores identifiers and metadata only — never prompt or response text.
            </p>
          </div>
        )}
      </div>
      {showGuide && <LocalAiGuide onClose={() => setShowGuide(false)} />}
    </Card>
  );
}
