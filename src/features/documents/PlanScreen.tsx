import { useEffect, useState } from 'react';
import { Link, useNavigate, useOutletContext, useParams } from 'react-router-dom';
import { Icon } from '../../app/components/Icon';
import { Badge, Card, EmptyState, Field, Modal } from '../../app/components/ui';
import { VersionCompareModal } from '../../app/components/VersionCompareModal';
import { authService } from '../../core/auth/authService';
import {
  APPROVED_DOC_STATUSES,
  DOC_STATUS_LABELS,
  FORMULATION_SECTIONS,
  objectiveMissingItems,
  type DocSegment,
  type PlanNeed,
  type PlanProblem,
} from '../../core/db/documentSchema';
import type { VersionRecord } from '../../core/db/structuredSchema';
import { fmtDate, fmtDateTime } from '../../lib/format';
import { useDocumentsStore } from '../../state/documentsStore';
import type { ClientContext } from '../dashboard/ClientDashboardLayout';
import { ExportModal } from './ExportModal';
import { GenerationBanner, statusTone } from './docShared';
import { SegmentList } from './SegmentList';

function RiskItemControls({
  item,
  onAcknowledge,
}: {
  item: { id: string; riskRelated: boolean; riskAcknowledged?: boolean; riskNote?: string };
  onAcknowledge: (id: string, note?: string) => void;
}) {
  const [note, setNote] = useState('');
  if (!item.riskRelated) return null;
  if (item.riskAcknowledged) {
    return (
      <p className="muted small" style={{ margin: 0 }}>
        <Badge tone="amber" icon="alert">Risk — confirmed</Badge>
        {item.riskNote && <> Disposition: {item.riskNote}</>}
      </p>
    );
  }
  return (
    <div className="stack-sm" style={{ gap: 6 }}>
      <Badge tone="red" icon="alert">Risk — confirmation required</Badge>
      <div className="cluster">
        <input
          className="input"
          style={{ flex: '1 1 220px' }}
          placeholder="Disposition / follow-up note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
        <button className="btn btn--danger btn--sm" onClick={() => onAcknowledge(item.id, note.trim() || undefined)}>
          <Icon name="check" size={13} /> Confirm
        </button>
      </div>
    </div>
  );
}

