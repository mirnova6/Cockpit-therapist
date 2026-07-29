import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon } from '../../app/components/Icon';
import { Badge, Card, EmptyState, Field } from '../../app/components/ui';
import { FEEDBACK_LABELS, type FeedbackLabel } from '../../core/ai/aiSchema';
import { fmtDateTime } from '../../lib/format';
import { useDataStore } from '../../state/dataStore';
import { useGovernanceStore } from '../../state/governanceStore';

const NEGATIVE_LABELS: FeedbackLabel[] = [
  'inaccurate',
  'missed-risk',
  'missed-contradiction',
  'clinically-inappropriate',
  'over-pathologized',
];

export function FeedbackDashboard() {
  const navigate = useNavigate();
  const feedback = useGovernanceStore((s) => s.feedback);
  const operations = useGovernanceStore((s) => s.operations);
  const loadFeedback = useGovernanceStore((s) => s.loadFeedback);
  const clients = useDataStore((s) => s.clients);

  const [clientFilter, setClientFilter] = useState('all');
  const [labelFilter, setLabelFilter] = useState<'all' | FeedbackLabel>('all');
  const [targetFilter, setTargetFilter] = useState('all');
  const [providerFilter, setProviderFilter] = useState('all');
  const [sinceDate, setSinceDate] = useState('');

  useEffect(() => {
    void loadFeedback();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const opById = useMemo(() => new Map(operations.map((op) => [op.id, op])), [operations]);

  const visible = useMemo(
    () =>
      feedback.filter((f) => {
        const op = f.operationId ? opById.get(f.operationId) : undefined;
        return (
          (clientFilter === 'all' || f.clientId === clientFilter) &&
          (labelFilter === 'all' || f.labels.includes(labelFilter)) &&
          (targetFilter === 'all' || f.targetType === targetFilter) &&
          (providerFilter === 'all' || op?.providerId === providerFilter || (!op && providerFilter === 'deterministic')) &&
          (!sinceDate || f.at.slice(0, 10) >= sinceDate)
        );
      }),
    [feedback, clientFilter, labelFilter, targetFilter, providerFilter, sinceDate, opById],
  );

  const counts = useMemo(() => {
    const map = new Map<FeedbackLabel, number>();
    for (const record of visible) {
      for (const label of record.labels) map.set(label, (map.get(label) ?? 0) + 1);
    }
    return map;
  }, [visible]);

  const targetTypes = [...new Set(feedback.map((f) => f.targetType))];
  const providerIds = [...new Set(operations.map((op) => op.providerId))];
  const maxCount = Math.max(1, ...counts.values());

  return (
    <main id="main-content" tabIndex={-1} className="page">
      <div className="stack" style={{ maxWidth: 1000, margin: '0 auto' }}>
        <div className="spread">
          <button className="btn btn--ghost btn--sm" onClick={() => navigate('/settings')}>
            <Icon name="chevron-left" size={15} /> Workspace settings
          </button>
        </div>

        <Card title="Clinician feedback dashboard" icon="edit">
          <p className="muted small" style={{ margin: 0 }}>
            Read-only trends across your ratings of AI outputs. Feedback never changes official records, never
            crosses clients, and is never used to train a model. Counts reflect the filters below.
          </p>
        </Card>

        <div className="cluster" style={{ flexWrap: 'wrap' }}>
          <Field label="Client">
            <select className="select" value={clientFilter} onChange={(e) => setClientFilter(e.target.value)}>
              <option value="all">All clients</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>{c.displayName}</option>
              ))}
            </select>
          </Field>
          <Field label="Feedback type">
            <select className="select" value={labelFilter} onChange={(e) => setLabelFilter(e.target.value as never)}>
              <option value="all">All types</option>
              {FEEDBACK_LABELS.map((l) => (
                <option key={l.value} value={l.value}>{l.label}</option>
              ))}
            </select>
          </Field>
          <Field label="Output type">
            <select className="select" value={targetFilter} onChange={(e) => setTargetFilter(e.target.value)}>
              <option value="all">All outputs</option>
              {targetTypes.map((t) => (
                <option key={t} value={t}>{t.replace(/-/g, ' ')}</option>
              ))}
            </select>
          </Field>
          <Field label="Provider">
            <select className="select" value={providerFilter} onChange={(e) => setProviderFilter(e.target.value)}>
              <option value="all">All providers</option>
              <option value="deterministic">deterministic (no op link)</option>
              {providerIds.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          </Field>
          <Field label="Since date">
            <input className="input" type="date" value={sinceDate} onChange={(e) => setSinceDate(e.target.value)} />
          </Field>
        </div>

        <Card title={`Label totals (${visible.length} feedback entr${visible.length === 1 ? 'y' : 'ies'})`} icon="activity">
          {counts.size === 0 ? (
            <EmptyState icon="edit" title="No feedback recorded yet">
              <p className="small">Use “Rate this AI output” on any AI-generated content to build these trends.</p>
            </EmptyState>
          ) : (
            <div className="stack-sm">
              {FEEDBACK_LABELS.filter((l) => (counts.get(l.value) ?? 0) > 0).map((label) => {
                const count = counts.get(label.value) ?? 0;
                const negative = NEGATIVE_LABELS.includes(label.value);
                return (
                  <div key={label.value} className="cluster" style={{ gap: 10 }}>
                    <span className="small" style={{ width: 190 }}>{label.label}</span>
                    <div style={{ flex: 1, background: 'var(--surface-2)', borderRadius: 6, height: 14 }}>
                      <div
                        style={{
                          width: `${(count / maxCount) * 100}%`,
                          height: '100%',
                          borderRadius: 6,
                          background: negative ? 'var(--red)' : 'var(--brand)',
                        }}
                        aria-hidden
                      />
                    </div>
                    <Badge tone={negative ? 'red' : 'blue'}>{count}</Badge>
                  </div>
                );
              })}
            </div>
          )}
        </Card>

        {visible.length > 0 && (
          <Card title="Entries" icon="list">
            <div className="row-list">
              {visible.slice(0, 50).map((record) => {
                const op = record.operationId ? opById.get(record.operationId) : undefined;
                return (
                  <div key={record.id} className="list-row" style={{ cursor: 'default' }}>
                    <span style={{ flex: 1 }}>
                      <strong className="small">{record.targetType.replace(/-/g, ' ')}</strong>
                      <span className="muted small" style={{ display: 'block' }}>
                        {clients.find((c) => c.id === record.clientId)?.displayName ?? 'Client'} ·{' '}
                        {op ? `${op.providerId} (${op.mode})` : 'deterministic output'} · {fmtDateTime(record.at)}
                        {record.comment && ` · “${record.comment}”`}
                      </span>
                    </span>
                    <span className="cluster" style={{ gap: 4, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                      {record.labels.map((label) => (
                        <Badge key={label} tone={NEGATIVE_LABELS.includes(label) ? 'red' : 'neutral'}>
                          {FEEDBACK_LABELS.find((l) => l.value === label)?.label}
                        </Badge>
                      ))}
                    </span>
                  </div>
                );
              })}
            </div>
          </Card>
        )}
      </div>
    </main>
  );
}
