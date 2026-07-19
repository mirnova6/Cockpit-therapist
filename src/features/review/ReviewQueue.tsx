import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon } from '../../app/components/Icon';
import { MethodBadge, RiskFlagBadge } from '../../app/components/clinicalBadges';
import { Badge, Card, EmptyState, Field, Modal } from '../../app/components/ui';
import type { QueueItem } from '../../core/db/structuredRepository';
import type { ExtractionMethod } from '../../core/db/structuredSchema';
import { initials, relTime } from '../../lib/format';
import { useDataStore } from '../../state/dataStore';
import { useStructuredStore } from '../../state/structuredStore';

const KIND_LABELS: Record<QueueItem['kind'], string> = {
  'fact': 'Extracted fact',
  'assessment': 'Assessment',
  'hypothesis': 'Hypothesis',
  'evidence': 'Evidence link',
  'contradiction': 'Contradiction',
  'gap': 'Missing information',
};

interface EditState {
  item: QueueItem;
  statement: string;
  note: string;
}

export function ReviewQueueList({
  items,
  showClient,
  onChanged,
}: {
  items: QueueItem[];
  showClient: boolean;
  onChanged: () => void;
}) {
  const navigate = useNavigate();
  const clients = useDataStore((s) => s.clients);
  const { decideFact, decideAssessment, decideHypothesis, editFact, bulkApproveFacts } = useStructuredStore();
  const structuredByClient = useStructuredStore((s) => s.byClient);

  const [kindFilter, setKindFilter] = useState<QueueItem['kind'] | 'all'>('all');
  const [riskFilter, setRiskFilter] = useState<'all' | 'risk' | 'non-risk'>('all');
  const [methodFilter, setMethodFilter] = useState<'all' | ExtractionMethod>('all');
  const [clientFilter, setClientFilter] = useState<string>('all');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editState, setEditState] = useState<EditState | null>(null);
  const [bulkResult, setBulkResult] = useState<string>();
  const [riskNotes, setRiskNotes] = useState<Record<string, string>>({});

  const visible = useMemo(
    () =>
      items.filter(
        (item) =>
          (kindFilter === 'all' || item.kind === kindFilter) &&
          (riskFilter === 'all' || (riskFilter === 'risk') === item.riskRelated) &&
          (methodFilter === 'all' || item.extractionMethod === methodFilter) &&
          (clientFilter === 'all' || item.clientId === clientFilter),
      ),
    [items, kindFilter, riskFilter, methodFilter, clientFilter],
  );

  const clientName = (id: string) => clients.find((c) => c.id === id)?.displayName ?? 'Client';

  const openItem = (item: QueueItem) => {
    const base = `/clients/${item.clientId}`;
    switch (item.kind) {
      case 'fact':
        navigate(`${base}/profile`);
        break;
      case 'assessment':
        navigate(`${base}/assessments`);
        break;
      case 'hypothesis':
        navigate(`${base}/hypotheses`);
        break;
      case 'evidence':
        navigate(`${base}/evidence`);
        break;
      default:
        navigate(`${base}/profile`);
    }
  };

  const openSource = (item: QueueItem) => {
    const data = structuredByClient[item.clientId];
    if (item.kind === 'fact') {
      const fact = data?.facts.find((f) => f.id === item.id);
      if (fact) {
        navigate(
          `/clients/${item.clientId}/inputs/${fact.sourceInputId}${fact.excerpt ? `?highlight=${encodeURIComponent(fact.excerpt.slice(0, 120))}` : ''}`,
        );
        return;
      }
    }
    if (item.kind === 'assessment') {
      const record = data?.assessments.find((a) => a.id === item.id);
      if (record?.sourceInputId) {
        navigate(`/clients/${item.clientId}/inputs/${record.sourceInputId}`);
        return;
      }
    }
    openItem(item);
  };

  const decide = async (item: QueueItem, decision: 'approve' | 'reject' | 'needs-clarification') => {
    if (item.kind === 'fact') {
      if (item.riskRelated && decision === 'approve' && !(riskNotes[item.id] ?? '').trim()) {
        setRiskNotes({ ...riskNotes, [item.id]: '' });
        return;
      }
      await decideFact(item.id, item.clientId, decision === 'needs-clarification' ? 'needs-clarification' : decision, {
        note: riskNotes[item.id]?.trim() || undefined,
      });
    } else if (item.kind === 'assessment' && decision !== 'needs-clarification') {
      await decideAssessment(item.id, item.clientId, decision, riskNotes[item.id]?.trim() || undefined);
    } else if (item.kind === 'hypothesis' && decision !== 'needs-clarification') {
      // AI-drafted hypotheses land here as pending; approval keeps them
      // hypotheses — there is no path from a hypothesis to a fact.
      await decideHypothesis(item.id, item.clientId, decision);
    }
    onChanged();
  };

  const saveEdit = async () => {
    if (!editState) return;
    await editFact(
      editState.item.id,
      editState.item.clientId,
      { statement: editState.statement.trim(), clinicianCorrection: editState.note.trim() || undefined },
      editState.note.trim() || 'Edited during review',
    );
    await decideFact(editState.item.id, editState.item.clientId, 'approve', { asEdited: true });
    setEditState(null);
    onChanged();
  };

  const bulkApprove = async () => {
    // The service layer re-checks eligibility for every id: medication,
    // diagnosis, risk-related, withdrawal, and clarification items are
    // skipped there even if the UI ever sent them.
    const factIds = visible
      .filter((i) => selected.has(`${i.kind}:${i.id}`) && i.kind === 'fact' && i.bulkEligible)
      .map((i) => i.id);
    if (factIds.length === 0) return;
    const byClientIds = new Map<string, string[]>();
    for (const id of factIds) {
      const item = visible.find((i) => i.id === id)!;
      byClientIds.set(item.clientId, [...(byClientIds.get(item.clientId) ?? []), id]);
    }
    let approved = 0;
    let skipped = 0;
    for (const [clientId, ids] of byClientIds) {
      const result = await bulkApproveFacts(ids, clientId);
      approved += result.approved.length;
      skipped += result.skipped.length;
    }
    setBulkResult(
      `${approved} eligible low-risk fact${approved === 1 ? '' : 's'} approved.` +
        (skipped > 0 ? ` ${skipped} skipped by the service layer as requiring individual review.` : '') +
        ' Medication, diagnosis, and risk items always require individual review.',
    );
    setSelected(new Set());
    onChanged();
  };

  const selectableKeys = visible
    .filter((i) => i.kind === 'fact' && i.bulkEligible)
    .map((i) => `${i.kind}:${i.id}`);

  if (items.length === 0) {
    return (
      <Card>
        <EmptyState icon="check" title="Review queue is clear">
          <p className="small">Extracted facts, pending assessments, contradictions, and open questions appear here.</p>
        </EmptyState>
      </Card>
    );
  }

  return (
    <div className="stack">
      <div className="cluster">
        {showClient && (
          <select className="select" style={{ width: 'auto' }} value={clientFilter} onChange={(e) => setClientFilter(e.target.value)} aria-label="Filter by client">
            <option value="all">All clients</option>
            {clients.filter((c) => items.some((i) => i.clientId === c.id)).map((c) => (
              <option key={c.id} value={c.id}>{c.displayName}</option>
            ))}
          </select>
        )}
        <select className="select" style={{ width: 'auto' }} value={kindFilter} onChange={(e) => setKindFilter(e.target.value as QueueItem['kind'] | 'all')} aria-label="Filter by type">
          <option value="all">All types</option>
          {Object.entries(KIND_LABELS).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
        <select className="select" style={{ width: 'auto' }} value={riskFilter} onChange={(e) => setRiskFilter(e.target.value as typeof riskFilter)} aria-label="Filter by risk">
          <option value="all">Risk: all</option>
          <option value="risk">Risk items only</option>
          <option value="non-risk">Non-risk only</option>
        </select>
        <select className="select" style={{ width: 'auto' }} value={methodFilter} onChange={(e) => setMethodFilter(e.target.value as typeof methodFilter)} aria-label="Filter by method">
          <option value="all">Method: all</option>
          <option value="rule-based">Rule-based</option>
          <option value="manual">Manual</option>
          <option value="ai-provider">AI provider</option>
        </select>
        {selectableKeys.length > 0 && (
          <>
            <button
              className="btn btn--ghost btn--sm"
              onClick={() =>
                setSelected(selected.size === selectableKeys.length ? new Set() : new Set(selectableKeys))
              }
            >
              {selected.size === selectableKeys.length ? 'Clear selection' : `Select all eligible low-risk facts (${selectableKeys.length})`}
            </button>
            <button className="btn btn--secondary btn--sm" disabled={selected.size === 0} onClick={() => void bulkApprove()}>
              <Icon name="check" size={13} /> Approve eligible low-risk items ({selected.size})
            </button>
          </>
        )}
      </div>

      {bulkResult && (
        <div className="notice notice--info" role="status">
          <Icon name="check" size={16} />
          <span className="small">{bulkResult}</span>
        </div>
      )}

      {visible.map((item) => {
        const key = `${item.kind}:${item.id}`;
        const canDecideHere = item.kind === 'fact' || item.kind === 'assessment' || item.kind === 'hypothesis';
        const needsRiskNote = item.riskRelated && riskNotes[item.id] !== undefined;
        return (
          <Card key={key}>
            <div className="stack-sm">
              <div className="cluster">
                {item.kind === 'fact' && item.bulkEligible && (
                  <input
                    type="checkbox"
                    checked={selected.has(key)}
                    onChange={(e) => {
                      const next = new Set(selected);
                      if (e.target.checked) next.add(key);
                      else next.delete(key);
                      setSelected(next);
                    }}
                    aria-label="Select for bulk approval"
                    style={{ accentColor: 'var(--brand)', width: 16, height: 16 }}
                  />
                )}
                {showClient && (
                  <Badge tone="neutral">
                    <span className="avatar" style={{ width: 18, height: 18, fontSize: '0.6rem', borderRadius: 6 }}>
                      {initials(clientName(item.clientId))}
                    </span>
                    {clientName(item.clientId)}
                  </Badge>
                )}
                <Badge tone="blue" icon="clipboard">{KIND_LABELS[item.kind]}</Badge>
                {item.riskRelated && <RiskFlagBadge />}
                {!item.bulkEligible && (item.kind === 'fact' || item.kind === 'assessment') && (
                  <Badge tone="amber" icon="alert">Individual review required</Badge>
                )}
                {item.extractionMethod && <MethodBadge method={item.extractionMethod as ExtractionMethod} />}
                <span className="muted small">{relTime(item.date)}</span>
              </div>
              {item.individualReviewReason && (
                <p className="muted small" style={{ margin: 0 }}>{item.individualReviewReason}.</p>
              )}
              <p className="soft small prewrap" style={{ margin: 0 }}>{item.title}</p>
              <p className="muted small" style={{ margin: 0 }}>{item.detail}</p>

              {needsRiskNote && (
                <Field label="Clinician note (required to approve a risk item)">
                  <input
                    className="input"
                    value={riskNotes[item.id] ?? ''}
                    onChange={(e) => setRiskNotes({ ...riskNotes, [item.id]: e.target.value })}
                  />
                </Field>
              )}

              <div className="cluster">
                {canDecideHere && (
                  <>
                    <button className="btn btn--primary btn--sm" onClick={() => void decide(item, 'approve')}>
                      <Icon name="check" size={13} /> Approve
                    </button>
                    {item.kind === 'fact' && (
                      <button
                        className="btn btn--secondary btn--sm"
                        onClick={() => setEditState({ item, statement: item.title, note: '' })}
                      >
                        <Icon name="edit" size={13} /> Edit &amp; approve
                      </button>
                    )}
                    <button className="btn btn--danger btn--sm" onClick={() => void decide(item, 'reject')}>
                      <Icon name="x" size={13} /> Reject
                    </button>
                    {item.kind === 'fact' && (
                      <button className="btn btn--ghost btn--sm" onClick={() => void decide(item, 'needs-clarification')}>
                        Needs clarification
                      </button>
                    )}
                  </>
                )}
                <button className="btn btn--ghost btn--sm" onClick={() => openSource(item)}>
                  <Icon name="eye" size={13} /> Open source
                </button>
                <button className="btn btn--ghost btn--sm" onClick={() => openItem(item)}>
                  <Icon name="chevron-right" size={13} /> Open section
                </button>
              </div>
            </div>
          </Card>
        );
      })}

      {editState && (
        <Modal narrow title="Edit and approve" subtitle="The original is preserved in version history." onClose={() => setEditState(null)}>
          <div className="stack">
            <Field label="Statement">
              <textarea className="textarea" style={{ minHeight: 80 }} value={editState.statement} onChange={(e) => setEditState({ ...editState, statement: e.target.value })} />
            </Field>
            <Field label="What did you correct? (optional)">
              <input className="input" value={editState.note} onChange={(e) => setEditState({ ...editState, note: e.target.value })} />
            </Field>
            <div className="modal__footer">
              <button className="btn btn--ghost" onClick={() => setEditState(null)}>Cancel</button>
              <button className="btn btn--primary" disabled={!editState.statement.trim()} onClick={() => void saveEdit()}>
                <Icon name="check" size={14} /> Save &amp; approve
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
