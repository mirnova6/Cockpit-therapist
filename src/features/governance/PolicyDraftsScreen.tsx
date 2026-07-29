import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon } from '../../app/components/Icon';
import { Badge, Card, Field, type BadgeTone } from '../../app/components/ui';
import {
  HIPAA_CONSCIOUS_DISCLAIMER,
  POLICY_STATUSES,
  type PolicyDraft,
  type PolicyStatus,
} from '../../core/governance/phase7Schema';
import { downloadJson, downloadText } from '../../lib/download';
import { fmtDate } from '../../lib/format';
import { useGovernanceStore } from '../../state/governanceStore';

function tone(status: PolicyStatus): BadgeTone {
  switch (status) {
    case 'adopted':
      return 'green';
    case 'reviewed-by-counsel':
      return 'blue';
    case 'in-review':
      return 'amber';
    default:
      return 'neutral';
  }
}

function policyText(p: PolicyDraft): string {
  return `COCKPIT POLICY DRAFT — ${p.title}\nCategory: ${p.category}\nStatus: ${POLICY_STATUSES.find((s) => s.value === p.status)?.label}${p.reviewer ? ` · Reviewer: ${p.reviewer}` : ''}${p.reviewedAt ? ` (${p.reviewedAt})` : ''}\nVersion: ${p.version}\n\n${p.body}`;
}

function PolicyCard({ policy }: { policy: PolicyDraft }) {
  const updatePolicy = useGovernanceStore((s) => s.updatePolicy);
  const resetPolicy = useGovernanceStore((s) => s.resetPolicy);
  const [editing, setEditing] = useState(false);
  const [body, setBody] = useState(policy.body);
  const [reviewer, setReviewer] = useState(policy.reviewer ?? '');
  const [expanded, setExpanded] = useState(false);

  const saveBody = async () => {
    await updatePolicy(policy.id, { body, reviewer: reviewer.trim() || undefined });
    setEditing(false);
  };

  const reset = async () => {
    await resetPolicy(policy.id);
    setEditing(false);
  };

  return (
    <Card title={policy.title} icon="clipboard">
      <div className="stack-sm">
        <div className="spread">
          <span className="cluster" style={{ gap: 6 }}>
            <Badge tone="neutral">{policy.category}</Badge>
            <Badge tone={tone(policy.status)}>{POLICY_STATUSES.find((s) => s.value === policy.status)?.label}</Badge>
            <span className="muted small">v{policy.version}{policy.reviewedAt ? ` · reviewed ${fmtDate(policy.reviewedAt)}` : ''}{policy.reviewer ? ` · ${policy.reviewer}` : ''}</span>
          </span>
          <select
            className="select"
            style={{ width: 'auto' }}
            value={policy.status}
            onChange={(e) => void updatePolicy(policy.id, { status: e.target.value as PolicyStatus })}
            aria-label={`Status for ${policy.title}`}
          >
            {POLICY_STATUSES.map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
        </div>

        {!editing ? (
          <>
            <pre
              className="soft small"
              style={{ display: 'block', whiteSpace: 'pre-wrap', wordBreak: 'break-word', padding: 12, margin: 0, maxHeight: expanded ? 'none' : 160, overflow: 'hidden' }}
            >
              {policy.body}
            </pre>
            <div className="cluster">
              <button className="btn btn--ghost btn--sm" onClick={() => setExpanded((v) => !v)}>
                {expanded ? 'Collapse' : 'Show full text'}
              </button>
              <button className="btn btn--secondary btn--sm" onClick={() => { setBody(policy.body); setEditing(true); }}>
                <Icon name="edit" size={13} /> Edit
              </button>
              <button className="btn btn--ghost btn--sm" onClick={() => downloadText(`policy-${policy.key}.txt`, policyText(policy))}>
                <Icon name="download" size={13} /> Export
              </button>
              <button className="btn btn--ghost btn--sm" onClick={() => void reset()}>Reset to template</button>
            </div>
          </>
        ) : (
          <>
            <textarea className="input" rows={14} value={body} onChange={(e) => setBody(e.target.value)} style={{ fontFamily: 'ui-monospace, monospace', fontSize: '0.8rem' }} />
            <Field label="Reviewer (optional)">
              <input className="input" value={reviewer} onChange={(e) => setReviewer(e.target.value)} />
            </Field>
            <div className="cluster">
              <button className="btn btn--primary btn--sm" onClick={() => void saveBody()}>
                <Icon name="check" size={13} /> Save draft
              </button>
              <button className="btn btn--ghost btn--sm" onClick={() => setEditing(false)}>Cancel</button>
            </div>
          </>
        )}
      </div>
    </Card>
  );
}

export function PolicyDraftsScreen() {
  const navigate = useNavigate();
  const policies = useGovernanceStore((s) => s.policies);
  const loadPhase7 = useGovernanceStore((s) => s.loadPhase7);

  useEffect(() => {
    void loadPhase7();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const date = new Date().toISOString().slice(0, 10);
  const exportAll = () =>
    downloadText(
      `cockpit-policies-${date}.txt`,
      [
        'COCKPIT — POLICY & DISCLOSURE DRAFTS',
        `Generated: ${new Date().toISOString()}`,
        '',
        HIPAA_CONSCIOUS_DISCLAIMER,
        '',
        ...policies.map((p) => `\n${'='.repeat(60)}\n${policyText(p)}`),
      ].join('\n'),
    );

  return (
    <main id="main-content" tabIndex={-1} className="page">
      <div className="stack" style={{ maxWidth: 1000, margin: '0 auto' }}>
        <div className="spread">
          <button className="btn btn--ghost btn--sm" onClick={() => navigate('/governance')}>
            <Icon name="chevron-left" size={15} /> Readiness dashboard
          </button>
        </div>

        <Card title="Policy & disclosure drafts" icon="clipboard">
          <div className="stack-sm">
            <p className="muted small" style={{ margin: 0 }}>
              Editable templates to prepare for legal/security review. Each is a DRAFT starting point, not legal advice,
              and adopting them does not by itself establish HIPAA compliance. {HIPAA_CONSCIOUS_DISCLAIMER}
            </p>
            <div className="cluster">
              <button className="btn btn--secondary btn--sm" onClick={exportAll}>
                <Icon name="download" size={13} /> Export all (text)
              </button>
              <button className="btn btn--secondary btn--sm" onClick={() => downloadJson(`cockpit-policies-${date}.json`, policies)}>
                <Icon name="download" size={13} /> Export all (JSON)
              </button>
            </div>
          </div>
        </Card>

        {policies.map((policy) => (
          <PolicyCard key={policy.id} policy={policy} />
        ))}
      </div>
    </main>
  );
}
