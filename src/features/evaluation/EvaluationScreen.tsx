import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Icon } from '../../app/components/Icon';
import { Badge, Card, EmptyState, Field, Modal, type BadgeTone } from '../../app/components/ui';
import {
  CLINICIAN_RATINGS,
  EVAL_METRICS_DISCLAIMER,
  EVAL_TASK_TYPES,
  TRAP_LABELS,
  type CustomEvalCaseDraft,
  type EvalCase,
  type EvalTaskType,
} from '../../core/eval/evalSchema';
import { PROVIDER_TYPE_LABELS } from '../../core/ai/aiSchema';
import { fmtDate, fmtDateTime } from '../../lib/format';
import { useAiStore } from '../../state/aiStore';
import { useGovernanceStore } from '../../state/governanceStore';

export function scoreTone(score: number): BadgeTone {
  return score >= 85 ? 'green' : score >= 60 ? 'amber' : 'red';
}

const CUSTOM_CASE_TEMPLATE: CustomEvalCaseDraft = {
  title: 'Custom fictional case',
  summary: 'FICTIONAL — describe the scenario here.',
  inputs: [{ inputType: 'session-transcript', date: '2026-06-15', text: 'Fictional transcript text…', containsRisk: false }],
  assessments: [],
  diagnoses: [],
  medications: [],
  seedApprovedFacts: [],
  seedHypotheses: [],
  seedGoals: [],
  seedContradictions: [],
  knowledgeSources: [],
  expected: {
    facts: [{ keywords: ['keyword1', 'keyword2'], category: 'other' }],
    risks: [],
    contradictions: [],
    formulationThemes: [],
    planTargets: [],
    interventions: [],
    interventionsNotExpected: [],
    missingInformation: [],
  },
  knownTraps: [],
};

