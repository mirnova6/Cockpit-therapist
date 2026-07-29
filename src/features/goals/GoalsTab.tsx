import { useEffect, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { Icon } from '../../app/components/Icon';
import { Badge, Card, EmptyState, Field, Modal } from '../../app/components/ui';
import { ASSESSMENT_DEFINITIONS } from '../../core/assessments/definitions';
import {
  MEASUREMENT_METHODS,
  isVagueObjectiveWording,
  objectiveMissingItems,
  type GoalKind,
  type GoalStatus,
  type Objective,
  type TreatmentGoal,
} from '../../core/db/documentSchema';
import { newId } from '../../core/db/schema';
import { fmtDateTime } from '../../lib/format';
import { useDocumentsStore } from '../../state/documentsStore';
import type { ClientContext } from '../dashboard/ClientDashboardLayout';

const GOAL_STATUSES: Array<{ value: GoalStatus; label: string }> = [
  { value: 'active', label: 'Active' },
  { value: 'achieved', label: 'Achieved' },
  { value: 'continued', label: 'Continued' },
  { value: 'revised', label: 'Revised' },
  { value: 'discontinued', label: 'Discontinued' },
];

function emptyObjective(): Objective {
  return {
    id: newId(),
    description: '',
    progress: 'not-started',
    progressNotes: [],
    therapistPlan: {},
  };
}

function ObjectiveEditor({
  objective,
  onChange,
  onRemove,
}: {
  objective: Objective;
  onChange: (next: Objective) => void;
  onRemove: () => void;
}) {
  const missing = objectiveMissingItems(objective);
  const vague = objective.description.trim() && isVagueObjectiveWording(objective.description);
  return (
    <div className="stack-sm" style={{ border: '1px solid var(--line)', borderRadius: 10, padding: 12 }}>
      <Field label="Objective (measurable behavior or outcome)" hint="e.g. Client will identify three relapse triggers and three alternative coping responses within two weeks.">
        <textarea className="textarea" style={{ minHeight: 56 }} value={objective.description} onChange={(e) => onChange({ ...objective, description: e.target.value })} />
      </Field>
      {vague && (
        <div className="notice notice--warn">
          <Icon name="alert" size={15} />
          <span className="small">This wording may not be measurable. Consider a countable behavior, score, or frequency.</span>
        </div>
      )}
      <div className="form-grid">
        <Field label="Target problem">
          <input className="input" value={objective.targetProblem ?? ''} onChange={(e) => onChange({ ...objective, targetProblem: e.target.value })} />
        </Field>
        <Field label="Measurement method">
          <select
            className="select"
            value={objective.measurementMethod ?? ''}
            onChange={(e) => onChange({ ...objective, measurementMethod: e.target.value || undefined })}
          >
            <option value="">Not established</option>
            {MEASUREMENT_METHODS.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
        </Field>
        <Field label="Linked assessment (optional)">
          <select
            className="select"
            value={objective.linkedAssessmentKey ?? ''}
            onChange={(e) => onChange({ ...objective, linkedAssessmentKey: e.target.value || undefined })}
          >
            <option value="">None</option>
            {ASSESSMENT_DEFINITIONS.map((d) => (
              <option key={d.key} value={d.key}>{d.label}</option>
            ))}
          </select>
        </Field>
        <Field label="Baseline (as documented)">
          <input className="input" value={objective.baseline ?? ''} onChange={(e) => onChange({ ...objective, baseline: e.target.value })} placeholder="e.g. 5 panic episodes/week" />
        </Field>
        <Field label="Target">
          <input className="input" value={objective.target ?? ''} onChange={(e) => onChange({ ...objective, target: e.target.value })} placeholder="e.g. ≤2 episodes/week" />
        </Field>
        <Field label="Target date">
          <input className="input" type="date" value={objective.targetDate ?? ''} onChange={(e) => onChange({ ...objective, targetDate: e.target.value || undefined })} />
        </Field>
        <Field label="Time frame (alternative to date)">
          <input className="input" value={objective.timeFrame ?? ''} onChange={(e) => onChange({ ...objective, timeFrame: e.target.value })} placeholder="e.g. 6 weeks" />
        </Field>
      </div>
      <strong className="small" style={{ color: 'var(--ink-soft)' }}>Therapist plan</strong>
      <div className="form-grid">
        <Field label="Therapist action">
          <input className="input" value={objective.therapistPlan.action ?? ''} onChange={(e) => onChange({ ...objective, therapistPlan: { ...objective.therapistPlan, action: e.target.value } })} placeholder="e.g. Teach and rehearse grounding skills" />
        </Field>
        <Field label="Modality / skill">
          <input className="input" value={objective.therapistPlan.modality ?? ''} onChange={(e) => onChange({ ...objective, therapistPlan: { ...objective.therapistPlan, modality: e.target.value } })} placeholder="e.g. CBT, DBT distress tolerance" />
        </Field>
        <Field label="Frequency">
          <input className="input" value={objective.therapistPlan.frequency ?? ''} onChange={(e) => onChange({ ...objective, therapistPlan: { ...objective.therapistPlan, frequency: e.target.value } })} placeholder="e.g. weekly sessions" />
        </Field>
        <Field label="Progress tracking">
          <input className="input" value={objective.therapistPlan.tracking ?? ''} onChange={(e) => onChange({ ...objective, therapistPlan: { ...objective.therapistPlan, tracking: e.target.value } })} placeholder="e.g. weekly diary card review" />
        </Field>
      </div>
      {missing.length > 0 && (
        <p className="muted small" style={{ margin: 0, color: 'var(--amber)' }}>
          <Icon name="info" size={13} /> Needs completion: {missing.join('; ')}
        </p>
      )}
      <button className="btn btn--ghost btn--sm" style={{ alignSelf: 'flex-start' }} onClick={onRemove}>
        <Icon name="trash" size={12} /> Remove objective
      </button>
    </div>
  );
}

function GoalFormModal({
  clientId,
  existing,
  onClose,
}: {
  clientId: string;
  existing?: TreatmentGoal;
  onClose: () => void;
}) {
  const createGoal = useDocumentsStore((s) => s.createGoal);
  const updateGoal = useDocumentsStore((s) => s.updateGoal);
  const [title, setTitle] = useState(existing?.title ?? '');
  const [kind, setKind] = useState<GoalKind>(existing?.kind ?? 'short-term');
  const [rationale, setRationale] = useState(existing?.rationale ?? '');
  const [objectives, setObjectives] = useState<Objective[]>(existing?.objectives ?? [emptyObjective()]);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setError(undefined);
    if (!title.trim()) return setError('Enter the goal title.');
    const cleaned = objectives.filter((o) => o.description.trim());
    if (existing && !reason.trim()) return setError('Describe the reason for the change (kept in version history).');
    setBusy(true);
    try {
      if (existing) {
        await updateGoal(existing.id, clientId, { title: title.trim(), kind, rationale: rationale.trim() || undefined, objectives: cleaned }, reason.trim());
      } else {
        await createGoal({ clientId, kind, title: title.trim(), rationale: rationale.trim() || undefined, status: 'active', objectives: cleaned });
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save goal.');
      setBusy(false);
    }
  };

  return (
    <Modal
      title={existing ? 'Edit goal' : 'New treatment goal'}
      subtitle="Objectives should be specific and measurable. Missing components are flagged, never invented."
      onClose={onClose}
    >
      <div className="stack">
        <div className="form-grid">
          <Field label="Goal title">
            <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Reduce panic episode frequency" />
          </Field>
          <Field label="Goal type">
            <select className="select" value={kind} onChange={(e) => setKind(e.target.value as GoalKind)}>
              <option value="short-term">Short-term goal</option>
              <option value="long-term">Long-term goal</option>
            </select>
          </Field>
        </div>
        <Field label="Clinical rationale (optional)">
          <textarea className="textarea" style={{ minHeight: 50 }} value={rationale} onChange={(e) => setRationale(e.target.value)} />
        </Field>

        <strong className="small" style={{ color: 'var(--ink-soft)' }}>Objectives ({objectives.length})</strong>
        {objectives.map((objective, index) => (
          <ObjectiveEditor
            key={objective.id}
            objective={objective}
            onChange={(next) => setObjectives(objectives.map((o, i) => (i === index ? next : o)))}
            onRemove={() => setObjectives(objectives.filter((_, i) => i !== index))}
          />
        ))}
        <button className="btn btn--secondary btn--sm" style={{ alignSelf: 'flex-start' }} onClick={() => setObjectives([...objectives, emptyObjective()])}>
          <Icon name="plus" size={13} /> Add objective
        </button>

        {existing && (
          <Field label="Reason for change (required)">
            <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
        )}
        {error && (
          <div className="notice notice--danger" role="alert">
            <Icon name="alert" size={16} />
            <span>{error}</span>
          </div>
        )}
        <div className="modal__footer">
          <button className="btn btn--ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn--primary" disabled={busy} onClick={() => void save()}>
            {existing ? 'Save new version' : 'Create goal'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

export function GoalsTab() {
  const { client } = useOutletContext<ClientContext>();
  const docs = useDocumentsStore((s) => s.byClient[client.id]);
  const { loadClient, updateGoal, duplicateGoal, reorderGoal, deleteGoal, addObjectiveProgressNote } = useDocumentsStore();
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState<TreatmentGoal | undefined>();
  const [noteDrafts, setNoteDrafts] = useState<Record<string, string>>({});

  useEffect(() => {
    void loadClient(client.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client.id]);

  const goals = docs?.goals ?? [];

  return (
    <div className="stack">
      <div className="spread">
        <div>
          <h2>Goals &amp; objectives</h2>
          <p className="muted small">
            Structured, measurable goals used by the DAP and treatment-plan generators. Edits are
            version-tracked.
          </p>
        </div>
        <button className="btn btn--primary" onClick={() => setShowAdd(true)}>
          <Icon name="plus" size={15} /> New goal
        </button>
      </div>

      {goals.length === 0 ? (
        <Card>
          <EmptyState icon="check" title="No goals yet">
            <p className="small">Create measurable goals here; the treatment-plan generator links to them and flags missing components.</p>
          </EmptyState>
        </Card>
      ) : (
        goals.map((goal, index) => (
          <Card key={goal.id}>
            <div className="stack-sm">
              <div className="spread">
                <div className="cluster">
                  <Badge tone={goal.kind === 'short-term' ? 'blue' : 'plum'}>{goal.kind}</Badge>
                  <strong>{goal.title}</strong>
                  <Badge tone={goal.status === 'active' ? 'green' : 'neutral'}>{goal.status}</Badge>
                  <Badge tone="neutral">v{goal.version}</Badge>
                </div>
                <div className="cluster">
                  <button className="icon-btn" style={{ width: 30, height: 30 }} aria-label="Move up" disabled={index === 0} onClick={() => void reorderGoal(goal.id, client.id, 'up')}>
                    <Icon name="chevron-left" size={14} className="" />
                  </button>
                  <button className="icon-btn" style={{ width: 30, height: 30, transform: 'rotate(180deg)' }} aria-label="Move down" disabled={index === goals.length - 1} onClick={() => void reorderGoal(goal.id, client.id, 'down')}>
                    <Icon name="chevron-left" size={14} />
                  </button>
                  <button className="btn btn--ghost btn--sm" onClick={() => setEditing(goal)}>
                    <Icon name="edit" size={12} /> Edit
                  </button>
                  <button className="btn btn--ghost btn--sm" onClick={() => void duplicateGoal(goal.id, client.id)}>
                    Duplicate
                  </button>
                  <select
                    className="select"
                    style={{ width: 'auto', padding: '4px 8px' }}
                    value={goal.status}
                    onChange={(e) => void updateGoal(goal.id, client.id, { status: e.target.value as GoalStatus }, `Status → ${e.target.value}`)}
                    aria-label="Goal status"
                  >
                    {GOAL_STATUSES.map((s) => (
                      <option key={s.value} value={s.value}>{s.label}</option>
                    ))}
                  </select>
                  <button className="btn btn--danger btn--sm" onClick={() => void deleteGoal(goal.id, client.id)}>
                    <Icon name="trash" size={12} />
                  </button>
                </div>
              </div>
              {goal.rationale && <p className="muted small" style={{ margin: 0 }}>Rationale: {goal.rationale}</p>}

              {goal.objectives.map((objective) => {
                const missing = objectiveMissingItems(objective);
                const draftKey = `${goal.id}:${objective.id}`;
                return (
                  <div key={objective.id} className="stack-sm" style={{ borderTop: '1px solid var(--line)', paddingTop: 10, gap: 6 }}>
                    <p className="soft small" style={{ margin: 0 }}>{objective.description}</p>
                    <div className="cluster" style={{ gap: 6 }}>
                      <Badge tone={objective.progress === 'achieved' ? 'green' : objective.progress === 'in-progress' ? 'blue' : 'neutral'}>
                        {objective.progress}
                      </Badge>
                      {objective.measurementMethod && <Badge tone="neutral">{objective.measurementMethod}</Badge>}
                      {objective.baseline && <Badge tone="neutral">Baseline: {objective.baseline}</Badge>}
                      {objective.target && <Badge tone="neutral">Target: {objective.target}</Badge>}
                      {(objective.targetDate || objective.timeFrame) && (
                        <Badge tone="neutral">{objective.targetDate ?? objective.timeFrame}</Badge>
                      )}
                      <select
                        className="select"
                        style={{ width: 'auto', padding: '2px 8px', fontSize: '0.8rem' }}
                        value={objective.progress}
                        onChange={(e) =>
                          void updateGoal(
                            goal.id,
                            client.id,
                            { objectives: goal.objectives.map((o) => (o.id === objective.id ? { ...o, progress: e.target.value as Objective['progress'] } : o)) },
                            `Objective progress → ${e.target.value}`,
                          )
                        }
                        aria-label="Objective progress"
                      >
                        {(['not-started', 'in-progress', 'achieved', 'revised', 'discontinued'] as const).map((p) => (
                          <option key={p} value={p}>{p}</option>
                        ))}
                      </select>
                    </div>
                    {missing.length > 0 && (
                      <p className="muted small" style={{ margin: 0, color: 'var(--amber)' }}>
                        Needs completion: {missing.join('; ')}
                      </p>
                    )}
                    {objective.progressNotes.length > 0 && (
                      <div className="stack-sm" style={{ gap: 2 }}>
                        {objective.progressNotes.slice(-3).map((note, i) => (
                          <p key={i} className="muted small" style={{ margin: 0 }}>
                            {fmtDateTime(note.at)} — {note.note} ({note.author})
                          </p>
                        ))}
                      </div>
                    )}
                    <div className="cluster">
                      <input
                        className="input"
                        style={{ flex: '1 1 200px', padding: '5px 10px' }}
                        placeholder="Add progress note…"
                        value={noteDrafts[draftKey] ?? ''}
                        onChange={(e) => setNoteDrafts({ ...noteDrafts, [draftKey]: e.target.value })}
                      />
                      <button
                        className="btn btn--secondary btn--sm"
                        disabled={!(noteDrafts[draftKey] ?? '').trim()}
                        onClick={() => {
                          void addObjectiveProgressNote(goal.id, client.id, objective.id, noteDrafts[draftKey].trim());
                          setNoteDrafts({ ...noteDrafts, [draftKey]: '' });
                        }}
                      >
                        Add note
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>
        ))
      )}

      {(showAdd || editing) && (
        <GoalFormModal clientId={client.id} existing={editing} onClose={() => { setShowAdd(false); setEditing(undefined); }} />
      )}
    </div>
  );
}
