import { useEffect, useMemo, useState } from 'react';
import { Link, useOutletContext } from 'react-router-dom';
import { Icon } from '../../app/components/Icon';
import {
  ClassificationBadge,
  HypothesisConfidenceBadge,
  MethodBadge,
  ReviewStatusBadge,
  RiskFlagBadge,
  TemporalBadge,
} from '../../app/components/clinicalBadges';
import { Badge, Card, EmptyState } from '../../app/components/ui';
import { VersionCompareModal } from '../../app/components/VersionCompareModal';
import {
  APPROVED_STATUSES,
  CONTRADICTION_RESOLUTIONS,
  HYPOTHESIS_CATEGORIES,
  PROFILE_SECTIONS,
  factCategoryMeta,
  type ExtractedFact,
  type VersionRecord,
} from '../../core/db/structuredSchema';
import { fmtDate } from '../../lib/format';
import { useDataStore } from '../../state/dataStore';
import { useStructuredStore } from '../../state/structuredStore';
import type { ClientContext } from '../dashboard/ClientDashboardLayout';
import { FactFormModal } from '../facts/FactFormModal';
import { ContradictionFormModal, GapFormModal } from './flagsModals';

type ViewMode = 'approved' | 'pending' | 'history';

function FactRow({
  fact,
  clientId,
  onEdit,
  onCompare,
}: {
  fact: ExtractedFact;
  clientId: string;
  onEdit: (fact: ExtractedFact) => void;
  onCompare: (fact: ExtractedFact) => void;
}) {
  const [showEvidence, setShowEvidence] = useState(false);
  const evidence = useStructuredStore(
    (s) => s.byClient[clientId]?.evidence.filter((e) => e.targetType === 'fact' && e.targetId === fact.id) ?? [],
  );
  const versions = useStructuredStore(
    (s) => s.byClient[clientId]?.versions.filter((v) => v.entityType === 'fact' && v.entityId === fact.id) ?? [],
  );
  const decideFact = useStructuredStore((s) => s.decideFact);
  const markFactHistorical = useStructuredStore((s) => s.markFactHistorical);

  return (
    <div className="stack-sm" style={{ padding: '10px 0', borderTop: '1px solid var(--line)' }}>
      <p className="soft small prewrap" style={{ margin: 0 }}>{fact.statement}</p>
      <div className="cluster" style={{ gap: 6 }}>
        <ClassificationBadge value={fact.classification} />
        <ReviewStatusBadge status={fact.reviewStatus} />
        <TemporalBadge status={fact.temporalStatus} />
        <MethodBadge method={fact.extractionMethod} />
        {fact.riskRelated && <RiskFlagBadge label="Risk-related" />}
        <span className="muted small">{fmtDate(fact.dateOccurred ?? fact.dateRecorded)}</span>
      </div>
      <div className="cluster" style={{ gap: 8 }}>
        <Link
          className="small"
          to={`../inputs/${fact.sourceInputId}${fact.excerpt ? `?highlight=${encodeURIComponent(fact.excerpt.slice(0, 120))}` : ''}`}
        >
          <Icon name="file" size={12} /> Source
        </Link>
        {(evidence.length > 0 || fact.excerpt) && (
          <button className="btn btn--ghost btn--sm" onClick={() => setShowEvidence(!showEvidence)}>
            <Icon name={showEvidence ? 'chevron-left' : 'chevron-right'} size={12} />
            Evidence ({Math.max(evidence.length, fact.excerpt ? 1 : 0)})
          </button>
        )}
        <button className="btn btn--ghost btn--sm" onClick={() => onEdit(fact)}>
          <Icon name="edit" size={12} /> Edit
        </button>
        {versions.length > 0 && (
          <button className="btn btn--ghost btn--sm" onClick={() => onCompare(fact)}>
            <Icon name="clock" size={12} /> v{fact.version}
          </button>
        )}
        {APPROVED_STATUSES.includes(fact.reviewStatus) && fact.temporalStatus === 'current' && (
          <>
            <button className="btn btn--ghost btn--sm" onClick={() => void markFactHistorical(fact.id, clientId)}>
              Save as historical
            </button>
            <button className="btn btn--ghost btn--sm" onClick={() => void decideFact(fact.id, clientId, 'supersede')}>
              Mark superseded
            </button>
          </>
        )}
      </div>
      {showEvidence && (
        <div className="notice notice--info" style={{ display: 'block' }}>
          {fact.excerpt && (
            <p className="small prewrap" style={{ margin: 0 }}>
              <strong>Excerpt{fact.sourceLocation ? ` (${fact.sourceLocation})` : ''}:</strong> “{fact.excerpt}”
            </p>
          )}
          {evidence.map((e) => (
            <p key={e.id} className="small prewrap" style={{ margin: '6px 0 0' }}>
              <strong>{e.relationship} ({e.strength}):</strong> “{e.excerpt}”{' '}
              <Link to={`../inputs/${e.sourceInputId}?highlight=${encodeURIComponent(e.excerpt.slice(0, 120))}`}>
                open in context
              </Link>
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

export function StructuredProfileTab() {
  const { client } = useOutletContext<ClientContext>();
  const data = useStructuredStore((s) => s.byClient[client.id]);
  const loadClient = useStructuredStore((s) => s.loadClient);
  const resolveContradiction = useStructuredStore((s) => s.resolveContradiction);
  const updateGapStatus = useStructuredStore((s) => s.updateGapStatus);
  const inputs = useDataStore((s) => s.inputs[client.id]) ?? [];

  const [view, setView] = useState<ViewMode>('approved');
  const [showAddFact, setShowAddFact] = useState(false);
  const [editFact, setEditFact] = useState<ExtractedFact | undefined>();
  const [showAddContradiction, setShowAddContradiction] = useState(false);
  const [showAddGap, setShowAddGap] = useState(false);
  const [compare, setCompare] = useState<{ version: VersionRecord; current: unknown } | null>(null);

  useEffect(() => {
    void loadClient(client.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client.id]);

  const facts = data?.facts ?? [];
  const visibleFacts = useMemo(() => {
    if (view === 'approved') {
      return facts.filter((f) => APPROVED_STATUSES.includes(f.reviewStatus));
    }
    if (view === 'pending') {
      return facts.filter((f) => f.reviewStatus === 'pending' || f.reviewStatus === 'needs-clarification');
    }
    return facts;
  }, [facts, view]);

  const bySection = useMemo(() => {
    const map = new Map<string, ExtractedFact[]>();
    for (const fact of visibleFacts) {
      const section = factCategoryMeta(fact.category).section;
      map.set(section, [...(map.get(section) ?? []), fact]);
    }
    return map;
  }, [visibleFacts]);

  const hypotheses = (data?.hypotheses ?? []).filter((h) =>
    view === 'history' ? true : h.lifecycleStatus === 'active',
  );
  const contradictions = (data?.contradictions ?? []).filter((c) =>
    view === 'history' ? true : c.resolutionStatus === 'unresolved',
  );
  const gaps = (data?.gaps ?? []).filter((g) => (view === 'history' ? true : g.status === 'open' || g.status === 'in-progress'));

  const onCompareFact = (fact: ExtractedFact) => {
    const version = data?.versions.find((v) => v.entityType === 'fact' && v.entityId === fact.id);
    if (version) setCompare({ version, current: fact });
  };

  const viewButton = (mode: ViewMode, label: string) => (
    <button
      className="chip"
      aria-pressed={view === mode}
      style={view === mode ? { borderColor: 'var(--brand)', background: 'var(--brand-soft)', color: 'var(--brand-deep)' } : undefined}
      onClick={() => setView(mode)}
    >
      {label}
    </button>
  );

  return (
    <div className="stack">
      <div className="spread">
        <div>
          <h2>Structured clinical profile</h2>
          <p className="muted small">
            Only clinician-approved items form the working profile. Pending and rejected items are
            never presented as approved clinical information.
          </p>
        </div>
        <div className="cluster">
          <button className="btn btn--secondary btn--sm" onClick={() => setShowAddContradiction(true)}>
            <Icon name="alert" size={13} /> Log contradiction
          </button>
          <button className="btn btn--secondary btn--sm" onClick={() => setShowAddGap(true)}>
            <Icon name="info" size={13} /> Needs assessment
          </button>
          <button className="btn btn--primary btn--sm" onClick={() => setShowAddFact(true)}>
            <Icon name="plus" size={13} /> Add fact
          </button>
        </div>
      </div>

      <div className="chips" role="tablist" aria-label="Profile view">
        {viewButton('approved', 'Approved profile')}
        {viewButton('pending', `Pending review (${facts.filter((f) => f.reviewStatus === 'pending' || f.reviewStatus === 'needs-clarification').length})`)}
        {viewButton('history', 'Full history')}
      </div>

      {visibleFacts.length === 0 && hypotheses.length === 0 && contradictions.length === 0 && gaps.length === 0 ? (
        <Card>
          <EmptyState icon="clipboard" title={view === 'approved' ? 'No approved structured information yet' : view === 'pending' ? 'Nothing awaiting review' : 'No structured information yet'}>
            <p className="small">
              Run “Extract structured information” on a clinical input, or add facts manually.
            </p>
          </EmptyState>
        </Card>
      ) : (
        PROFILE_SECTIONS.filter((s) => bySection.has(s.value)).map((section) => (
          <Card key={section.value} title={`${section.label} (${bySection.get(section.value)!.length})`} icon="clipboard">
            <div>
              {bySection.get(section.value)!.map((fact) => (
                <FactRow
                  key={fact.id}
                  fact={fact}
                  clientId={client.id}
                  onEdit={(f) => setEditFact(f)}
                  onCompare={onCompareFact}
                />
              ))}
            </div>
          </Card>
        ))
      )}

      {hypotheses.length > 0 && (
        <Card title={`Clinical hypotheses (${hypotheses.length})`} icon="activity"
          action={<Link className="small" to="../hypotheses">Manage</Link>}>
          <div className="stack-sm">
            {hypotheses.map((h) => (
              <div key={h.id} className="cluster" style={{ justifyContent: 'space-between' }}>
                <span className="soft small" style={{ flex: 1, minWidth: 200 }}>
                  <strong>{HYPOTHESIS_CATEGORIES.find((c) => c.value === h.category)?.label}:</strong> {h.statement}
                </span>
                <HypothesisConfidenceBadge confidence={h.confidence} />
              </div>
            ))}
          </div>
        </Card>
      )}

      {contradictions.length > 0 && (
        <Card title={`Contradictions (${contradictions.length})`} icon="alert">
          <div className="stack">
            {contradictions.map((c) => (
              <div key={c.id} className="stack-sm" style={{ borderTop: '1px solid var(--line)', paddingTop: 10 }}>
                <div className="spread">
                  <strong className="small">{c.topic}</strong>
                  <Badge tone={c.resolutionStatus === 'unresolved' ? 'amber' : 'neutral'} icon="info">
                    {CONTRADICTION_RESOLUTIONS.find((r) => r.value === c.resolutionStatus)?.label}
                  </Badge>
                </div>
                <p className="soft small prewrap">{c.description}</p>
                <p className="muted small">
                  Evidence A: {c.firstEvidence.description}
                  {c.firstEvidence.sourceInputId && (
                    <> (<Link to={`../inputs/${c.firstEvidence.sourceInputId}`}>source</Link>)</>
                  )}
                  <br />
                  Evidence B: {c.secondEvidence.description}
                  {c.secondEvidence.sourceInputId && (
                    <> (<Link to={`../inputs/${c.secondEvidence.sourceInputId}`}>source</Link>)</>
                  )}
                </p>
                {c.clinicalSignificance && <p className="muted small">Significance: {c.clinicalSignificance}</p>}
                {c.resolutionStatus === 'unresolved' && (
                  <div className="cluster">
                    <select
                      className="select"
                      style={{ width: 'auto' }}
                      defaultValue=""
                      onChange={(e) => {
                        if (e.target.value) {
                          void resolveContradiction(c.id, client.id, e.target.value as never);
                        }
                      }}
                      aria-label="Resolve contradiction"
                    >
                      <option value="" disabled>Resolve as…</option>
                      {CONTRADICTION_RESOLUTIONS.filter((r) => r.value !== 'unresolved').map((r) => (
                        <option key={r.value} value={r.value}>{r.label}</option>
                      ))}
                    </select>
                  </div>
                )}
                {c.clinicianNote && <p className="muted small">Note: {c.clinicianNote}</p>}
              </div>
            ))}
          </div>
        </Card>
      )}

      {gaps.length > 0 && (
        <Card title={`Needs further assessment (${gaps.length})`} icon="info">
          <div className="stack">
            {gaps.map((g) => (
              <div key={g.id} className="stack-sm" style={{ borderTop: '1px solid var(--line)', paddingTop: 10 }}>
                <div className="spread">
                  <strong className="small">{g.topic}</strong>
                  <div className="cluster" style={{ gap: 6 }}>
                    <Badge tone={g.priority === 'high' ? 'red' : g.priority === 'medium' ? 'amber' : 'neutral'} icon="info">
                      {g.priority} priority
                    </Badge>
                    <Badge tone={g.status === 'open' ? 'amber' : 'neutral'}>{g.status}</Badge>
                  </div>
                </div>
                <p className="soft small">{g.reason}</p>
                {g.existingEvidence && <p className="muted small">Existing evidence: {g.existingEvidence}</p>}
                {g.suggestedQuestions.length > 0 && (
                  <ul className="muted small" style={{ margin: 0, paddingLeft: 18 }}>
                    {g.suggestedQuestions.map((q, i) => (
                      <li key={i}>{q}</li>
                    ))}
                  </ul>
                )}
                {(g.status === 'open' || g.status === 'in-progress') && (
                  <div className="cluster">
                    {g.status === 'open' && (
                      <button className="btn btn--ghost btn--sm" onClick={() => void updateGapStatus(g.id, client.id, 'in-progress')}>
                        Mark in progress
                      </button>
                    )}
                    <button className="btn btn--ghost btn--sm" onClick={() => void updateGapStatus(g.id, client.id, 'answered')}>
                      Mark answered
                    </button>
                    <button className="btn btn--ghost btn--sm" onClick={() => void updateGapStatus(g.id, client.id, 'no-longer-relevant')}>
                      No longer relevant
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </Card>
      )}

      {(showAddFact || editFact) && (
        <FactFormModal
          clientId={client.id}
          sourceInputs={inputs}
          existing={editFact}
          onClose={() => {
            setShowAddFact(false);
            setEditFact(undefined);
          }}
        />
      )}
      {showAddContradiction && (
        <ContradictionFormModal clientId={client.id} inputs={inputs} onClose={() => setShowAddContradiction(false)} />
      )}
      {showAddGap && <GapFormModal clientId={client.id} onClose={() => setShowAddGap(false)} />}
      {compare && (
        <VersionCompareModal version={compare.version} current={compare.current} onClose={() => setCompare(null)} />
      )}
    </div>
  );
}
