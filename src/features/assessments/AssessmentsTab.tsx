import { useEffect, useMemo, useState } from 'react';
import { Link, useOutletContext } from 'react-router-dom';
import { Icon } from '../../app/components/Icon';
import { ReviewStatusBadge, RiskFlagBadge } from '../../app/components/clinicalBadges';
import { Badge, Card, EmptyState } from '../../app/components/ui';
import { VersionCompareModal } from '../../app/components/VersionCompareModal';
import {
  getDefinition,
  NOT_CONFIGURED_TEXT,
  scoreChange,
} from '../../core/assessments/definitions';
import type { AssessmentRecord, VersionRecord } from '../../core/db/structuredSchema';
import { fmtDate } from '../../lib/format';
import { useStructuredStore } from '../../state/structuredStore';
import type { ClientContext } from '../dashboard/ClientDashboardLayout';
import { AssessmentFormModal } from './AssessmentFormModal';
import { TrendChart } from './TrendChart';

function ChangeIndicator({ record, history }: { record: AssessmentRecord; history: AssessmentRecord[] }) {
  const change = scoreChange(record, history);
  if (!change) return <span className="muted small">first score</span>;
  const arrow = change.delta === 0 ? '→' : change.delta > 0 ? '↑' : '↓';
  const tone =
    change.direction === 'improved' ? 'var(--green)' : change.direction === 'worsened' ? 'var(--red)' : 'var(--ink-faint)';
  return (
    <span className="small" style={{ color: tone, fontWeight: 600 }}>
      {arrow} {change.delta > 0 ? '+' : ''}{change.delta} ({change.direction})
      {change.clinicallyMeaningful !== undefined && (
        <span className="muted" style={{ fontWeight: 500 }}>
          {' '}· {change.clinicallyMeaningful ? 'clinically meaningful change' : 'below meaningful-change threshold'}
        </span>
      )}
    </span>
  );
}

