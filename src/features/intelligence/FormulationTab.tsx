import { useEffect, useMemo, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { Icon } from '../../app/components/Icon';
import { Badge, Card, EmptyState, Field, Modal } from '../../app/components/ui';
import {
  FORMULATION_FRAMEWORKS,
  GUIDING_QUESTION,
  type CaseFormulation,
  type FormulationFramework,
} from '../../core/db/intelligenceSchema';
import { diffFormulations } from '../../core/formulation/formulationEngine';
import { fmtDate } from '../../lib/format';
import { useDataStore } from '../../state/dataStore';
import { useIntelligenceStore } from '../../state/intelligenceStore';
import type { ClientContext } from '../dashboard/ClientDashboardLayout';
import {
  ConfidenceLevelBadge,
  EvidenceDrawer,
  FeedbackBar,
  GenerationStamp,
} from './shared';

export function FormulationTab() {
  const { client } = useOutletContext<ClientContext>();
  const data = useIntelligenceStore((s) => s.byClient[client.id]);
  const loadClient = useIntelligenceStore((s) => s.loadClient);
  const propose = useIntelligenceStore((s) => s.proposeFormulation);
  const decide = useIntelligenceStore((s) => s.decideFormulation);
  const prefs = useDataStore((s) => s.prefs);
  const setPrefs = useDataStore((s) => s.setPrefs);

  const enabled = useMemo(
    () => new Set(prefs?.enabledFrameworks ?? FORMULATION_FRAMEWORKS.map((f) => f.value)),
    [prefs],
  );
  const [framework, setFramework] = useState<FormulationFramework>('biopsychosocial');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [showFrameworkSettings, setShowFrameworkSettings] = useState(false);
  const [compare, setCompare] = useState<CaseFormulation>();

  useEffect(() => {
    void loadClient(client.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client.id]);

  const formulations = data?.formulations ?? [];
  const forFramework = formulations.filter((f) => f.framework === framework);
  const approved = forFramework.find((f) => f.reviewStatus === 'approved' || f.reviewStatus === 'edited');
  const pending = forFramework.filter((f) => f.reviewStatus === 'pending');
  const history = forFramework.filter((f) => f.reviewStatus === 'superseded' || f.reviewStatus === 'rejected');

  const toggleFramework = async (value: string) => {
    const next = new Set(enabled);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    await setPrefs({ enabledFrameworks: [...next] });
  };

  const generate = async () => {
    setBusy(true);
    setError(undefined);
    try {
      await propose(client.id, framework, reason.trim() || 'Clinician requested a formulation update');
      setReason('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not generate the formulation.');
    } finally {
      setBusy(false);
    }
  };

  const renderFormulation = (formulation: CaseFormulation, opts: { showDecisions?: boolean } = {}) => {
    const previous = formulation.previousFormulationId
      ? formulations.find((f) => f.id === formulation.previousFormulationId)
      : undefined;
    return (
      <Card key={formulation.id}>
        <div className="stack-sm">
          <div className="cluster">
            <Badge
              tone={
                formulation.reviewStatus === 'approved' || formulation.reviewStatus === 'edited'
                  ? 'green'
                  : formulation.reviewStatus === 'pending'
                    ? 'amber'
                    : 'neutral'
              }
              icon={formulation.reviewStatus === 'pending' ? 'clock' : 'check'}
            >
              {formulation.reviewStatus === 'pending'
                ? 'Proposed — awaiting your review'
                : formulation.reviewStatus === 'approved' || formulation.reviewStatus === 'edited'
                  ? 'Clinician approved'
                  : formulation.reviewStatus}
            </Badge>
            <span className="muted small">Updated {fmtDate(formulation.updatedAt.slice(0, 10))}</span>
            {previous && (
              <button className="btn btn--ghost btn--sm" onClick={() => setCompare(formulation)}>
                <Icon name="eye" size={13} /> Compare with previous
              </button>
            )}
          </div>
          <p className="muted small" style={{ margin: 0 }}>Update reason: {formulation.updateReason}</p>
          <GenerationStamp generation={formulation.generation} />

          {formulation.sections.map((section) => (
            <div key={section.key} className="soft" style={{ display: 'block', padding: 12 }}>
              <div className="cluster" style={{ gap: 8 }}>
                <strong className="small">{section.label}</strong>
                <ConfidenceLevelBadge level={section.confidence} />
                {section.hypothesisBased && <Badge tone="plum" icon="search">Hypothesis-based</Badge>}
                {section.contradictingEvidence.length > 0 && (
                  <Badge tone="amber" icon="alert">
                    {section.contradictingEvidence.length} contradiction{section.contradictingEvidence.length > 1 ? 's' : ''}
                  </Badge>
                )}
              </div>
              <p className="small prewrap" style={{ margin: '8px 0' }}>{section.text}</p>
              {section.alternativeExplanations.length > 0 && (
                <p className="muted small" style={{ margin: '4px 0' }}>
                  Alternative explanations: {section.alternativeExplanations.join(' · ')}
                </p>
              )}
              <EvidenceDrawer sources={section.supportingEvidence} clientId={client.id} label="Supporting evidence" />
              {section.contradictingEvidence.length > 0 && (
                <EvidenceDrawer
                  sources={section.contradictingEvidence}
                  clientId={client.id}
                  label="Contradicting evidence"
                />
              )}
            </div>
          ))}

          {formulation.areasNeedingAssessment.length > 0 && (
            <div className="notice notice--info" style={{ display: 'block' }}>
              <strong className="small">Areas needing further assessment:</strong>
              <ul className="small" style={{ margin: '4px 0 0' }}>
                {formulation.areasNeedingAssessment.map((area, i) => (
                  <li key={i}>{area}</li>
                ))}
              </ul>
            </div>
          )}

          {opts.showDecisions && (
            <div className="cluster">
              <button className="btn btn--primary btn--sm" onClick={() => void decide(formulation.id, client.id, 'approve')}>
                <Icon name="check" size={13} /> Approve formulation
              </button>
              <button className="btn btn--danger btn--sm" onClick={() => void decide(formulation.id, client.id, 'reject')}>
                <Icon name="x" size={13} /> Reject
              </button>
            </div>
          )}
          <FeedbackBar clientId={client.id} targetType="formulation" targetId={formulation.id} operationId={formulation.generation.operationId} />
        </div>
      </Card>
    );
  };

  return (
    <div className="stack" style={{ maxWidth: 940 }}>
      <Card title="Case formulation" icon="compass">
        <div className="stack-sm">
          <p className="muted small" style={{ margin: 0 }}>
            Guiding question: “{GUIDING_QUESTION}” It guides synthesis only — nothing is forced where evidence is
            absent, and an approved formulation is never changed without your explicit decision.
          </p>
          <div className="cluster" style={{ alignItems: 'flex-end' }}>
            <Field label="Framework">
              <select className="select" style={{ width: 'auto' }} value={framework} onChange={(e) => setFramework(e.target.value as FormulationFramework)}>
                {FORMULATION_FRAMEWORKS.filter((f) => enabled.has(f.value)).map((f) => (
                  <option key={f.value} value={f.value}>{f.label}</option>
                ))}
              </select>
            </Field>
            <button className="btn btn--ghost btn--sm" onClick={() => setShowFrameworkSettings(true)}>
              <Icon name="settings" size={13} /> Enable/disable frameworks
            </button>
          </div>
          <Field label="Reason for this update (recorded with the proposal)">
            <input
              className="input"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. new session material from 2026-07-15"
            />
          </Field>
          {error && (
            <div className="notice notice--danger" role="alert">
              <Icon name="alert" size={15} />
              <span className="small">{error}</span>
            </div>
          )}
          <button className="btn btn--primary" style={{ alignSelf: 'flex-start' }} disabled={busy} onClick={() => void generate()}>
            <Icon name="plus" size={15} /> {busy ? 'Assembling…' : approved ? 'Propose updated formulation' : 'Generate formulation proposal'}
          </button>
        </div>
      </Card>

      {pending.map((f) => renderFormulation(f, { showDecisions: true }))}
      {approved && renderFormulation(approved)}

      {!approved && pending.length === 0 && (
        <Card>
          <EmptyState icon="compass" title="No formulation yet for this framework">
            <p className="small">Generate a proposal above — it stays a draft until you approve it.</p>
          </EmptyState>
        </Card>
      )}

      {history.length > 0 && (
        <Card title={`History (${history.length})`} icon="clock">
          <div className="stack-sm">
            {history.map((f) => (
              <div key={f.id} className="spread soft" style={{ padding: 10 }}>
                <span className="small">
                  {f.reviewStatus === 'superseded' ? 'Superseded' : 'Rejected'} · {fmtDate(f.updatedAt.slice(0, 10))} · {f.updateReason}
                </span>
                <button className="btn btn--ghost btn--sm" onClick={() => setCompare(f)}>
                  <Icon name="eye" size={13} /> View
                </button>
              </div>
            ))}
          </div>
        </Card>
      )}

      {showFrameworkSettings && (
        <Modal title="Formulation frameworks" subtitle="Disable frameworks you don't use with this practice. Nothing is deleted." onClose={() => setShowFrameworkSettings(false)}>
          <div className="stack-sm">
            {FORMULATION_FRAMEWORKS.map((f) => (
              <label key={f.value} className="cluster small" style={{ gap: 8 }}>
                <input type="checkbox" checked={enabled.has(f.value)} onChange={() => void toggleFramework(f.value)} />
                {f.label}
              </label>
            ))}
            <button className="btn btn--secondary" onClick={() => setShowFrameworkSettings(false)}>Done</button>
          </div>
        </Modal>
      )}

      {compare && (
        <Modal
          title="Previous → Proposed formulation"
          subtitle={`${FORMULATION_FRAMEWORKS.find((f) => f.value === compare.framework)?.label} · what changed, why, and with what evidence`}
          onClose={() => setCompare(undefined)}
        >
          <div className="stack-sm" style={{ maxHeight: '60vh', overflowY: 'auto' }}>
            {diffFormulations(
              formulations.find((f) => f.id === compare.previousFormulationId),
              compare,
            ).map((change) => (
              <div key={change.key} className="soft" style={{ display: 'block', padding: 10 }}>
                <div className="cluster" style={{ gap: 8 }}>
                  <strong className="small">{change.label}</strong>
                  <Badge
                    tone={change.changeType === 'unchanged' ? 'neutral' : change.changeType === 'added' ? 'green' : change.changeType === 'removed' ? 'red' : 'amber'}
                    icon={change.changeType === 'unchanged' ? 'check' : change.changeType === 'added' ? 'plus' : change.changeType === 'removed' ? 'x' : 'edit'}
                  >
                    {change.changeType}
                  </Badge>
                  {change.previousConfidence && change.proposedConfidence && change.previousConfidence !== change.proposedConfidence && (
                    <span className="muted small">
                      Confidence: {change.previousConfidence.replace(/-/g, ' ')} → {change.proposedConfidence.replace(/-/g, ' ')}
                    </span>
                  )}
                </div>
                {change.changeType !== 'added' && (
                  <div className="small" style={{ marginTop: 6 }}>
                    <strong className="muted">Previous:</strong>
                    <p className="prewrap" style={{ margin: '2px 0' }}>{change.previousText ?? '—'}</p>
                  </div>
                )}
                {change.changeType !== 'removed' && (
                  <div className="small" style={{ marginTop: 6 }}>
                    <strong className="muted">Proposed:</strong>
                    <p className="prewrap" style={{ margin: '2px 0' }}>{change.proposedText ?? '—'}</p>
                  </div>
                )}
                {change.evidenceAdded.length > 0 && (
                  <p className="muted small" style={{ margin: '4px 0 0' }}>
                    Evidence added: {change.evidenceAdded.map((e) => e.label ?? e.refType).join(', ')}
                  </p>
                )}
                {change.evidenceContradicted.length > 0 && (
                  <p className="muted small" style={{ margin: '4px 0 0' }}>
                    Contradicted by: {change.evidenceContradicted.map((e) => e.label ?? e.refType).join(', ')}
                  </p>
                )}
              </div>
            ))}
            <button className="btn btn--secondary" onClick={() => setCompare(undefined)}>Close</button>
          </div>
        </Modal>
      )}
    </div>
  );
}
