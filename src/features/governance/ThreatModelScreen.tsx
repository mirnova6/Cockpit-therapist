import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon } from '../../app/components/Icon';
import { Badge, Card, Field, type BadgeTone } from '../../app/components/ui';
import {
  HIPAA_CONSCIOUS_DISCLAIMER,
  THREAT_REVIEW_STATUSES,
  type ThreatModelItem,
  type ThreatReviewStatus,
} from '../../core/governance/phase7Schema';
import { downloadJson, downloadText } from '../../lib/download';
import { fmtDate } from '../../lib/format';
import { useGovernanceStore } from '../../state/governanceStore';

function tone(status: ThreatReviewStatus): BadgeTone {
  switch (status) {
    case 'reviewed':
    case 'mitigation-in-place':
      return 'green';
    case 'needs-action':
      return 'red';
    case 'accepted-residual-risk':
      return 'amber';
    default:
      return 'neutral';
  }
}

function renderText(items: ThreatModelItem[]): string {
  const lines = ['COCKPIT — THREAT MODEL', `Generated: ${new Date().toISOString()}`, '', HIPAA_CONSCIOUS_DISCLAIMER, ''];
  for (const t of items) {
    lines.push(
      `== ${t.threat} (${t.category}) ==`,
      `Review status: ${THREAT_REVIEW_STATUSES.find((s) => s.value === t.reviewStatus)?.label}`,
      `Risk: ${t.riskDescription}`,
      `Current mitigation: ${t.currentMitigation}`,
      `Remaining risk: ${t.remainingRisk}`,
      `Required action before real use: ${t.requiredActionBeforeUse}`,
      t.reviewer ? `Reviewer: ${t.reviewer}${t.reviewedAt ? ` (${t.reviewedAt})` : ''}` : '',
      t.notes ? `Notes: ${t.notes}` : '',
      '',
    );
  }
  return lines.filter((l) => l !== '').join('\n');
}

function ThreatRow({ item }: { item: ThreatModelItem }) {
  const updateThreatItem = useGovernanceStore((s) => s.updateThreatItem);
  const [open, setOpen] = useState(false);
  const [notes, setNotes] = useState(item.notes ?? '');
  const [reviewer, setReviewer] = useState(item.reviewer ?? '');
  const [remainingRisk, setRemainingRisk] = useState(item.remainingRisk);
  const [requiredAction, setRequiredAction] = useState(item.requiredActionBeforeUse);

  const save = async (status?: ThreatReviewStatus) => {
    await updateThreatItem(item.id, {
      reviewStatus: status ?? item.reviewStatus,
      notes: notes.trim() || undefined,
      reviewer: reviewer.trim() || undefined,
      remainingRisk: remainingRisk.trim(),
      requiredActionBeforeUse: requiredAction.trim(),
    });
    setOpen(false);
  };

  return (
    <div className="soft" style={{ display: 'block', padding: 12 }}>
      <div className="spread">
        <span className="small" style={{ flex: 1 }}>
          <strong>{item.threat}</strong> <span className="muted">· {item.category}</span>
          {item.reviewedAt && (
            <span className="muted" style={{ display: 'block' }}>
              Reviewed {fmtDate(item.reviewedAt)}{item.reviewer ? ` by ${item.reviewer}` : ''}
            </span>
          )}
        </span>
        <div className="cluster">
          <Badge tone={tone(item.reviewStatus)}>{THREAT_REVIEW_STATUSES.find((s) => s.value === item.reviewStatus)?.label}</Badge>
          <button className="btn btn--ghost btn--sm" onClick={() => setOpen((v) => !v)}>
            <Icon name="edit" size={13} />
          </button>
        </div>
      </div>
      <dl className="kv small" style={{ margin: '8px 0 0' }}>
        <dt>Risk</dt>
        <dd>{item.riskDescription}</dd>
        <dt>Current mitigation</dt>
        <dd>{item.currentMitigation}</dd>
        <dt>Remaining risk</dt>
        <dd>{item.remainingRisk}</dd>
        <dt>Required before use</dt>
        <dd>{item.requiredActionBeforeUse}</dd>
        {item.notes && (
          <>
            <dt>Notes</dt>
            <dd>{item.notes}</dd>
          </>
        )}
      </dl>
      {open && (
        <div className="stack-sm" style={{ marginTop: 10 }}>
          <div className="cluster" style={{ flexWrap: 'wrap' }}>
            <Field label="Review status">
              <select className="select" value={item.reviewStatus} onChange={(e) => void save(e.target.value as ThreatReviewStatus)}>
                {THREAT_REVIEW_STATUSES.map((s) => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
              </select>
            </Field>
            <Field label="Reviewer">
              <input className="input" value={reviewer} onChange={(e) => setReviewer(e.target.value)} />
            </Field>
          </div>
          <Field label="Remaining risk (editable for your environment)">
            <textarea className="input" rows={2} value={remainingRisk} onChange={(e) => setRemainingRisk(e.target.value)} />
          </Field>
          <Field label="Required action before real use">
            <textarea className="input" rows={2} value={requiredAction} onChange={(e) => setRequiredAction(e.target.value)} />
          </Field>
          <Field label="Notes">
            <input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
          <div className="cluster">
            <button className="btn btn--primary btn--sm" onClick={() => void save()}>
              <Icon name="check" size={13} /> Save
            </button>
            <button className="btn btn--ghost btn--sm" onClick={() => setOpen(false)}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}

export function ThreatModelScreen() {
  const navigate = useNavigate();
  const threatModel = useGovernanceStore((s) => s.threatModel);
  const loadPhase7 = useGovernanceStore((s) => s.loadPhase7);

  useEffect(() => {
    void loadPhase7();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const reviewed = threatModel.filter((t) => t.reviewStatus === 'reviewed').length;
  const date = new Date().toISOString().slice(0, 10);

  return (
    <main className="page">
      <div className="stack" style={{ maxWidth: 1000, margin: '0 auto' }}>
        <div className="spread">
          <button className="btn btn--ghost btn--sm" onClick={() => navigate('/governance')}>
            <Icon name="chevron-left" size={15} /> Readiness dashboard
          </button>
          <Badge tone={reviewed === threatModel.length && threatModel.length > 0 ? 'green' : 'amber'} icon="check">
            {reviewed}/{threatModel.length} reviewed
          </Badge>
        </div>

        <Card title="Threat model" icon="alert">
          <div className="stack-sm">
            <p className="muted small" style={{ margin: 0 }}>{HIPAA_CONSCIOUS_DISCLAIMER}</p>
            <div className="cluster">
              <button className="btn btn--secondary btn--sm" onClick={() => downloadText(`cockpit-threat-model-${date}.txt`, renderText(threatModel))}>
                <Icon name="download" size={13} /> Export text
              </button>
              <button className="btn btn--secondary btn--sm" onClick={() => downloadJson(`cockpit-threat-model-${date}.json`, threatModel)}>
                <Icon name="download" size={13} /> Export JSON
              </button>
            </div>
          </div>
        </Card>

        <Card title="Threats, mitigations & residual risk" icon="clipboard">
          <div className="stack-sm">
            {threatModel.map((item) => (
              <ThreatRow key={item.id} item={item} />
            ))}
          </div>
        </Card>
      </div>
    </main>
  );
}