export function AssessmentsTab() {
  const { client } = useOutletContext<ClientContext>();
  const data = useStructuredStore((s) => s.byClient[client.id]);
  const loadClient = useStructuredStore((s) => s.loadClient);
  const decideAssessment = useStructuredStore((s) => s.decideAssessment);
  const [showAdd, setShowAdd] = useState(false);
  const [compare, setCompare] = useState<{ version: VersionRecord; current: AssessmentRecord } | null>(null);
  const [dispositionDrafts, setDispositionDrafts] = useState<Record<string, string>>({});

  useEffect(() => {
    void loadClient(client.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client.id]);

  const assessments = data?.assessments ?? [];
  const versions = data?.versions ?? [];

  const byMeasure = useMemo(() => {
    const groups = new Map<string, AssessmentRecord[]>();
    for (const record of assessments) {
      const key = `${record.definitionKey}:${record.name}`;
      groups.set(key, [...(groups.get(key) ?? []), record]);
    }
    return [...groups.entries()];
  }, [assessments]);

  const pendingRisk = assessments.filter(
    (a) => a.riskFlags.length > 0 && a.reviewStatus === 'pending',
  );

  return (
    <div className="stack">
      <div className="spread">
        <div>
          <h2>Assessments</h2>
          <p className="muted small">
            Screening scores over time. Interpretations come only from encoded official rules and
            are never diagnoses.
          </p>
        </div>
        <button className="btn btn--primary" onClick={() => setShowAdd(true)}>
          <Icon name="plus" size={15} /> Record assessment
        </button>
      </div>

      {pendingRisk.length > 0 && (
        <div className="notice notice--danger" role="alert">
          <Icon name="alert" size={18} />
          <span className="small">
            <strong>{pendingRisk.length} risk-flagged assessment{pendingRisk.length > 1 ? 's' : ''} awaiting individual review below.</strong>{' '}
            Bulk actions never apply to these.
          </span>
        </div>
      )}

      {assessments.length === 0 ? (
        <Card>
          <EmptyState icon="activity" title="No assessments recorded">
            <p>Enter scores manually or approve extracted scores from clinical inputs.</p>
          </EmptyState>
        </Card>
      ) : (
        byMeasure.map(([key, records]) => {
          const def = getDefinition(records[0].definitionKey);
          const chronological = [...records].sort(
            (a, b) => a.dateAdministered.localeCompare(b.dateAdministered) || a.createdAt.localeCompare(b.createdAt),
          );
          return (
            <Card key={key} title={records[0].name} icon="activity">
              <div className="stack">
                {def && <p className="muted small">{def.fullName}. {def.screeningNote}</p>}
                <TrendChart records={chronological.filter((r) => r.reviewStatus !== 'rejected')} />

                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.88rem' }}>
                    <thead>
                      <tr style={{ textAlign: 'left', color: 'var(--ink-faint)' }}>
                        <th style={{ padding: '6px 8px' }}>Date</th>
                        <th style={{ padding: '6px 8px' }}>Score</th>
                        <th style={{ padding: '6px 8px' }}>Change</th>
                        <th style={{ padding: '6px 8px' }}>Interpretation (encoded rules)</th>
                        <th style={{ padding: '6px 8px' }}>Status</th>
                        <th style={{ padding: '6px 8px' }}></th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...chronological].reverse().map((record) => {
                        const recordVersions = versions.filter(
                          (v) => v.entityType === 'assessment' && v.entityId === record.id,
                        );
                        return (
                          <tr key={record.id} style={{ borderTop: '1px solid var(--line)' }}>
                            <td style={{ padding: '8px', whiteSpace: 'nowrap' }}>{fmtDate(record.dateAdministered)}</td>
                            <td style={{ padding: '8px', fontWeight: 650 }}>
                              {record.totalScore ?? '—'}
                              {record.subscaleScores && record.subscaleScores.length > 0 && (
                                <span className="muted small" style={{ display: 'block', fontWeight: 400 }}>
                                  {record.subscaleScores.map((s) => `${s.label}: ${s.score}`).join(' · ')}
                                </span>
                              )}
                            </td>
                            <td style={{ padding: '8px' }}>
                              <ChangeIndicator record={record} history={chronological} />
                            </td>
                            <td style={{ padding: '8px', maxWidth: 320 }}>
                              <span className="small soft">
                                {record.severityInterpretation ?? NOT_CONFIGURED_TEXT}
                              </span>
                              {record.clinicianNotes && (
                                <span className="muted small" style={{ display: 'block' }}>
                                  Note: {record.clinicianNotes}
                                </span>
                              )}
                              {record.riskDisposition && (
                                <span className="muted small" style={{ display: 'block' }}>
                                  Disposition: {record.riskDisposition}
                                </span>
                              )}
                            </td>
                            <td style={{ padding: '8px' }}>
                              <div className="stack-sm" style={{ gap: 4, alignItems: 'flex-start' }}>
                                <ReviewStatusBadge status={record.reviewStatus} />
                                {record.riskFlags.length > 0 && <RiskFlagBadge />}
                                {record.sourceInputId && (
                                  <Link className="small" to={`../inputs/${record.sourceInputId}`}>
                                    View source
                                  </Link>
                                )}
                              </div>
                            </td>
                            <td style={{ padding: '8px', whiteSpace: 'nowrap' }}>
                              {recordVersions.length > 0 && (
                                <button
                                  className="btn btn--ghost btn--sm"
                                  onClick={() => setCompare({ version: recordVersions[0], current: record })}
                                >
                                  <Icon name="clock" size={13} /> v{record.version}
                                </button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Individual review controls for pending risk-flagged entries */}
                {chronological
                  .filter((r) => r.reviewStatus === 'pending' && r.riskFlags.length > 0)
                  .map((record) => (
                    <div key={record.id} className="notice notice--danger" style={{ display: 'block' }}>
                      <strong className="small">
                        <Icon name="alert" size={14} /> Individual review required — {record.name} ({fmtDate(record.dateAdministered)})
                      </strong>
                      <p className="small" style={{ margin: '6px 0' }}>
                        Flags: {record.riskFlags.join(', ')}. Record your disposition to approve.
                      </p>
                      <textarea
                        className="textarea"
                        style={{ minHeight: 60, marginBottom: 8 }}
                        placeholder="Disposition / follow-up (required to approve)"
                        value={dispositionDrafts[record.id] ?? record.riskDisposition ?? ''}
                        onChange={(e) => setDispositionDrafts({ ...dispositionDrafts, [record.id]: e.target.value })}
                      />
                      <div className="cluster">
                        <button
                          className="btn btn--primary btn--sm"
                          disabled={!(dispositionDrafts[record.id] ?? record.riskDisposition)?.trim()}
                          onClick={() =>
                            void decideAssessment(record.id, client.id, 'approve', dispositionDrafts[record.id])
                          }
                        >
                          <Icon name="check" size={13} /> Approve with disposition
                        </button>
                        <button
                          className="btn btn--danger btn--sm"
                          onClick={() => void decideAssessment(record.id, client.id, 'reject')}
                        >
                          Reject
                        </button>
                      </div>
                    </div>
                  ))}

                {/* Non-risk pending entries (e.g. extracted scores) */}
                {chronological
                  .filter((r) => r.reviewStatus === 'pending' && r.riskFlags.length === 0)
                  .map((record) => (
                    <div key={record.id} className="cluster" style={{ padding: '8px 0' }}>
                      <Badge tone="amber" icon="clock">Pending: {record.name} {record.totalScore} ({fmtDate(record.dateAdministered)})</Badge>
                      <button className="btn btn--primary btn--sm" onClick={() => void decideAssessment(record.id, client.id, 'approve')}>
                        <Icon name="check" size={13} /> Approve
                      </button>
                      <button className="btn btn--danger btn--sm" onClick={() => void decideAssessment(record.id, client.id, 'reject')}>
                        Reject
                      </button>
                    </div>
                  ))}
              </div>
            </Card>
          );
        })
      )}

      {showAdd && <AssessmentFormModal clientId={client.id} onClose={() => setShowAdd(false)} />}
      {compare && (
        <VersionCompareModal
          version={compare.version}
          current={compare.current}
          onClose={() => setCompare(null)}
        />
      )}
    </div>
  );
}
