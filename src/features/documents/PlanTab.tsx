import { useEffect, useState } from 'react';
import { useNavigate, useOutletContext } from 'react-router-dom';
import { Icon } from '../../app/components/Icon';
import { Badge, Card, EmptyState, Field } from '../../app/components/ui';
import { DOC_STATUS_LABELS, EMPTY_SELECTION, type SourceSelection } from '../../core/db/documentSchema';
import { fmtDate, todayIsoDate } from '../../lib/format';
import { useAiStore } from '../../state/aiStore';
import { useDocumentsStore } from '../../state/documentsStore';
import type { ClientContext } from '../dashboard/ClientDashboardLayout';
import { AiGeneratorPicker, DEFAULT_DOCUMENT_PROVIDER_ID } from './AiGeneratorPicker';
import { SourceSelectionPanel } from './SourceSelectionPanel';
import { statusTone } from './docShared';

export function PlanTab() {
  const { client } = useOutletContext<ClientContext>();
  const navigate = useNavigate();
  const docs = useDocumentsStore((s) => s.byClient[client.id]);
  const loadClient = useDocumentsStore((s) => s.loadClient);
  const generatePlan = useDocumentsStore((s) => s.generatePlan);

  const [creating, setCreating] = useState(false);
  const [selection, setSelection] = useState<SourceSelection>(EMPTY_SELECTION);
  const [planDate, setPlanDate] = useState(todayIsoDate());
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [providerId, setProviderId] = useState(DEFAULT_DOCUMENT_PROVIDER_ID);
  const [onlineConfirmed, setOnlineConfirmed] = useState(false);
  const aiSettings = useAiStore((s) => s.settings);
  const setStoreOnlineConfirmed = useAiStore((s) => s.setOnlineConfirmed);
  const onlineGate =
    providerId !== DEFAULT_DOCUMENT_PROVIDER_ID && aiSettings.activeProviderType === 'online';

  useEffect(() => {
    void loadClient(client.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client.id]);

  const plans = docs?.plans ?? [];

  const generate = async () => {
    setError(undefined);
    setBusy(true);
    if (onlineGate) setStoreOnlineConfirmed(onlineConfirmed);
    try {
      const plan = await generatePlan(client.id, selection, planDate, providerId);
      navigate(plan.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Generation failed.');
      setBusy(false);
    } finally {
      setStoreOnlineConfirmed(false);
    }
  };

  if (creating) {
    return (
      <div className="stack" style={{ maxWidth: 860 }}>
        <div className="spread">
          <div>
            <h2>New Master Treatment Plan — select sources</h2>
            <p className="muted small">
              The plan is assembled only from what you select. Goals come from the Goals &amp;
              Objectives editor; the generator never invents baselines, targets, or dates.
            </p>
          </div>
          <button className="btn btn--ghost btn--sm" onClick={() => setCreating(false)}>Cancel</button>
        </div>

        <Card title="Plan" icon="calendar">
          <div className="form-grid">
            <Field label="Plan date">
              <input className="input" type="date" value={planDate} onChange={(e) => setPlanDate(e.target.value)} />
            </Field>
          </div>
        </Card>

        <SourceSelectionPanel clientId={client.id} docType="treatment-plan" selection={selection} onChange={setSelection} />

        <Card title="Generator" icon="activity">
          <AiGeneratorPicker
            clientId={client.id}
            clientNames={[client.displayName, client.preferredIdentifier ?? ''].filter(Boolean)}
            selection={selection}
            providerId={providerId}
            onProviderChange={setProviderId}
            onlineConfirmed={onlineConfirmed}
            setOnlineConfirmed={setOnlineConfirmed}
          />
        </Card>

        {error && (
          <div className="notice notice--danger" role="alert">
            <Icon name="alert" size={16} />
            <span>{error}</span>
          </div>
        )}

        <div className="cluster">
          <button className="btn btn--primary" disabled={busy || (onlineGate && !onlineConfirmed)} onClick={() => void generate()}>
            <Icon name="clipboard" size={15} /> {busy ? 'Generating…' : 'Generate plan draft'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="stack">
      <div className="spread">
        <div>
          <h2>Master Treatment Plan</h2>
          <p className="muted small">
            Approving a new plan automatically supersedes the previously approved plan — prior
            versions stay in history.
          </p>
        </div>
        <button className="btn btn--primary" onClick={() => { setSelection(EMPTY_SELECTION); setCreating(true); }}>
          <Icon name="plus" size={15} /> New plan
        </button>
      </div>

      {plans.length === 0 ? (
        <Card>
          <EmptyState icon="clipboard" title="No treatment plan yet">
            <p className="small">Generate a plan draft from approved client information, then review and approve it.</p>
          </EmptyState>
        </Card>
      ) : (
        <Card>
          <div className="row-list">
            {plans.map((plan) => (
              <button key={plan.id} className="list-row" onClick={() => navigate(plan.id)}>
                <Icon name="clipboard" size={16} className="soft" />
                <span style={{ flex: 1 }}>
                  <strong className="small">Plan dated {fmtDate(plan.planDate)}</strong>
                  <span className="muted small" style={{ display: 'block' }}>
                    {plan.problems.length} problem(s) · {plan.goalIds.length} goal(s) · v{plan.version}
                  </span>
                </span>
                <Badge tone={statusTone(plan.reviewStatus)}>{DOC_STATUS_LABELS[plan.reviewStatus]}</Badge>
                <Icon name="chevron-right" size={15} className="soft" />
              </button>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