export function EvaluationScreen() {
  const navigate = useNavigate();
  const cases = useGovernanceStore((s) => s.cases);
  const runs = useGovernanceStore((s) => s.runs);
  const runningEval = useGovernanceStore((s) => s.runningEval);
  const loadEval = useGovernanceStore((s) => s.loadEval);
  const runEval = useGovernanceStore((s) => s.runEval);
  const createCustomCase = useGovernanceStore((s) => s.createCustomCase);
  const deleteCustomCase = useGovernanceStore((s) => s.deleteCustomCase);
  const aiSettings = useAiStore((s) => s.settings);
  const readiness = useAiStore((s) => s.readiness);

  const [caseId, setCaseId] = useState('');
  const [taskType, setTaskType] = useState<EvalTaskType>('extraction');
  const [providerType, setProviderType] = useState<'deterministic' | 'local' | 'online'>('deterministic');
  const [onlineConfirmed, setOnlineConfirmed] = useState(false);
  const [error, setError] = useState<string>();
  const [showDetail, setShowDetail] = useState<EvalCase>();
  const [showCustom, setShowCustom] = useState(false);
  const [customJson, setCustomJson] = useState(JSON.stringify(CUSTOM_CASE_TEMPLATE, null, 2));
  const [customError, setCustomError] = useState<string>();

  useEffect(() => {
    void loadEval();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectedCase = cases.find((c) => c.id === caseId);
  const localReady = readiness['local-endpoint']?.ready ?? false;
  const onlineReady = readiness['anthropic-online']?.ready ?? false;

  const run = async () => {
    if (!selectedCase) return;
    setError(undefined);
    try {
      const result = await runEval(caseId, taskType, providerType, providerType === 'online' ? onlineConfirmed : undefined);
      navigate(`runs/${result.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Evaluation failed.');
    } finally {
      setOnlineConfirmed(false);
    }
  };

  const submitCustom = async () => {
    setCustomError(undefined);
    try {
      const parsed = JSON.parse(customJson) as CustomEvalCaseDraft;
      if (!parsed.title?.trim() || !Array.isArray(parsed.inputs) || parsed.inputs.length === 0) {
        throw new Error('A custom case needs at least a title and one input.');
      }
      if (!parsed.expected) throw new Error('A custom case needs an "expected" block (targets to compare against).');
      const invalidTrap = (parsed.knownTraps ?? []).find((t) => !(t in TRAP_LABELS));
      if (invalidTrap) throw new Error(`Unknown trap id: ${invalidTrap}`);
      await createCustomCase(parsed);
      setShowCustom(false);
    } catch (err) {
      setCustomError(err instanceof Error ? err.message : 'Invalid case JSON.');
    }
  };

  const recentRuns = useMemo(() => runs.slice(0, 12), [runs]);

  return (
    <main className="page">
      <div className="stack" style={{ maxWidth: 1000, margin: '0 auto' }}>
        <div className="spread">
          <button className="btn btn--ghost btn--sm" onClick={() => navigate('/settings')}>
            <Icon name="chevron-left" size={15} /> Workspace settings
          </button>
          <div className="cluster">
            <Link className="btn btn--secondary btn--sm" to="compare">
              <Icon name="eye" size={13} /> Model comparison
            </Link>
            <button className="btn btn--secondary btn--sm" onClick={() => setShowCustom(true)}>
              <Icon name="plus" size={13} /> Custom fictional case
            </button>
          </div>
        </div>

        <Card title="Clinical AI Evaluation" icon="activity">
          <div className="stack-sm">
            <div className="notice notice--warn">
              <Icon name="alert" size={16} />
              <span className="small">
                <strong>Fictional test clients only.</strong> This area is fully separate from real client
                profiles: cases run inside an ephemeral, encrypted, in-memory sandbox that never touches the
                client database. Never paste real client material here — de-identification must happen outside
                the app.
              </span>
            </div>
            <p className="muted small" style={{ margin: 0 }}>{EVAL_METRICS_DISCLAIMER}</p>

            <div className="cluster" style={{ alignItems: 'flex-end', flexWrap: 'wrap' }}>
              <Field label="Fictional test client">
                <select className="select" value={caseId} onChange={(e) => setCaseId(e.target.value)}>
                  <option value="">Select a case…</option>
                  {cases.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.source === 'custom' ? '[custom] ' : ''}{c.title}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Task type">
                <select className="select" value={taskType} onChange={(e) => setTaskType(e.target.value as EvalTaskType)}>
                  {EVAL_TASK_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </select>
              </Field>
              <Field label="Provider">
                <select className="select" value={providerType} onChange={(e) => { setProviderType(e.target.value as never); setOnlineConfirmed(false); }}>
                  <option value="deterministic">{PROVIDER_TYPE_LABELS.deterministic}</option>
                  <option value="local" disabled={!localReady}>
                    {PROVIDER_TYPE_LABELS.local}{localReady ? '' : ' — not connected'}
                  </option>
                  <option value="online" disabled={!onlineReady}>
                    {PROVIDER_TYPE_LABELS.online}{onlineReady ? '' : ' — not configured'}
                  </option>
                </select>
              </Field>
              <button className="btn btn--primary" disabled={!selectedCase || runningEval || (providerType === 'online' && !onlineConfirmed)} onClick={() => void run()}>
                <Icon name="activity" size={15} /> {runningEval ? 'Running…' : 'Run evaluation'}
              </button>
            </div>

            {selectedCase && (
              <div className="cluster">
                <button className="btn btn--ghost btn--sm" onClick={() => setShowDetail(selectedCase)}>
                  <Icon name="eye" size={13} /> View case content & expected targets
                </button>
                {selectedCase.knownTraps.length > 0 && (
                  <span className="muted small">
                    Known traps: {selectedCase.knownTraps.map((t) => TRAP_LABELS[t]).join(' · ')}
                  </span>
                )}
              </div>
            )}

            {providerType === 'online' && selectedCase && (
              <div className="notice notice--warn" style={{ display: 'block' }}>
                <span className="small">
                  Online run: the FICTIONAL case text below will be sent to {aiSettings.onlineModel} over HTTPS.
                  No real client data is involved.
                </span>
                <div className="soft small prewrap" style={{ maxHeight: 140, overflowY: 'auto', marginTop: 6 }}>
                  {selectedCase.inputs.map((i) => i.text).join('\n\n')}
                </div>
                <label className="cluster small" style={{ marginTop: 8, gap: 8 }}>
                  <input type="checkbox" checked={onlineConfirmed} onChange={(e) => setOnlineConfirmed(e.target.checked)} />
                  I reviewed the fictional text above and confirm the online send.
                </label>
              </div>
            )}

            {error && (
              <div className="notice notice--danger" role="alert">
                <Icon name="alert" size={15} />
                <span className="small">{error}</span>
              </div>
            )}
          </div>
        </Card>

        <Card title={`Fictional test client library (${cases.length})`} icon="users">
          <div className="row-list">
            {cases.map((c) => (
              <div key={c.id} className="list-row" style={{ cursor: 'default' }}>
                <Icon name="user" size={16} className="soft" />
                <span style={{ flex: 1 }}>
                  <strong className="small">{c.title}</strong>
                  <span className="muted small" style={{ display: 'block' }}>{c.summary.slice(0, 140)}…</span>
                </span>
                <Badge tone={c.source === 'built-in' ? 'blue' : 'plum'}>{c.source}</Badge>
                <button className="btn btn--ghost btn--sm" onClick={() => setShowDetail(c)}>
                  <Icon name="eye" size={13} /> View
                </button>
                {c.source === 'custom' && (
                  <button className="btn btn--ghost btn--sm" onClick={() => void deleteCustomCase(c.id)}>
                    <Icon name="trash" size={13} />
                  </button>
                )}
              </div>
            ))}
          </div>
        </Card>

        <Card title={`Recent evaluation runs (${runs.length})`} icon="clock">
          {recentRuns.length === 0 ? (
            <EmptyState icon="activity" title="No evaluation runs yet">
              <p className="small">Select a fictional case above and run your first evaluation.</p>
            </EmptyState>
          ) : (
            <div className="row-list">
              {recentRuns.map((r) => (
                <button key={r.id} className="list-row" onClick={() => navigate(`runs/${r.id}`)}>
                  <Icon name="activity" size={16} className="soft" />
                  <span style={{ flex: 1 }}>
                    <strong className="small">{EVAL_TASK_TYPES.find((t) => t.value === r.taskType)?.label} — {r.caseTitle}</strong>
                    <span className="muted small" style={{ display: 'block' }}>
                      {fmtDateTime(r.createdAt)} · {r.providerType} · {r.modelId} · {r.durationMs} ms
                      {r.clinicianRating ? ` · rated ${CLINICIAN_RATINGS.find((x) => x.value === r.clinicianRating)?.label}` : ''}
                    </span>
                  </span>
                  {r.status === 'failed' ? (
                    <Badge tone="red" icon="x">failed</Badge>
                  ) : (
                    <Badge tone={scoreTone(r.score)} icon="activity">score {r.score}</Badge>
                  )}
                  {r.trapResults.some((t) => !t.passed) && <Badge tone="red" icon="alert">trap failed</Badge>}
                  <Icon name="chevron-right" size={15} className="soft" />
                </button>
              ))}
            </div>
          )}
        </Card>
      </div>

      {showDetail && (
        <Modal title={showDetail.title} subtitle="All content is fictional — written for evaluation only." onClose={() => setShowDetail(undefined)}>
          <div className="stack-sm" style={{ maxHeight: '62vh', overflowY: 'auto' }}>
            <p className="small">{showDetail.summary}</p>
            <strong className="small">Raw material</strong>
            {showDetail.inputs.map((input, i) => (
              <div key={i} className="soft small" style={{ display: 'block' }}>
                <span className="muted">{input.inputType} · {fmtDate(input.date)}{input.containsRisk ? ' · risk-flagged' : ''}</span>
                <p className="prewrap" style={{ margin: '4px 0 0' }}>{input.text}</p>
              </div>
            ))}
            {showDetail.assessments.length > 0 && (
              <p className="small" style={{ margin: 0 }}>
                <strong>Assessment scores:</strong> {showDetail.assessments.map((a) => `${a.name} = ${a.score}`).join(', ')}
              </p>
            )}
            <strong className="small">Expected targets</strong>
            <ul className="small" style={{ margin: 0 }}>
              {showDetail.expected.facts.map((f, i) => (
                <li key={`f${i}`}>Fact [{f.category}{f.riskRelated ? ', risk' : ''}{f.mustBeHypothesis ? ', must be hypothesis' : ''}]: {f.keywords.join(', ')}</li>
              ))}
              {showDetail.expected.risks.map((r, i) => (
                <li key={`r${i}`}>Risk ({r.qualifier}): {r.keywords.join(', ')}</li>
              ))}
              {showDetail.expected.interventions.map((iv, i) => (
                <li key={`i${i}`}>Intervention: {iv.name}</li>
              ))}
              {showDetail.expected.formulationThemes.map((t, i) => (
                <li key={`t${i}`}>Formulation ({t.framework} → {t.sectionKey}): {t.keywords.join(', ')}</li>
              ))}
            </ul>
            {showDetail.knownTraps.length > 0 && (
              <>
                <strong className="small">Known traps</strong>
                <ul className="small" style={{ margin: 0 }}>
                  {showDetail.knownTraps.map((t) => <li key={t}>{TRAP_LABELS[t]}</li>)}
                </ul>
              </>
            )}
            <button className="btn btn--secondary" onClick={() => setShowDetail(undefined)}>Close</button>
          </div>
        </Modal>
      )}

      {showCustom && (
        <Modal
          title="Create custom fictional case"
          subtitle="FICTIONAL OR FULLY DE-IDENTIFIED CONTENT ONLY. Edit the JSON template — it is validated before saving."
          onClose={() => setShowCustom(false)}
        >
          <div className="stack-sm">
            <textarea
              className="textarea"
              style={{ minHeight: 260, fontFamily: 'ui-monospace, monospace', fontSize: '0.78rem' }}
              value={customJson}
              onChange={(e) => setCustomJson(e.target.value)}
            />
            {customError && (
              <div className="notice notice--danger" role="alert">
                <Icon name="alert" size={15} />
                <span className="small">{customError}</span>
              </div>
            )}
            <div className="cluster">
              <button className="btn btn--primary" onClick={() => void submitCustom()}>
                <Icon name="plus" size={14} /> Save custom case
              </button>
              <button className="btn btn--secondary" onClick={() => setShowCustom(false)}>Cancel</button>
            </div>
          </div>
        </Modal>
      )}
    </main>
  );
}