export function PlanScreen() {
  const { client } = useOutletContext<ClientContext>();
  const { planId } = useParams<{ planId: string }>();
  const navigate = useNavigate();
  const docs = useDocumentsStore((s) => s.byClient[client.id]);
  const { loadClient, updatePlan, decidePlan, acknowledgePlanRisk, deletePlan } = useDocumentsStore();

  const plan = docs?.plans.find((p) => p.id === planId);
  const goals = docs?.goals ?? [];

  const [comment, setComment] = useState('');
  const [error, setError] = useState<string>();
  const [showExport, setShowExport] = useState(false);
  const [compare, setCompare] = useState<VersionRecord | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [versions, setVersions] = useState<VersionRecord[]>([]);
  const [editingProblem, setEditingProblem] = useState<PlanProblem | null>(null);
  const [problemText, setProblemText] = useState('');
  const [rationaleDraft, setRationaleDraft] = useState<string | null>(null);
  const [improvementDraft, setImprovementDraft] = useState<string | null>(null);

  useEffect(() => {
    void loadClient(client.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client.id]);

  useEffect(() => {
    if (!planId) return;
    const db = authService.current();
    if (db) void db.structured.listVersions(client.id, 'treatment-plan', planId).then(setVersions);
  }, [client.id, planId, plan?.version]);

  if (!plan) {
    return (
      <Card>
        <EmptyState icon="clipboard" title="Treatment plan not found">
          <button className="btn btn--secondary" onClick={() => navigate('..')}>Back to plans</button>
        </EmptyState>
      </Card>
    );
  }

  const isApproved = APPROVED_DOC_STATUSES.includes(plan.reviewStatus);
  const editable = !isApproved && !['rejected', 'superseded', 'archived'].includes(plan.reviewStatus);
  const pendingRisk =
    plan.segments.filter((s) => s.riskRelated && !s.riskAcknowledged).length +
    plan.problems.filter((p) => p.riskRelated && !p.riskAcknowledged).length +
    plan.hierarchy.filter((h) => h.riskRelated && !h.riskAcknowledged).length;

  const linkedGoals = plan.goalsSnapshot ?? goals.filter((g) => plan.goalIds.includes(g.id));

  const decide = async (decision: 'approve' | 'reject' | 'archive' | 'submit-for-review' | 'needs-more-info') => {
    setError(undefined);
    try {
      await decidePlan(plan.id, client.id, decision, comment.trim() || undefined);
      setComment('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed.');
    }
  };

  const saveSegments = (next: DocSegment[]) =>
    void updatePlan(plan.id, client.id, { segments: next }, 'Formulation/evidence edits');

  const acknowledge = (itemId: string, note?: string) =>
    void acknowledgePlanRisk(plan.id, client.id, itemId, note);

  return (
    <div className="stack" style={{ maxWidth: 900 }}>
      <div className="spread">
        <button className="btn btn--ghost btn--sm" onClick={() => navigate('..')}>
          <Icon name="chevron-left" size={14} /> All plans
        </button>
        <div className="cluster">
          <Badge tone={statusTone(plan.reviewStatus)}>{DOC_STATUS_LABELS[plan.reviewStatus]}</Badge>
          <Badge tone="neutral">v{plan.version}</Badge>
          {versions.length > 0 && (
            <button className="btn btn--secondary btn--sm" onClick={() => setCompare(versions[0])}>
              <Icon name="clock" size={13} /> Compare previous
            </button>
          )}
          <button className="btn btn--secondary btn--sm" onClick={() => setShowExport(true)}>
            <Icon name="download" size={13} /> Export
          </button>
          <button className="btn btn--danger btn--sm" onClick={() => setConfirmDelete(true)}>
            <Icon name="trash" size={13} /> Delete
          </button>
        </div>
      </div>

      <div>
        <h2>Master Treatment Plan — {fmtDate(plan.planDate)}</h2>
        <p className="muted small">
          {plan.diagnosesSnapshot.length > 0 && <>Diagnoses/impressions: {plan.diagnosesSnapshot.join('; ')} · </>}
          {plan.approvedAt && <>Approved {fmtDateTime(plan.approvedAt)} by {plan.reviewedBy}</>}
        </p>
      </div>

      <GenerationBanner generation={plan.generation} />

      {pendingRisk > 0 && (
        <div className="notice notice--danger" role="alert">
          <Icon name="alert" size={18} />
          <span className="small">
            <strong>{pendingRisk} risk-related item(s) require individual confirmation</strong> before this
            plan can be approved.
          </span>
        </div>
      )}

      <Card title={`Problem statements (${plan.problems.length})`} icon="clipboard">
        <div className="stack">
          {plan.problems.map((problem, index) => (
            <div key={problem.id} className="stack-sm" style={{ borderTop: index > 0 ? '1px solid var(--line)' : undefined, paddingTop: index > 0 ? 10 : 0 }}>
              <p className="soft small prewrap" style={{ margin: 0 }}>{index + 1}. {problem.text}</p>
              <div className="cluster" style={{ gap: 6 }}>
                {problem.fromPendingSource && <Badge tone="amber" icon="clock">From pending source</Badge>}
                {problem.sources.map((s, i) => (
                  <Badge key={i} tone="blue">{s.label ?? s.refType}</Badge>
                ))}
                {editable && (
                  <>
                    <button className="btn btn--ghost btn--sm" onClick={() => { setEditingProblem(problem); setProblemText(problem.text); }}>
                      <Icon name="edit" size={12} /> Edit
                    </button>
                    <button
                      className="btn btn--ghost btn--sm"
                      onClick={() =>
                        void updatePlan(plan.id, client.id, { problems: plan.problems.filter((p) => p.id !== problem.id) }, 'Problem removed')
                      }
                    >
                      <Icon name="trash" size={12} /> Remove
                    </button>
                  </>
                )}
              </div>
              <RiskItemControls item={problem} onAcknowledge={acknowledge} />
            </div>
          ))}
          {plan.problems.length === 0 && <p className="muted small">No problem statements were drafted — see generation warnings.</p>}
        </div>
      </Card>

      <Card title="Evidenced by" icon="eye">
        <SegmentList
          clientId={client.id}
          section="evidenced-by"
          segments={plan.segments}
          editable={editable}
          onChange={saveSegments}
          onAcknowledgeRisk={acknowledge}
        />
      </Card>

      <Card title="Holistic clinical formulation" icon="activity">
        <p className="muted small" style={{ marginBottom: 12 }}>
          Deterministic synthesis of approved information only. Advanced formulation reasoning
          arrives in Phase 4 and will appear here as reviewable drafts.
        </p>
        <div className="stack">
          {FORMULATION_SECTIONS.map(({ key, label }) => (
            <div key={key}>
              <h3 style={{ fontSize: '0.9rem', marginBottom: 6, color: 'var(--ink-soft)' }}>{label}</h3>
              <SegmentList
                clientId={client.id}
                section={key}
                segments={plan.segments}
                editable={editable}
                onChange={saveSegments}
                onAcknowledgeRisk={acknowledge}
              />
            </div>
          ))}
        </div>
      </Card>

      <Card title="Hierarchy of clinical needs" icon="list">
        <div className="stack">
          {plan.hierarchy.length === 0 && <p className="muted small">No documented needs available to rank.</p>}
          {plan.hierarchy.map((need: PlanNeed) => (
            <div key={need.id} className="stack-sm" style={{ gap: 4 }}>
              <p className="soft small" style={{ margin: 0 }}>
                <strong>{need.rank}. {need.need}</strong> — {need.rationale}
              </p>
              <div className="cluster" style={{ gap: 6 }}>
                {need.sources.map((s, i) => (
                  <Badge key={i} tone="blue">{s.label ?? s.refType}</Badge>
                ))}
              </div>
              <RiskItemControls item={need} onAcknowledge={acknowledge} />
            </div>
          ))}
        </div>
      </Card>

      <Card title="Goal plan" icon="check" action={<Link className="small" to="../goals">Open Goals &amp; Objectives editor</Link>}>
        <div className="stack">
          <Field label="Clinical rationale">
            <textarea
              className="textarea"
              style={{ minHeight: 60 }}
              value={rationaleDraft ?? plan.goalPlanRationale}
              disabled={!editable}
              onChange={(e) => setRationaleDraft(e.target.value)}
              onBlur={() => {
                if (rationaleDraft !== null && rationaleDraft !== plan.goalPlanRationale) {
                  void updatePlan(plan.id, client.id, { goalPlanRationale: rationaleDraft }, 'Goal rationale edited');
                }
                setRationaleDraft(null);
              }}
            />
          </Field>
          <Field label="Expected areas of improvement">
            <textarea
              className="textarea"
              style={{ minHeight: 60 }}
              value={improvementDraft ?? plan.expectedImprovement}
              disabled={!editable}
              onChange={(e) => setImprovementDraft(e.target.value)}
              onBlur={() => {
                if (improvementDraft !== null && improvementDraft !== plan.expectedImprovement) {
                  void updatePlan(plan.id, client.id, { expectedImprovement: improvementDraft }, 'Expected improvement edited');
                }
                setImprovementDraft(null);
              }}
            />
          </Field>

          {linkedGoals.length === 0 ? (
            <div className="notice notice--warn">
              <Icon name="alert" size={16} />
              <span className="small">
                Clinician input required: no goals are linked to this plan.{' '}
                <Link to="../goals">Create goals</Link>, then regenerate or edit the plan.
              </span>
            </div>
          ) : (
            linkedGoals.map((goal) => (
              <div key={goal.id} className="stack-sm" style={{ borderTop: '1px solid var(--line)', paddingTop: 10 }}>
                <div className="cluster">
                  <Badge tone={goal.kind === 'short-term' ? 'blue' : 'plum'}>{goal.kind}</Badge>
                  <strong className="small">{goal.title}</strong>
                  {plan.goalsSnapshot && <Badge tone="neutral">frozen at approval</Badge>}
                </div>
                {goal.objectives.map((objective) => {
                  const missing = objectiveMissingItems(objective);
                  return (
                    <div key={objective.id} className="small" style={{ paddingLeft: 12 }}>
                      <span className="soft">• {objective.description}</span>
                      {missing.length > 0 && (
                        <span className="muted" style={{ display: 'block', color: 'var(--amber)' }}>
                          Needs completion: {missing.join('; ')}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            ))
          )}
        </div>
      </Card>

      {plan.proposedObjectives.length > 0 && (
        <Card title="Proposed objective skeletons" icon="plus">
          <p className="muted small" style={{ marginBottom: 10 }}>
            Drafted from the selected evidence. The generator never invents baselines, targets, or
            dates — add a skeleton to the Goals editor and complete the flagged fields there.
          </p>
          <div className="stack">
            {plan.proposedObjectives.map((objective) => (
              <div key={objective.id} className="stack-sm" style={{ borderTop: '1px solid var(--line)', paddingTop: 10 }}>
                <p className="soft small" style={{ margin: 0 }}>{objective.description}</p>
                <div className="cluster" style={{ gap: 6 }}>
                  {objective.targetProblem && <Badge tone="blue">{objective.targetProblem}</Badge>}
                  {objective.sources.map((s, i) => (
                    <Badge key={i} tone="neutral">{s.label ?? s.refType}</Badge>
                  ))}
                </div>
                <p className="muted small" style={{ margin: 0, color: 'var(--amber)' }}>
                  Clinician input required: {objective.missing.join('; ')}
                </p>
              </div>
            ))}
            <p className="muted small">
              Use the <Link to="../goals">Goals &amp; Objectives editor</Link> to turn skeletons into
              complete, measurable objectives.
            </p>
          </div>
        </Card>
      )}

      {plan.clinicianComments && (
        <Card title="Clinician comments" icon="edit">
          <p className="soft small prewrap">{plan.clinicianComments}</p>
        </Card>
      )}

      {editable && (
        <Card title="Clinician review" icon="check">
          <div className="stack">
            <Field label="Comment (optional)">
              <input className="input" value={comment} onChange={(e) => setComment(e.target.value)} />
            </Field>
            {error && (
              <div className="notice notice--danger" role="alert">
                <Icon name="alert" size={16} />
                <span className="small">{error}</span>
              </div>
            )}
            <div className="cluster">
              <button className="btn btn--primary" onClick={() => void decide('approve')}>
                <Icon name="check" size={15} /> Approve plan
              </button>
              <button className="btn btn--secondary btn--sm" onClick={() => void decide('submit-for-review')}>
                Save as pending review
              </button>
              <button className="btn btn--secondary btn--sm" onClick={() => void decide('needs-more-info')}>
                Needs more information
              </button>
              <button className="btn btn--danger btn--sm" onClick={() => void decide('reject')}>
                <Icon name="x" size={13} /> Reject
              </button>
              <button className="btn btn--ghost btn--sm" onClick={() => void decide('archive')}>
                <Icon name="archive" size={13} /> Archive
              </button>
            </div>
            <p className="muted small">
              Approving freezes a snapshot of the linked goals and supersedes any previously
              approved plan (kept in history).
            </p>
          </div>
        </Card>
      )}

      {isApproved && (
        <div className="notice notice--info">
          <Icon name="check" size={16} />
          <span className="small">
            Approved plan. Editing reopens review.{' '}
            <button className="btn btn--ghost btn--sm" onClick={() => void updatePlan(plan.id, client.id, {}, 'Reopened for editing')}>
              Reopen for editing
            </button>
          </span>
        </div>
      )}

      {showExport && (
        <ExportModal
          doc={plan}
          goals={goals}
          clientName={client.displayName}
          clientIdentifier={client.preferredIdentifier}
          onClose={() => setShowExport(false)}
        />
      )}
      {compare && <VersionCompareModal version={compare} current={plan} onClose={() => setCompare(null)} />}
      {editingProblem && (
        <Modal narrow title="Edit problem statement" onClose={() => setEditingProblem(null)}>
          <div className="stack">
            <textarea className="textarea" style={{ minHeight: 80 }} value={problemText} onChange={(e) => setProblemText(e.target.value)} />
            <div className="modal__footer">
              <button className="btn btn--ghost" onClick={() => setEditingProblem(null)}>Cancel</button>
              <button
                className="btn btn--primary"
                disabled={!problemText.trim()}
                onClick={() => {
                  void updatePlan(
                    plan.id,
                    client.id,
                    { problems: plan.problems.map((p) => (p.id === editingProblem.id ? { ...p, text: problemText.trim() } : p)) },
                    'Problem statement edited',
                  );
                  setEditingProblem(null);
                }}
              >
                Save
              </button>
            </div>
          </div>
        </Modal>
      )}
      {confirmDelete && (
        <Modal narrow title="Delete this plan?" subtitle="The plan will be removed permanently." onClose={() => setConfirmDelete(false)}>
          <div className="modal__footer">
            <button className="btn btn--ghost" onClick={() => setConfirmDelete(false)}>Cancel</button>
            <button className="btn btn--danger" onClick={() => { void deletePlan(plan.id, client.id).then(() => navigate('..')); }}>
              <Icon name="trash" size={14} /> Delete permanently
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
