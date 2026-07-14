import { useEffect, useState } from 'react';
import { Link, useOutletContext } from 'react-router-dom';
import { Icon } from '../../app/components/Icon';
import { HypothesisConfidenceBadge, ReviewStatusBadge } from '../../app/components/clinicalBadges';
import { Badge, Card, EmptyState, Field, Modal } from '../../app/components/ui';
import { VersionCompareModal } from '../../app/components/VersionCompareModal';
import { inputTypeLabel } from '../../core/db/schema';
import {
  EVIDENCE_RELATIONSHIPS,
  HYPOTHESIS_CATEGORIES,
  HYPOTHESIS_CONFIDENCES,
  type ClinicalHypothesis,
  type EvidenceRelationship,
  type EvidenceStrength,
  type HypothesisCategory,
  type HypothesisConfidence,
  type VersionRecord,
} from '../../core/db/structuredSchema';
import { todayIsoDate } from '../../lib/format';
import { useDataStore } from '../../state/dataStore';
import { useStructuredStore } from '../../state/structuredStore';
import type { ClientContext } from '../dashboard/ClientDashboardLayout';

function splitLines(value: string): string[] {
  return value.split('\n').map((l) => l.trim()).filter(Boolean);
}

function HypothesisFormModal({
  clientId,
  existing,
  onClose,
}: {
  clientId: string;
  existing?: ClinicalHypothesis;
  onClose: () => void;
}) {
  const createHypothesis = useStructuredStore((s) => s.createHypothesis);
  const updateHypothesis = useStructuredStore((s) => s.updateHypothesis);
  const [category, setCategory] = useState<HypothesisCategory>(existing?.category ?? 'relational-pattern');
  const [statement, setStatement] = useState(existing?.statement ?? '');
  const [confidence, setConfidence] = useState<HypothesisConfidence>(existing?.confidence ?? 'insufficient-evidence');
  const [alternatives, setAlternatives] = useState(existing?.alternativeExplanations.join('\n') ?? '');
  const [missing, setMissing] = useState(existing?.missingInformation.join('\n') ?? '');
  const [questions, setQuestions] = useState(existing?.questionsToAssess.join('\n') ?? '');
  const [comments, setComments] = useState(existing?.clinicianComments ?? '');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setError(undefined);
    if (!statement.trim()) return setError('Enter the hypothesis statement.');
    if (existing && !reason.trim()) return setError('Describe the reason for the change (kept in version history).');
    setBusy(true);
    try {
      const fields = {
        category,
        statement: statement.trim(),
        confidence,
        alternativeExplanations: splitLines(alternatives),
        missingInformation: splitLines(missing),
        questionsToAssess: splitLines(questions),
        clinicianComments: comments.trim() || undefined,
      };
      if (existing) {
        await updateHypothesis(existing.id, clientId, fields, reason.trim());
      } else {
        await createHypothesis({ clientId, ...fields });
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save.');
      setBusy(false);
    }
  };

  return (
    <Modal
      title={existing ? 'Edit hypothesis' : 'New clinical hypothesis'}
      subtitle="A hypothesis is an interpretation under consideration — never presented as confirmed fact."
      onClose={onClose}
    >
      <div className="stack">
        <div className="form-grid">
          <Field label="Category">
            <select className="select" value={category} onChange={(e) => setCategory(e.target.value as HypothesisCategory)}>
              {HYPOTHESIS_CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </select>
          </Field>
          <Field label="Confidence (clinical judgment, not a probability)">
            <select className="select" value={confidence} onChange={(e) => setConfidence(e.target.value as HypothesisConfidence)}>
              {HYPOTHESIS_CONFIDENCES.map((c) => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </select>
          </Field>
        </div>
        <Field label="Hypothesis statement">
          <textarea className="textarea" style={{ minHeight: 70 }} value={statement} onChange={(e) => setStatement(e.target.value)}
            placeholder="e.g. Client may experience heightened attachment-related sensitivity to perceived abandonment." />
        </Field>
        <Field label="Alternative explanations (one per line)">
          <textarea className="textarea" style={{ minHeight: 60 }} value={alternatives} onChange={(e) => setAlternatives(e.target.value)} />
        </Field>
        <Field label="Missing information (one per line)">
          <textarea className="textarea" style={{ minHeight: 60 }} value={missing} onChange={(e) => setMissing(e.target.value)} />
        </Field>
        <Field label="Questions to assess next (one per line)">
          <textarea className="textarea" style={{ minHeight: 60 }} value={questions} onChange={(e) => setQuestions(e.target.value)} />
        </Field>
        <Field label="Clinician comments (optional)">
          <input className="input" value={comments} onChange={(e) => setComments(e.target.value)} />
        </Field>
        {existing && (
          <Field label="Reason for change (required)">
            <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
        )}
        {error && (
          <div className="notice notice--danger" role="alert">
            <Icon name="alert" size={15} />
            <span>{error}</span>
          </div>
        )}
        <div className="modal__footer">
          <button className="btn btn--ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn--primary" disabled={busy} onClick={() => void save()}>
            {existing ? 'Save new version' : 'Create hypothesis'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function AttachEvidenceModal({
  clientId,
  hypothesis,
  onClose,
}: {
  clientId: string;
  hypothesis: ClinicalHypothesis;
  onClose: () => void;
}) {
  const inputs = useDataStore((s) => s.inputs[clientId]) ?? [];
  const createEvidenceLink = useStructuredStore((s) => s.createEvidenceLink);
  const [sourceInputId, setSourceInputId] = useState(inputs[0]?.id ?? '');
  const [excerpt, setExcerpt] = useState('');
  const [relationship, setRelationship] = useState<EvidenceRelationship>('supports');
  const [strength, setStrength] = useState<EvidenceStrength>('moderate');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setError(undefined);
    if (!sourceInputId) return setError('Choose a source input.');
    if (!excerpt.trim()) return setError('Paste the exact excerpt that serves as evidence.');
    setBusy(true);
    try {
      const input = inputs.find((i) => i.id === sourceInputId);
      await createEvidenceLink({
        clientId,
        targetType: 'hypothesis',
        targetId: hypothesis.id,
        sourceInputId,
        excerpt: excerpt.trim(),
        dateOfSource: input?.dateOfInformation ?? todayIsoDate(),
        relationship,
        strength,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not attach evidence.');
      setBusy(false);
    }
  };

  return (
    <Modal narrow title="Attach evidence" subtitle={hypothesis.statement.slice(0, 120)} onClose={onClose}>
      <div className="stack">
        <Field label="Source clinical input">
          <select className="select" value={sourceInputId} onChange={(e) => setSourceInputId(e.target.value)}>
            {inputs.map((i) => (
              <option key={i.id} value={i.id}>{inputTypeLabel(i.inputType)} · {i.dateOfInformation}</option>
            ))}
          </select>
        </Field>
        <Field label="Exact excerpt">
          <textarea className="textarea" style={{ minHeight: 70 }} value={excerpt} onChange={(e) => setExcerpt(e.target.value)} />
        </Field>
        <div className="form-grid">
          <Field label="Relationship">
            <select className="select" value={relationship} onChange={(e) => setRelationship(e.target.value as EvidenceRelationship)}>
              {EVIDENCE_RELATIONSHIPS.map((r) => (
                <option key={r.value} value={r.value}>{r.label}</option>
              ))}
            </select>
          </Field>
          <Field label="Strength">
            <select className="select" value={strength} onChange={(e) => setStrength(e.target.value as EvidenceStrength)}>
              <option value="strong">Strong</option>
              <option value="moderate">Moderate</option>
              <option value="weak">Weak</option>
            </select>
          </Field>
        </div>
        {error && (
          <div className="notice notice--danger" role="alert">
            <Icon name="alert" size={15} />
            <span>{error}</span>
          </div>
        )}
        <div className="modal__footer">
          <button className="btn btn--ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn--primary" disabled={busy} onClick={() => void save()}>Attach</button>
        </div>
      </div>
    </Modal>
  );
}

export function HypothesesTab() {
  const { client } = useOutletContext<ClientContext>();
  const data = useStructuredStore((s) => s.byClient[client.id]);
  const loadClient = useStructuredStore((s) => s.loadClient);
  const setHypothesisLifecycle = useStructuredStore((s) => s.setHypothesisLifecycle);
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState<ClinicalHypothesis | undefined>();
  const [attaching, setAttaching] = useState<ClinicalHypothesis | undefined>();
  const [compare, setCompare] = useState<{ version: VersionRecord; current: unknown } | null>(null);
  const [showInactive, setShowInactive] = useState(false);

  useEffect(() => {
    void loadClient(client.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client.id]);

  const hypotheses = (data?.hypotheses ?? []).filter((h) => showInactive || h.lifecycleStatus === 'active');
  const evidence = data?.evidence ?? [];
  const versions = data?.versions ?? [];

  return (
    <div className="stack">
      <div className="spread">
        <div>
          <h2>Clinical hypotheses</h2>
          <p className="muted small">
            Interpretations under consideration, with supporting and contradicting evidence.
            Confidence is a clinical judgment label, not a probability.
          </p>
        </div>
        <div className="cluster">
          <label className="chip">
            <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} style={{ accentColor: 'var(--brand)' }} />
            Show rejected / superseded
          </label>
          <button className="btn btn--primary btn--sm" onClick={() => setShowAdd(true)}>
            <Icon name="plus" size={13} /> New hypothesis
          </button>
        </div>
      </div>

      {hypotheses.length === 0 ? (
        <Card>
          <EmptyState icon="activity" title="No hypotheses yet">
            <p className="small">
              Record interpretations you are considering, attach evidence for and against, and
              track what to assess next. AI-drafted hypotheses arrive in a later phase — they will
              appear here as pending drafts for your review.
            </p>
          </EmptyState>
        </Card>
      ) : (
        hypotheses.map((h) => {
          const supporting = evidence.filter((e) => e.targetType === 'hypothesis' && e.targetId === h.id && e.relationship === 'supports');
          const contradicting = evidence.filter((e) => e.targetType === 'hypothesis' && e.targetId === h.id && e.relationship === 'contradicts');
          const other = evidence.filter((e) => e.targetType === 'hypothesis' && e.targetId === h.id && e.relationship !== 'supports' && e.relationship !== 'contradicts');
          const hVersions = versions.filter((v) => v.entityType === 'hypothesis' && v.entityId === h.id);
          return (
            <Card key={h.id}>
              <div className="stack-sm">
                <div className="cluster">
                  <Badge tone="plum" icon="activity">
                    {HYPOTHESIS_CATEGORIES.find((c) => c.value === h.category)?.label}
                  </Badge>
                  <HypothesisConfidenceBadge confidence={h.confidence} />
                  <ReviewStatusBadge status={h.reviewStatus} />
                  {h.lifecycleStatus !== 'active' && (
                    <Badge tone="neutral" icon="archive">{h.lifecycleStatus}</Badge>
                  )}
                </div>
                <p className="soft prewrap" style={{ margin: 0 }}>{h.statement}</p>

                {(supporting.length > 0 || contradicting.length > 0 || other.length > 0) && (
                  <div className="notice notice--info" style={{ display: 'block' }}>
                    {supporting.length > 0 && (
                      <div className="small">
                        <strong>Supporting ({supporting.length}):</strong>
                        {supporting.map((e) => (
                          <p key={e.id} style={{ margin: '2px 0' }}>
                            “{e.excerpt}” ({e.strength}) —{' '}
                            <Link to={`../inputs/${e.sourceInputId}?highlight=${encodeURIComponent(e.excerpt.slice(0, 120))}`}>open in context</Link>
                          </p>
                        ))}
                      </div>
                    )}
                    {contradicting.length > 0 && (
                      <div className="small" style={{ marginTop: 6 }}>
                        <strong>Contradicting ({contradicting.length}):</strong>
                        {contradicting.map((e) => (
                          <p key={e.id} style={{ margin: '2px 0' }}>
                            “{e.excerpt}” ({e.strength}) —{' '}
                            <Link to={`../inputs/${e.sourceInputId}?highlight=${encodeURIComponent(e.excerpt.slice(0, 120))}`}>open in context</Link>
                          </p>
                        ))}
                      </div>
                    )}
                    {other.length > 0 && (
                      <div className="small" style={{ marginTop: 6 }}>
                        <strong>Context ({other.length}):</strong>
                        {other.map((e) => (
                          <p key={e.id} style={{ margin: '2px 0' }}>
                            [{EVIDENCE_RELATIONSHIPS.find((r) => r.value === e.relationship)?.label}] “{e.excerpt}”
                          </p>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {h.alternativeExplanations.length > 0 && (
                  <p className="muted small" style={{ margin: 0 }}>
                    <strong>Alternative explanations:</strong> {h.alternativeExplanations.join('; ')}
                  </p>
                )}
                {h.missingInformation.length > 0 && (
                  <p className="muted small" style={{ margin: 0 }}>
                    <strong>Missing information:</strong> {h.missingInformation.join('; ')}
                  </p>
                )}
                {h.questionsToAssess.length > 0 && (
                  <p className="muted small" style={{ margin: 0 }}>
                    <strong>Assess next:</strong> {h.questionsToAssess.join('; ')}
                  </p>
                )}
                {h.clinicianComments && (
                  <p className="muted small" style={{ margin: 0 }}><strong>Comments:</strong> {h.clinicianComments}</p>
                )}

                {h.lifecycleStatus === 'active' && (
                  <div className="cluster">
                    <button className="btn btn--secondary btn--sm" onClick={() => setAttaching(h)}>
                      <Icon name="plus" size={12} /> Attach evidence
                    </button>
                    <button className="btn btn--ghost btn--sm" onClick={() => setEditing(h)}>
                      <Icon name="edit" size={12} /> Edit
                    </button>
                    {hVersions.length > 0 && (
                      <button className="btn btn--ghost btn--sm" onClick={() => setCompare({ version: hVersions[0], current: h })}>
                        <Icon name="clock" size={12} /> v{h.version}
                      </button>
                    )}
                    <button className="btn btn--ghost btn--sm" onClick={() => void setHypothesisLifecycle(h.id, client.id, 'superseded')}>
                      Supersede
                    </button>
                    <button className="btn btn--danger btn--sm" onClick={() => void setHypothesisLifecycle(h.id, client.id, 'rejected')}>
                      Reject
                    </button>
                  </div>
                )}
              </div>
            </Card>
          );
        })
      )}

      {(showAdd || editing) && (
        <HypothesisFormModal clientId={client.id} existing={editing} onClose={() => { setShowAdd(false); setEditing(undefined); }} />
      )}
      {attaching && (
        <AttachEvidenceModal clientId={client.id} hypothesis={attaching} onClose={() => setAttaching(undefined)} />
      )}
      {compare && (
        <VersionCompareModal version={compare.version} current={compare.current} onClose={() => setCompare(null)} />
      )}
    </div>
  );
}
