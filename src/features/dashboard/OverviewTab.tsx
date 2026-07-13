import { useEffect, useState } from 'react';
import { Link, useNavigate, useOutletContext } from 'react-router-dom';
import { Icon } from '../../app/components/Icon';
import { Badge, Card, EmptyState, RiskBadge, riskDescription } from '../../app/components/ui';
import {
  CLIENT_STATUSES,
  LEVELS_OF_CARE,
  inputTypeLabel,
} from '../../core/db/schema';
import { ageFromDob, fmtDate, fmtDateTime, relTime } from '../../lib/format';
import { useDataStore } from '../../state/dataStore';
import type { ClientContext } from './ClientDashboardLayout';
import { RiskUpdateModal } from './RiskUpdateModal';

export function OverviewTab() {
  const { client } = useOutletContext<ClientContext>();
  const navigate = useNavigate();
  const inputs = useDataStore((s) => s.inputs[client.id]) ?? [];
  const changes = useDataStore((s) => s.changes[client.id]) ?? [];
  const refreshClient = useDataStore((s) => s.refreshClient);
  const [showRiskModal, setShowRiskModal] = useState(false);

  useEffect(() => {
    void refreshClient(client.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client.id]);

  const pendingRisk = inputs.filter((i) => i.containsRisk && !i.riskReview);
  const recentInputs = inputs.slice(0, 5);
  const age = ageFromDob(client.dateOfBirth);
  const locLabel = LEVELS_OF_CARE.find((l) => l.value === client.levelOfCare)?.label ?? client.levelOfCare;
  const statusLabel = CLIENT_STATUSES.find((s) => s.value === client.status)?.label ?? client.status;

  return (
    <div className="stack" style={{ gap: 16 }}>
      {pendingRisk.length > 0 && (
        <div className="notice notice--danger" role="alert" style={{ alignItems: 'center' }}>
          <Icon name="alert" size={20} />
          <span style={{ flex: 1 }}>
            <strong>{pendingRisk.length} risk-flagged {pendingRisk.length === 1 ? 'entry' : 'entries'} awaiting your review.</strong>{' '}
            Risk determinations always require clinician confirmation.
          </span>
          <button className="btn btn--danger btn--sm" onClick={() => navigate(`../inputs/${pendingRisk[0].id}`)}>
            Review now
          </button>
        </div>
      )}

      <div className="grid-cards">
        <Card title="Current clinical snapshot" icon="clipboard">
          <dl className="kv">
            <dt>Status</dt>
            <dd>{statusLabel}</dd>
            <dt>Level of care</dt>
            <dd>{locLabel}</dd>
            <dt>Age</dt>
            <dd>{age !== undefined ? `${age}` : 'Not documented'}</dd>
            <dt>Admitted</dt>
            <dd>{fmtDate(client.admissionDate)}</dd>
            <dt>Therapist</dt>
            <dd>{client.assignedTherapist ?? 'Not documented'}</dd>
            <dt>Identifier</dt>
            <dd>{client.preferredIdentifier ?? '—'}</dd>
          </dl>
        </Card>

        <Card title="Presenting problem" icon="user">
          {client.presentingProblem ? (
            <p className="prewrap soft">{client.presentingProblem}</p>
          ) : (
            <p className="muted">
              Not yet documented. <Link to="../settings">Add it in client settings</Link> or capture it
              in a BPS entry.
            </p>
          )}
        </Card>

        <Card
          title="Diagnoses & impressions"
          icon="clipboard"
          action={<Link className="small" to="../settings">Edit</Link>}
        >
          {client.diagnoses.length > 0 ? (
            <ul style={{ margin: 0, padding: 0, listStyle: 'none' }} className="stack-sm">
              {client.diagnoses.map((d) => (
                <li key={d.id} className="spread" style={{ gap: 8 }}>
                  <span className="soft">{d.label}{d.code ? <span className="muted"> · {d.code}</span> : null}</span>
                  <Badge tone={d.kind === 'diagnosis' ? 'blue' : 'plum'}>
                    {d.kind === 'diagnosis' ? 'Documented diagnosis' : 'Impression'}
                  </Badge>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">Not yet documented.</p>
          )}
        </Card>

        <Card
          title="Medications"
          icon="pill"
          action={<Link className="small" to="../settings">Edit</Link>}
        >
          {client.medications.length > 0 ? (
            <ul style={{ margin: 0, padding: 0, listStyle: 'none' }} className="stack-sm">
              {client.medications.map((m) => (
                <li key={m.id} className="spread" style={{ gap: 8 }}>
                  <span className="soft">
                    {m.name}
                    {m.dose ? ` ${m.dose}` : ''}
                    {m.frequency ? ` · ${m.frequency}` : ''}
                  </span>
                  <Badge tone={m.status === 'current' ? 'green' : 'neutral'}>
                    {m.status === 'current' ? 'Current' : 'Discontinued'}
                  </Badge>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">Not yet documented.</p>
          )}
        </Card>

        <Card
          title="Risk & safety status"
          icon="shield"
          action={
            <button className="btn btn--secondary btn--sm" onClick={() => setShowRiskModal(true)}>
              Update
            </button>
          }
        >
          <div className="stack-sm">
            <RiskBadge level={client.risk.level} />
            <p className="muted">{riskDescription(client.risk.level)}</p>
            {client.risk.note && <p className="prewrap soft small">{client.risk.note}</p>}
            <p className="muted small">
              {client.risk.reviewedAt
                ? `Confirmed by ${client.risk.reviewedBy ?? 'clinician'} · ${fmtDateTime(client.risk.reviewedAt)}`
                : 'Not yet confirmed by clinician review.'}
            </p>
          </div>
        </Card>

        <Card
          title="Recent clinical inputs"
          icon="file"
          action={<Link className="small" to="../inputs">View all</Link>}
        >
          {recentInputs.length > 0 ? (
            <div className="row-list">
              {recentInputs.map((input) => (
                <button key={input.id} className="list-row" onClick={() => navigate(`../inputs/${input.id}`)}>
                  <Icon name="file" size={16} className="soft" />
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <strong className="small" style={{ display: 'block' }}>{inputTypeLabel(input.inputType)}</strong>
                    <span className="muted small">{fmtDate(input.dateOfInformation)}</span>
                  </span>
                  {input.containsRisk && (
                    <Badge tone={input.riskReview ? 'amber' : 'red'} icon="alert">
                      {input.riskReview ? 'Risk · reviewed' : 'Risk · review'}
                    </Badge>
                  )}
                </button>
              ))}
            </div>
          ) : (
            <EmptyState icon="file" title="No clinical information yet">
              <Link to="../add" className="btn btn--primary btn--sm" style={{ marginTop: 4 }}>
                <Icon name="plus" size={14} /> Add clinical information
              </Link>
            </EmptyState>
          )}
        </Card>

        <Card title="Recent changes" icon="activity">
          {changes.length > 0 ? (
            <div className="stack-sm" style={{ gap: 10 }}>
              {changes.slice(0, 8).map((change) => (
                <div key={change.id} className="small">
                  <span className="soft">{change.summary}</span>
                  <span className="muted" style={{ display: 'block' }}>
                    {change.author} · {relTime(change.at)}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="muted">Changes to this record will appear here with author and date.</p>
          )}
        </Card>
      </div>

      {showRiskModal && (
        <RiskUpdateModal client={client} onClose={() => setShowRiskModal(false)} />
      )}
    </div>
  );
}
