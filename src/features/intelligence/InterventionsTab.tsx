import { useEffect, useState } from 'react';
import { Link, useOutletContext } from 'react-router-dom';
import { Icon } from '../../app/components/Icon';
import { Badge, Card, EmptyState } from '../../app/components/ui';
import { TIER_LABELS, type InterventionRecommendation } from '../../core/db/intelligenceSchema';
import { fmtDate } from '../../lib/format';
import { useIntelligenceStore } from '../../state/intelligenceStore';
import type { ClientContext } from '../dashboard/ClientDashboardLayout';
import {
  ConfidenceLevelBadge,
  EvidenceDrawer,
  FeedbackBar,
  GenerationStamp,
  SectionCard,
} from './shared';

function RecommendationCard({
  recommendation,
  clientId,
  operationId,
}: {
  recommendation: InterventionRecommendation;
  clientId: string;
  operationId?: string;
}) {
  const [open, setOpen] = useState(false);
  const tierTone = recommendation.tier === 'established' ? 'green' : recommendation.tier === 'tentative' ? 'blue' : 'amber';
  return (
    <Card>
      <div className="stack-sm">
        <div className="spread">
          <div className="cluster">
            <strong>{recommendation.name}</strong>
            <Badge tone={tierTone} icon={recommendation.tier === 'established' ? 'check' : 'info'}>
              {TIER_LABELS[recommendation.tier]}
            </Badge>
            <ConfidenceLevelBadge level={recommendation.confidence} />
          </div>
          <button className="btn btn--ghost btn--sm" onClick={() => setOpen((v) => !v)}>
            <Icon name={open ? 'chevron-left' : 'chevron-right'} size={13} /> {open ? 'Collapse' : 'Details'}
          </button>
        </div>

        <p className="small" style={{ margin: 0 }}>
          <strong>Clinical target:</strong> {recommendation.clinicalTarget}
        </p>
        <p className="small muted" style={{ margin: 0 }}>{recommendation.whyItMayFit}</p>

        {recommendation.stabilizationConcern && (
          <div className="notice notice--warn" role="alert">
            <Icon name="alert" size={16} />
            <span className="small">
              <strong>Stabilization concern:</strong> {recommendation.stabilizationConcern}
            </span>
          </div>
        )}

        <EvidenceDrawer
          sources={recommendation.clientEvidence}
          clientId={clientId}
          label="Client evidence"
          emptyText="No client evidence — this should not appear as a recommendation."
        />

        <div>
          <strong className="small">Approved knowledge support:</strong>
          {recommendation.knowledgeSupport.length === 0 ? (
            <p className="muted small" style={{ margin: '2px 0' }}>
              None retrieved from your approved knowledge library — that is why this option is not marked
              “established”. Add and approve relevant sources under <Link to="/knowledge">Knowledge library</Link>.
            </p>
          ) : (
            <ul className="small" style={{ margin: '4px 0' }}>
              {recommendation.knowledgeSupport.map((k, i) => (
                <li key={i}>
                  <strong>{k.title}</strong> — {k.citation}
                  {k.section ? ` · ${k.section}` : ''}{k.page ? ` · p. ${k.page}` : ''}
                  <br />
                  <span className="muted prewrap">“{k.passage.slice(0, 240)}{k.passage.length > 240 ? '…' : ''}”</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {open && (
          <div className="stack-sm">
            <SectionCard title="Readiness indicators">
              <ul className="small" style={{ margin: 0 }}>{recommendation.readinessIndicators.map((r, i) => <li key={i}>{r}</li>)}</ul>
            </SectionCard>
            <SectionCard title="Cautions">
              <ul className="small" style={{ margin: 0 }}>{recommendation.cautions.map((c, i) => <li key={i}>{c}</li>)}</ul>
            </SectionCard>
            <SectionCard title="What to avoid">
              <ul className="small" style={{ margin: 0 }}>{recommendation.whatToAvoid.map((c, i) => <li key={i}>{c}</li>)}</ul>
            </SectionCard>
            <SectionCard title="Suggested pacing">
              <p className="small" style={{ margin: 0 }}>{recommendation.suggestedPacing}</p>
            </SectionCard>
            <SectionCard title="Signs of benefit">
              <ul className="small" style={{ margin: 0 }}>{recommendation.signsOfBenefit.map((c, i) => <li key={i}>{c}</li>)}</ul>
            </SectionCard>
            <SectionCard title="Signs of overwhelm">
              <ul className="small" style={{ margin: 0 }}>{recommendation.signsOfOverwhelm.map((c, i) => <li key={i}>{c}</li>)}</ul>
            </SectionCard>
            <SectionCard title="How to measure response">
              <ul className="small" style={{ margin: 0 }}>{recommendation.howToMeasure.map((c, i) => <li key={i}>{c}</li>)}</ul>
            </SectionCard>
            <SectionCard title="Alternatives">
              <p className="small" style={{ margin: 0 }}>{recommendation.alternatives.join(' · ')}</p>
            </SectionCard>
          </div>
        )}

        <FeedbackBar clientId={clientId} targetType="intervention" targetId={recommendation.id} operationId={operationId} />
      </div>
    </Card>
  );
}

export function InterventionsTab() {
  const { client } = useOutletContext<ClientContext>();
  const data = useIntelligenceStore((s) => s.byClient[client.id]);
  const loadClient = useIntelligenceStore((s) => s.loadClient);
  const generate = useIntelligenceStore((s) => s.generateInterventions);
  const markReviewed = useIntelligenceStore((s) => s.markInterventionsReviewed);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    void loadClient(client.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client.id]);

  const latest = (data?.interventionSets ?? [])[0];

  const run = async () => {
    setBusy(true);
    setError(undefined);
    try {
      await generate(client.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not generate recommendations.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stack" style={{ maxWidth: 940 }}>
      <Card title="Best interventions — options for your review" icon="heart">
        <div className="stack-sm">
          <p className="muted small" style={{ margin: 0 }}>
            Options are matched from documented, approved client evidence and your approved knowledge library.
            They are suggestions for clinical judgment — never directives — and nothing here changes the
            treatment plan without your action.
          </p>
          {error && (
            <div className="notice notice--danger" role="alert">
              <Icon name="alert" size={15} />
              <span className="small">{error}</span>
            </div>
          )}
          <div className="cluster">
            <button className="btn btn--primary" disabled={busy} onClick={() => void run()}>
              <Icon name="plus" size={15} /> {busy ? 'Matching…' : latest ? 'Regenerate recommendations' : 'Generate recommendations'}
            </button>
            {latest && latest.reviewStatus === 'pending' && (
              <button className="btn btn--secondary" onClick={() => void markReviewed(latest.id, client.id)}>
                <Icon name="check" size={15} /> Mark set reviewed
              </button>
            )}
            {latest && latest.reviewStatus !== 'pending' && (
              <Badge tone="green" icon="check">Reviewed {latest.reviewedBy ? `by ${latest.reviewedBy}` : ''}</Badge>
            )}
          </div>
        </div>
      </Card>

      {latest && (
        <>
          <GenerationStamp generation={latest.generation} />
          <p className="muted small">
            Generated {fmtDate(latest.createdAt.slice(0, 10))} · {latest.recommendations.length} option(s)
          </p>
          {latest.recommendations.map((rec) => (
            <RecommendationCard key={rec.id} recommendation={rec} clientId={client.id} operationId={latest.generation.operationId} />
          ))}
          {latest.notRecommended.length > 0 && (
            <Card title="Considered but not recommended" icon="info">
              <ul className="small" style={{ margin: 0 }}>
                {latest.notRecommended.map((n, i) => (
                  <li key={i}>
                    <strong>{n.name}</strong> — <span className="muted">{n.reason}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </>
      )}

      {!latest && (
        <Card>
          <EmptyState icon="heart" title="No recommendations generated yet">
            <p className="small">
              Generate options above. Recommendations only appear where approved client evidence supports them.
            </p>
          </EmptyState>
        </Card>
      )}
    </div>
  );
}
