import { useEffect, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { Icon } from '../../app/components/Icon';
import { Badge, Card, EmptyState } from '../../app/components/ui';
import { fmtDate } from '../../lib/format';
import { useIntelligenceStore } from '../../state/intelligenceStore';
import type { ClientContext } from '../dashboard/ClientDashboardLayout';
import {
  BasisBadge,
  ConfidenceLevelBadge,
  EvidenceDrawer,
  FeedbackBar,
  GenerationStamp,
} from './shared';

export function SafetyTrustTab() {
  const { client } = useOutletContext<ClientContext>();
  const data = useIntelligenceStore((s) => s.byClient[client.id]);
  const loadClient = useIntelligenceStore((s) => s.loadClient);
  const generate = useIntelligenceStore((s) => s.generateStrategy);
  const decide = useIntelligenceStore((s) => s.decideStrategy);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    void loadClient(client.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client.id]);

  const strategies = data?.strategies ?? [];
  const current = strategies.find((s) => s.reviewStatus === 'approved' || s.reviewStatus === 'edited');
  const pending = strategies.find((s) => s.reviewStatus === 'pending');
  const shown = pending ?? current;

  const run = async () => {
    setBusy(true);
    setError(undefined);
    try {
      await generate(client.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not generate the strategy.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stack" style={{ maxWidth: 940 }}>
      <Card title="Safety and trust strategy" icon="shield">
        <div className="stack-sm">
          <p className="muted small" style={{ margin: 0 }}>
            Guidance for building safety and a working alliance with this client, assembled from approved
            evidence and labeled hypotheses. It supports — never replaces — your clinical judgment, and it is
            guidance for connection, not a script for influence.
          </p>
          {error && (
            <div className="notice notice--danger" role="alert">
              <Icon name="alert" size={15} />
              <span className="small">{error}</span>
            </div>
          )}
          <button className="btn btn--primary" style={{ alignSelf: 'flex-start' }} disabled={busy} onClick={() => void run()}>
            <Icon name="plus" size={15} /> {busy ? 'Assembling…' : shown ? 'Regenerate strategy proposal' : 'Generate strategy'}
          </button>
        </div>
      </Card>

      {shown && (
        <Card>
          <div className="stack-sm">
            <div className="cluster">
              <Badge
                tone={shown.reviewStatus === 'pending' ? 'amber' : 'green'}
                icon={shown.reviewStatus === 'pending' ? 'clock' : 'check'}
              >
                {shown.reviewStatus === 'pending' ? 'Proposed — awaiting your review' : 'Clinician approved'}
              </Badge>
              <span className="muted small">Updated {fmtDate(shown.updatedAt.slice(0, 10))}</span>
            </div>
            <GenerationStamp generation={shown.generation} />

            {shown.sections.map((section) => (
              <div key={section.key} className="soft" style={{ display: 'block', padding: 12 }}>
                <strong className="small" style={{ display: 'block', marginBottom: 6 }}>{section.label}</strong>
                <div className="stack-sm" style={{ gap: 8 }}>
                  {section.items.map((item, i) => (
                    <div key={i}>
                      <div className="cluster" style={{ gap: 6 }}>
                        <BasisBadge basis={item.basis === 'hypothesis' ? 'hypothesis' : item.sources.length > 0 ? 'fact' : 'insufficient-evidence'} />
                        {item.sources.length > 0 && <ConfidenceLevelBadge level={item.confidence} />}
                      </div>
                      <p className="small prewrap" style={{ margin: '4px 0' }}>{item.text}</p>
                      {item.sources.length > 0 && (
                        <EvidenceDrawer sources={item.sources} clientId={client.id} label="Evidence" />
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}

            {shown.reviewStatus === 'pending' && (
              <div className="cluster">
                <button className="btn btn--primary btn--sm" onClick={() => void decide(shown.id, client.id, 'approve')}>
                  <Icon name="check" size={13} /> Approve strategy
                </button>
                <button className="btn btn--danger btn--sm" onClick={() => void decide(shown.id, client.id, 'reject')}>
                  <Icon name="x" size={13} /> Reject
                </button>
              </div>
            )}
            <FeedbackBar clientId={client.id} targetType="strategy" targetId={shown.id} operationId={shown.generation.operationId} />
          </div>
        </Card>
      )}

      {!shown && (
        <Card>
          <EmptyState icon="shield" title="No strategy generated yet">
            <p className="small">
              Generate one above. Items appear only where approved evidence or labeled hypotheses exist.
            </p>
          </EmptyState>
        </Card>
      )}
    </div>
  );
}
