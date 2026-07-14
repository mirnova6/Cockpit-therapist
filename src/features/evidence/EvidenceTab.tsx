import { useEffect, useMemo, useState } from 'react';
import { Link, useOutletContext } from 'react-router-dom';
import { Icon } from '../../app/components/Icon';
import { ReviewStatusBadge } from '../../app/components/clinicalBadges';
import { Badge, Card, EmptyState } from '../../app/components/ui';
import {
  EVIDENCE_RELATIONSHIPS,
  type EvidenceLink,
  type EvidenceTargetType,
} from '../../core/db/structuredSchema';
import { fmtDate } from '../../lib/format';
import { useStructuredStore } from '../../state/structuredStore';
import type { ClientContext } from '../dashboard/ClientDashboardLayout';

const TARGET_LABELS: Record<EvidenceTargetType, string> = {
  fact: 'Fact',
  hypothesis: 'Hypothesis',
  assessment: 'Assessment',
  contradiction: 'Contradiction',
  gap: 'Needs assessment',
};

export function EvidenceTab() {
  const { client } = useOutletContext<ClientContext>();
  const data = useStructuredStore((s) => s.byClient[client.id]);
  const loadClient = useStructuredStore((s) => s.loadClient);
  const deleteEvidenceLink = useStructuredStore((s) => s.deleteEvidenceLink);
  const [typeFilter, setTypeFilter] = useState<EvidenceTargetType | 'all'>('all');
  const [relationshipFilter, setRelationshipFilter] = useState<string>('all');

  useEffect(() => {
    void loadClient(client.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client.id]);

  const evidence = data?.evidence ?? [];
  const facts = data?.facts ?? [];
  const hypotheses = data?.hypotheses ?? [];
  const assessments = data?.assessments ?? [];

  const targetSummary = (link: EvidenceLink): string => {
    switch (link.targetType) {
      case 'fact':
        return facts.find((f) => f.id === link.targetId)?.statement ?? 'Fact';
      case 'hypothesis':
        return hypotheses.find((h) => h.id === link.targetId)?.statement ?? 'Hypothesis';
      case 'assessment': {
        const a = assessments.find((x) => x.id === link.targetId);
        return a ? `${a.name} (${fmtDate(a.dateAdministered)})` : 'Assessment';
      }
      default:
        return TARGET_LABELS[link.targetType];
    }
  };

  const visible = useMemo(
    () =>
      evidence.filter(
        (e) =>
          (typeFilter === 'all' || e.targetType === typeFilter) &&
          (relationshipFilter === 'all' || e.relationship === relationshipFilter),
      ),
    [evidence, typeFilter, relationshipFilter],
  );

  return (
    <div className="stack">
      <div>
        <h2>Evidence</h2>
        <p className="muted small">
          Every link connects a conclusion to its exact source excerpt. Links can never reference
          another client's records.
        </p>
      </div>

      {evidence.length === 0 ? (
        <Card>
          <EmptyState icon="clipboard" title="No evidence links yet">
            <p className="small">Approving extracted facts and attaching evidence to hypotheses creates links here.</p>
          </EmptyState>
        </Card>
      ) : (
        <Card>
          <div className="stack">
            <div className="cluster">
              <select className="select" style={{ width: 'auto' }} value={typeFilter} onChange={(e) => setTypeFilter(e.target.value as EvidenceTargetType | 'all')} aria-label="Filter by target type">
                <option value="all">All targets</option>
                {Object.entries(TARGET_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
              <select className="select" style={{ width: 'auto' }} value={relationshipFilter} onChange={(e) => setRelationshipFilter(e.target.value)} aria-label="Filter by relationship">
                <option value="all">All relationships</option>
                {EVIDENCE_RELATIONSHIPS.map((r) => (
                  <option key={r.value} value={r.value}>{r.label}</option>
                ))}
              </select>
              <span className="muted small">{visible.length} of {evidence.length} links</span>
            </div>

            <div className="row-list">
              {visible.map((link) => (
                <div key={link.id} className="stack-sm" style={{ padding: '12px 4px' }}>
                  <div className="cluster" style={{ gap: 6 }}>
                    <Badge tone="blue" icon="clipboard">{TARGET_LABELS[link.targetType]}</Badge>
                    <Badge tone={link.relationship === 'contradicts' ? 'red' : link.relationship === 'supports' ? 'green' : 'neutral'}>
                      {EVIDENCE_RELATIONSHIPS.find((r) => r.value === link.relationship)?.label}
                    </Badge>
                    <Badge tone="neutral">{link.strength}</Badge>
                    <ReviewStatusBadge status={link.reviewStatus} />
                    <span className="muted small">{fmtDate(link.dateOfSource)}</span>
                  </div>
                  <p className="soft small" style={{ margin: 0 }}>
                    <strong>Conclusion:</strong> {targetSummary(link).slice(0, 160)}
                  </p>
                  <p className="small prewrap" style={{ margin: 0, color: 'var(--ink-soft)' }}>
                    “{link.excerpt}”{link.sourceLocation ? ` — ${link.sourceLocation}` : ''}
                  </p>
                  <div className="cluster">
                    <Link
                      className="small"
                      to={`../inputs/${link.sourceInputId}?highlight=${encodeURIComponent(link.excerpt.slice(0, 120))}`}
                    >
                      <Icon name="eye" size={12} /> Open evidence in context
                    </Link>
                    <button className="btn btn--ghost btn--sm" onClick={() => void deleteEvidenceLink(link.id, client.id)}>
                      <Icon name="trash" size={12} /> Remove link
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}
