import { useMemo, useState } from 'react';
import { Link, useNavigate, useOutletContext } from 'react-router-dom';
import { Icon } from '../../app/components/Icon';
import { Badge, Card, EmptyState } from '../../app/components/ui';
import { INPUT_TYPES, inputTypeLabel, type ClinicalInputType } from '../../core/db/schema';
import { fmtDate } from '../../lib/format';
import { useDataStore } from '../../state/dataStore';
import type { ClientContext } from '../dashboard/ClientDashboardLayout';

export function InputsListTab() {
  const { client } = useOutletContext<ClientContext>();
  const navigate = useNavigate();
  const inputs = useDataStore((s) => s.inputs[client.id]) ?? [];

  const [typeFilter, setTypeFilter] = useState<ClinicalInputType | 'all'>('all');
  const [search, setSearch] = useState('');
  const [riskOnly, setRiskOnly] = useState(false);

  const visible = useMemo(() => {
    return inputs.filter((input) => {
      if (typeFilter !== 'all' && input.inputType !== typeFilter) return false;
      if (riskOnly && !input.containsRisk) return false;
      if (search.trim()) {
        const needle = search.trim().toLowerCase();
        if (
          !input.rawText.toLowerCase().includes(needle) &&
          !input.authorSource.toLowerCase().includes(needle) &&
          !inputTypeLabel(input.inputType).toLowerCase().includes(needle)
        ) {
          return false;
        }
      }
      return true;
    });
  }, [inputs, typeFilter, search, riskOnly]);

  const usedTypes = useMemo(
    () => INPUT_TYPES.filter((t) => inputs.some((i) => i.inputType === t.value)),
    [inputs],
  );

  return (
    <Card
      title={`Clinical inputs (${inputs.length})`}
      icon="list"
      action={
        <Link to="../add" className="btn btn--primary btn--sm">
          <Icon name="plus" size={14} /> Add
        </Link>
      }
    >
      {inputs.length === 0 ? (
        <EmptyState icon="file" title="Nothing recorded yet">
          <p>Every BPS, transcript, note, and observation you add will be listed here.</p>
        </EmptyState>
      ) : (
        <div className="stack">
          <div className="cluster">
            <input
              className="input"
              style={{ flex: '1 1 200px' }}
              placeholder="Search text or source…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Search clinical inputs"
            />
            <select
              className="select"
              style={{ width: 'auto' }}
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value as ClinicalInputType | 'all')}
              aria-label="Filter by input type"
            >
              <option value="all">All types</option>
              {usedTypes.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
            <label className="chip" style={{ userSelect: 'none' }}>
              <input
                type="checkbox"
                checked={riskOnly}
                onChange={(e) => setRiskOnly(e.target.checked)}
                style={{ accentColor: 'var(--brand)' }}
              />
              Risk-flagged only
            </label>
          </div>

          {visible.length === 0 ? (
            <p className="muted">No entries match the current filters.</p>
          ) : (
            <div className="row-list">
              {visible.map((input) => (
                <button key={input.id} className="list-row" onClick={() => navigate(input.id)}>
                  <Icon name="file" size={17} className="soft" />
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span className="cluster" style={{ gap: 8 }}>
                      <strong className="small">{inputTypeLabel(input.inputType)}</strong>
                      <span className="muted small">{fmtDate(input.dateOfInformation)}</span>
                      {input.sessionNumber != null && (
                        <span className="muted small">Session {input.sessionNumber}</span>
                      )}
                    </span>
                    {input.rawText && (
                      <span
                        className="muted small"
                        style={{
                          display: 'block',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                          maxWidth: 640,
                        }}
                      >
                        {input.rawText.slice(0, 160)}
                      </span>
                    )}
                  </span>
                  {input.attachments.length > 0 && (
                    <Badge tone="neutral" icon="file">{input.attachments.length}</Badge>
                  )}
                  {input.containsRisk && (
                    <Badge tone={input.riskReview ? 'amber' : 'red'} icon="alert">
                      {input.riskReview ? 'Reviewed' : 'Review'}
                    </Badge>
                  )}
                  <Icon name="chevron-right" size={16} className="soft" />
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
