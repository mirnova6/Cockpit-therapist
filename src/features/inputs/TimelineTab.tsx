import { useMemo } from 'react';
import { useNavigate, useOutletContext } from 'react-router-dom';
import { Badge, Card, EmptyState } from '../../app/components/ui';
import { inputTypeLabel, type ClinicalInput } from '../../core/db/schema';
import { fmtDate } from '../../lib/format';
import { useDataStore } from '../../state/dataStore';
import type { ClientContext } from '../dashboard/ClientDashboardLayout';

function monthKey(isoDate: string): string {
  return isoDate.slice(0, 7);
}

function monthLabel(key: string): string {
  const d = new Date(`${key}-01T00:00:00`);
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'long' });
}

const TYPE_DOT: Record<string, string> = {
  'bps': 'var(--plum)',
  'session-transcript': 'var(--brand)',
  'rough-notes': 'var(--brand)',
  'dap-note': 'var(--brand)',
  'assessment': 'var(--green)',
  'risk-assessment': 'var(--red)',
  'medication-update': 'var(--plum)',
  'diagnosis-update': 'var(--plum)',
  'therapist-observation': 'var(--amber)',
  'client-quote': 'var(--amber)',
};

export function TimelineTab() {
  const { client } = useOutletContext<ClientContext>();
  const navigate = useNavigate();
  const inputs = useDataStore((s) => s.inputs[client.id]) ?? [];

  const groups = useMemo(() => {
    const byMonth = new Map<string, ClinicalInput[]>();
    for (const input of inputs) {
      const key = monthKey(input.dateOfInformation);
      byMonth.set(key, [...(byMonth.get(key) ?? []), input]);
    }
    return [...byMonth.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }, [inputs]);

  return (
    <Card title="Clinical timeline" icon="activity">
      {inputs.length === 0 ? (
        <EmptyState icon="activity" title="The timeline is empty">
          <p>As you add clinical information, it appears here in chronological order.</p>
        </EmptyState>
      ) : (
        <div className="stack" style={{ gap: 24 }}>
          {groups.map(([key, entries]) => (
            <section key={key}>
              <h3 style={{ marginBottom: 12, color: 'var(--ink-soft)' }}>{monthLabel(key)}</h3>
              <div className="timeline">
                {entries.map((input) => (
                  <div key={input.id} className="timeline__item">
                    <span
                      className="timeline__dot"
                      style={{ background: TYPE_DOT[input.inputType] ?? 'var(--ink-faint)' }}
                      aria-hidden="true"
                    />
                    <button
                      className="list-row"
                      style={{ padding: '2px 8px', display: 'block' }}
                      onClick={() => navigate(`../inputs/${input.id}`)}
                    >
                      <span className="cluster" style={{ gap: 8 }}>
                        <strong className="small">{inputTypeLabel(input.inputType)}</strong>
                        <span className="muted small">{fmtDate(input.dateOfInformation)}</span>
                        {input.containsRisk && (
                          <Badge tone={input.riskReview ? 'amber' : 'red'} icon="alert">Risk</Badge>
                        )}
                      </span>
                      {input.rawText && (
                        <span
                          className="muted small"
                          style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 620 }}
                        >
                          {input.rawText.slice(0, 140)}
                        </span>
                      )}
                    </button>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </Card>
  );
}
