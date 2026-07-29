import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon } from '../../app/components/Icon';
import { Badge, Card } from '../../app/components/ui';
import {
  computePhiGateStatus,
  HIPAA_CONSCIOUS_DISCLAIMER,
  type PhiGateItem,
} from '../../core/governance/phase7Schema';
import { fmtDateTime } from '../../lib/format';
import { useGovernanceStore } from '../../state/governanceStore';

function GateRow({ item }: { item: PhiGateItem }) {
  const setPhiGateItem = useGovernanceStore((s) => s.setPhiGateItem);
  const [open, setOpen] = useState(false);
  const [approver, setApprover] = useState(item.completedBy ?? '');
  const [notes, setNotes] = useState(item.notes ?? '');
  const [err, setErr] = useState<string>();

  const toggle = async (complete: boolean) => {
    setErr(undefined);
    try {
      await setPhiGateItem(item.id, { complete, completedBy: approver.trim() || undefined, notes: notes.trim() || undefined });
      setOpen(false);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not update this item.');
    }
  };

  return (
    <div className="soft" style={{ display: 'block', padding: 12 }}>
      <div className="spread">
        <span className="small" style={{ flex: 1 }}>
          <strong>
            {item.requiresNamedApproval && <Icon name="shield" size={13} className="soft" />}{' '}
            {item.label}
          </strong>
          <span className="muted" style={{ display: 'block', marginTop: 2 }}>{item.detail}</span>
          {item.complete && (
            <span className="muted" style={{ display: 'block', marginTop: 4 }}>
              Marked complete {item.completedAt ? fmtDateTime(item.completedAt) : ''}
              {item.completedBy ? ` by ${item.completedBy}` : ''}
              {item.notes ? ` — ${item.notes}` : ''}
            </span>
          )}
        </span>
        <div className="cluster">
          <Badge tone={item.complete ? 'green' : 'neutral'} icon={item.complete ? 'check' : undefined}>
            {item.complete ? 'Complete' : 'Incomplete'}
          </Badge>
          <button className="btn btn--ghost btn--sm" onClick={() => setOpen((v) => !v)}>
            <Icon name="edit" size={13} />
          </button>
        </div>
      </div>
      {open && (
        <div className="stack-sm" style={{ marginTop: 10 }}>
          <label className="field">
            <span className="field__label">
              {item.requiresNamedApproval ? 'Named approver (required)' : 'Completed / reviewed by (optional)'}
            </span>
            <input className="input" value={approver} onChange={(e) => setApprover(e.target.value)} placeholder="Full name of reviewer" />
          </label>
          <label className="field">
            <span className="field__label">Notes / evidence</span>
            <input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Reference to the review, test, or document" />
          </label>
          {err && (
            <div className="notice notice--danger" role="alert">
              <Icon name="alert" size={15} /> <span className="small">{err}</span>
            </div>
          )}
          <div className="cluster">
            {!item.complete ? (
              <button className="btn btn--primary btn--sm" onClick={() => void toggle(true)}>
                <Icon name="check" size={13} /> Mark complete
              </button>
            ) : (
              <button className="btn btn--secondary btn--sm" onClick={() => void toggle(false)}>
                Reopen (mark incomplete)
              </button>
            )}
            <button className="btn btn--ghost btn--sm" onClick={() => setOpen(false)}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}

export function PhiGateScreen() {
  const navigate = useNavigate();
  const phiGate = useGovernanceStore((s) => s.phiGate);
  const loadPhase7 = useGovernanceStore((s) => s.loadPhase7);

  useEffect(() => {
    void loadPhase7();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const status = useMemo(() => computePhiGateStatus(phiGate), [phiGate]);

  return (
    <main id="main-content" tabIndex={-1} className="page">
      <div className="stack" style={{ maxWidth: 900, margin: '0 auto' }}>
        <div className="spread">
          <button className="btn btn--ghost btn--sm" onClick={() => navigate('/governance')}>
            <Icon name="chevron-left" size={15} /> Readiness dashboard
          </button>
          <Badge tone={status.blocked ? 'red' : 'amber'} icon="shield">
            {status.completed}/{status.total} complete
          </Badge>
        </div>

        <Card title="Real PHI Readiness Gate" icon="shield">
          <div className="stack-sm">
            <div className={`notice ${status.blocked ? 'notice--danger' : 'notice--warn'}`} role="status">
              <Icon name={status.blocked ? 'lock' : 'unlock'} size={18} />
              <span>
                <strong>{status.statusLine}</strong>
                <span className="small" style={{ display: 'block', marginTop: 2 }}>
                  {status.blocked
                    ? 'Real PHI use is blocked by default. The status changes only after EVERY item below is marked complete through explicit manual review, ending with a named final approval.'
                    : 'Every required item was completed through manual review, ending with a named final approval. This is not a legal certification.'}
                </span>
              </span>
            </div>
            <p className="muted small" style={{ margin: 0 }}>{HIPAA_CONSCIOUS_DISCLAIMER}</p>
          </div>
        </Card>

        <Card title="Required gates" icon="clipboard">
          <div className="stack-sm">
            {phiGate.map((item) => (
              <GateRow key={item.id} item={item} />
            ))}
          </div>
        </Card>

        {status.blocked && status.incompleteLabels.length > 0 && (
          <Card title="Still required" icon="alert">
            <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
              {status.incompleteLabels.map((label) => (
                <li key={label}>{label}</li>
              ))}
            </ul>
          </Card>
        )}
      </div>
    </main>
  );
}
