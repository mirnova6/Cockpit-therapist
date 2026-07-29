import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon } from '../../app/components/Icon';
import { Badge, Card, EmptyState, Field } from '../../app/components/ui';
import {
  CLINICIAN_RATINGS,
  EVAL_TASK_TYPES,
  type EvalRun,
  type EvalTaskType,
} from '../../core/eval/evalSchema';
import { fmtDateTime } from '../../lib/format';
import { useGovernanceStore } from '../../state/governanceStore';
import { scoreTone } from './EvaluationScreen';

function RunColumn({ run }: { run: EvalRun }) {
  const navigate = useNavigate();
  const missedExpected = run.errors.filter((e) => e.kind === 'missed-fact' || e.kind === 'missed-expected-source' || e.kind === 'missed-risk').length;
  const unsupported = run.errors.filter((e) => e.kind.startsWith('unsupported')).length;
  return (
    <div className="soft" style={{ display: 'block', padding: 12, flex: '1 1 280px', minWidth: 260 }}>
      <div className="stack-sm">
        <div className="cluster">
          <Badge tone={run.providerType === 'online' ? 'amber' : run.providerType === 'local' ? 'blue' : 'green'}>
            {run.providerType}
          </Badge>
          <span className="muted small">{run.modelId}</span>
        </div>
        {run.status === 'failed' ? (
          <Badge tone="red" icon="x">failed{run.errorKind ? ` (${run.errorKind})` : ''}</Badge>
        ) : (
          <Badge tone={scoreTone(run.score)} icon="activity">score {run.score}/100</Badge>
        )}
        <ul className="small" style={{ margin: 0, paddingLeft: 16 }}>
          <li>{fmtDateTime(run.createdAt)}</li>
          <li>{run.durationMs} ms to complete</li>
          <li>{run.phiLeftDevice ? 'Fictional content sent online' : 'Nothing left this device'}</li>
          <li>{missedExpected} missed expected item(s)</li>
          <li>{unsupported} unsupported claim finding(s)</li>
          <li>{run.errors.length} total finding(s), {run.errors.filter((e) => e.highPriority).length} high-priority</li>
          <li>
            Traps: {run.trapResults.filter((t) => t.passed).length}/{run.trapResults.length} avoided
            {run.trapResults.some((t) => !t.passed) && ' ⚠'}
          </li>
          {run.riskSafety && (
            <li>
              Risk: {run.riskSafety.expectedRisksFound} found / {run.riskSafety.expectedRisksMissed} missed ·{' '}
              {run.riskSafety.falseCurrentRiskInferences} false current-risk
            </li>
          )}
          <li>
            Rating: {run.clinicianRating ? CLINICIAN_RATINGS.find((r) => r.value === run.clinicianRating)?.label : 'not rated'}
          </li>
        </ul>
        <details>
          <summary className="small" style={{ cursor: 'pointer' }}>Output</summary>
          <p className="small prewrap" style={{ maxHeight: 220, overflowY: 'auto', margin: '4px 0 0' }}>{run.outputPreview || '—'}</p>
        </details>
        <button className="btn btn--ghost btn--sm" onClick={() => navigate(`/evaluation/runs/${run.id}`)}>
          <Icon name="eye" size={13} /> Full result
        </button>
      </div>
    </div>
  );
}

export function CompareScreen() {
  const navigate = useNavigate();
  const runs = useGovernanceStore((s) => s.runs);
  const cases = useGovernanceStore((s) => s.cases);
  const loadEval = useGovernanceStore((s) => s.loadEval);
  const [caseId, setCaseId] = useState('');
  const [taskType, setTaskType] = useState<EvalTaskType | ''>('');

  useEffect(() => {
    void loadEval();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const comparable = useMemo(() => {
    const filtered = runs.filter(
      (r) => (!caseId || r.caseId === caseId) && (!taskType || r.taskType === taskType),
    );
    // Latest run per provider type for the selected case+task.
    const byProvider = new Map<string, EvalRun>();
    for (const run of filtered) {
      if (!byProvider.has(run.providerType)) byProvider.set(run.providerType, run);
    }
    return [...byProvider.values()];
  }, [runs, caseId, taskType]);

  return (
    <main id="main-content" tabIndex={-1} className="page">
      <div className="stack" style={{ maxWidth: 1100, margin: '0 auto' }}>
        <div className="spread">
          <button className="btn btn--ghost btn--sm" onClick={() => navigate('/evaluation')}>
            <Icon name="chevron-left" size={15} /> Evaluation
          </button>
        </div>

        <Card title="Model comparison — same fictional case, side by side" icon="eye">
          <div className="stack-sm">
            <p className="muted small" style={{ margin: 0 }}>
              Compares the latest run per provider for one fictional case and task. Real client data is never
              used here.
            </p>
            <div className="cluster" style={{ flexWrap: 'wrap' }}>
              <Field label="Fictional case">
                <select className="select" value={caseId} onChange={(e) => setCaseId(e.target.value)}>
                  <option value="">Select…</option>
                  {cases.map((c) => (
                    <option key={c.id} value={c.id}>{c.title}</option>
                  ))}
                </select>
              </Field>
              <Field label="Task">
                <select className="select" value={taskType} onChange={(e) => setTaskType(e.target.value as EvalTaskType | '')}>
                  <option value="">Select…</option>
                  {EVAL_TASK_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </select>
              </Field>
            </div>
          </div>
        </Card>

        {caseId && taskType && comparable.length === 0 && (
          <Card>
            <EmptyState icon="activity" title="No runs for this case + task yet">
              <p className="small">Run the task with one or more providers from the Evaluation screen first.</p>
            </EmptyState>
          </Card>
        )}

        {comparable.length > 0 && (
          <div className="cluster" style={{ alignItems: 'stretch', flexWrap: 'wrap', gap: 12 }}>
            {comparable.map((run) => (
              <RunColumn key={run.id} run={run} />
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
