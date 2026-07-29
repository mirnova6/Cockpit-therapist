import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Icon } from '../../app/components/Icon';
import { Badge, Card, EmptyState, Field } from '../../app/components/ui';
import { CLAIM_STATUS_LABELS } from '../../core/ai/aiSchema';
import {
  CLINICIAN_RATINGS,
  EVAL_METRICS_DISCLAIMER,
  EVAL_TASK_TYPES,
  type ClinicianRating,
} from '../../core/eval/evalSchema';
import { fmtDateTime } from '../../lib/format';
import { useGovernanceStore } from '../../state/governanceStore';
import { scoreTone } from './EvaluationScreen';

export function EvalRunScreen() {
  const { runId } = useParams<{ runId: string }>();
  const navigate = useNavigate();
  const runs = useGovernanceStore((s) => s.runs);
  const loadEval = useGovernanceStore((s) => s.loadEval);
  const rateRun = useGovernanceStore((s) => s.rateRun);
  const [rating, setRating] = useState<ClinicianRating>('good');
  const [comment, setComment] = useState('');

  useEffect(() => {
    void loadEval();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const run = runs.find((r) => r.id === runId);
  if (!run) {
    return (
      <main id="main-content" tabIndex={-1} className="page">
        <Card>
          <EmptyState icon="activity" title="Run not found">
            <button className="btn btn--secondary" onClick={() => navigate('/evaluation')}>Back to evaluation</button>
          </EmptyState>
        </Card>
      </main>
    );
  }

  const highPriority = run.errors.filter((e) => e.highPriority);

  return (
    <main id="main-content" tabIndex={-1} className="page">
      <div className="stack" style={{ maxWidth: 1000, margin: '0 auto' }}>
        <div className="spread">
          <button className="btn btn--ghost btn--sm" onClick={() => navigate('/evaluation')}>
            <Icon name="chevron-left" size={15} /> All runs
          </button>
          <div className="cluster">
            {run.status === 'failed' ? (
              <Badge tone="red" icon="x">Run failed{run.errorKind ? ` (${run.errorKind})` : ''}</Badge>
            ) : (
              <Badge tone={scoreTone(run.score)} icon="activity">Internal score {run.score}/100</Badge>
            )}
            <Badge tone={run.providerType === 'online' ? 'amber' : run.providerType === 'local' ? 'blue' : 'green'}>
              {run.providerType} · {run.modelId}
            </Badge>
            <Badge tone={run.phiLeftDevice ? 'amber' : 'green'} icon="shield">
              {run.phiLeftDevice ? 'Fictional content sent online' : 'Nothing left this device'}
            </Badge>
          </div>
        </div>

        <Card title={`${EVAL_TASK_TYPES.find((t) => t.value === run.taskType)?.label} — ${run.caseTitle}`} icon="activity">
          <p className="muted small" style={{ margin: 0 }}>
            {fmtDateTime(run.startedAt)} → {fmtDateTime(run.finishedAt)} · {run.durationMs} ms · {EVAL_METRICS_DISCLAIMER}
          </p>
        </Card>

        {highPriority.length > 0 && (
          <Card title={`High-priority failures (${highPriority.length})`} icon="alert">
            <div className="stack-sm">
              {highPriority.map((error, i) => (
                <div key={i} className="notice notice--danger" style={{ display: 'block' }}>
                  <strong className="small">{error.kind.replace(/-/g, ' ')}</strong>
                  <p className="small" style={{ margin: '4px 0 0' }}>{error.detail}</p>
                  {error.generatedText && (
                    <p className="small prewrap soft" style={{ margin: '6px 0 0' }}>“{error.generatedText}”</p>
                  )}
                </div>
              ))}
            </div>
          </Card>
        )}

        {run.trapResults.length > 0 && (
          <Card title="Known-trap results" icon="shield">
            <div className="stack-sm">
              {run.trapResults.map((trap) => (
                <div key={trap.trap} className="cluster" style={{ alignItems: 'flex-start' }}>
                  <Badge tone={trap.passed ? 'green' : 'red'} icon={trap.passed ? 'check' : 'x'}>
                    {trap.passed ? 'Avoided' : 'FAILED'}
                  </Badge>
                  <span className="small" style={{ flex: 1 }}>
                    <strong>{trap.label}.</strong> {trap.detail}
                  </span>
                </div>
              ))}
            </div>
          </Card>
        )}

        {run.extraction && (
          <Card title="Extraction accuracy (internal quality check)" icon="list">
            <div className="cluster" style={{ flexWrap: 'wrap', gap: 8 }}>
              <Badge tone="blue">Precision {run.extraction.precision}</Badge>
              <Badge tone="blue">Recall {run.extraction.recall}</Badge>
              <Badge tone="blue">F1 {run.extraction.f1}</Badge>
              <Badge tone="green">Correct {run.extraction.truePositives}</Badge>
              <Badge tone={run.extraction.falseNegatives > 0 ? 'amber' : 'neutral'}>Missed {run.extraction.falseNegatives}</Badge>
              <Badge tone="neutral">Extra {run.extraction.falsePositives}</Badge>
              <Badge tone={run.extraction.categoryMismatches > 0 ? 'amber' : 'neutral'}>Category mismatches {run.extraction.categoryMismatches}</Badge>
              <Badge tone={run.extraction.missingExcerpts > 0 ? 'amber' : 'neutral'}>Missing excerpts {run.extraction.missingExcerpts}</Badge>
              <Badge tone={run.extraction.riskFalseNegatives > 0 ? 'red' : 'neutral'}>Risk false negatives {run.extraction.riskFalseNegatives}</Badge>
              <Badge tone={run.extraction.riskFalsePositives > 0 ? 'amber' : 'neutral'}>Risk false positives {run.extraction.riskFalsePositives}</Badge>
              <Badge tone={run.extraction.hypothesisAsFact > 0 ? 'red' : 'neutral'}>Hypothesis-as-fact {run.extraction.hypothesisAsFact}</Badge>
            </div>
          </Card>
        )}

        {run.hallucination && (
          <Card title="Hallucination & unsupported-claim metrics" icon="alert">
            <div className="stack-sm">
              <div className="cluster" style={{ flexWrap: 'wrap', gap: 8 }}>
                <Badge tone={run.hallucination.unsupportedRate > 0 ? 'amber' : 'green'}>
                  Unsupported rate {Math.round(run.hallucination.unsupportedRate * 100)}%
                </Badge>
                <Badge tone={run.hallucination.contradictedRate > 0 ? 'red' : 'green'}>
                  Contradicted rate {Math.round(run.hallucination.contradictedRate * 100)}%
                </Badge>
                <Badge tone={run.hallucination.unsupportedDiagnoses > 0 ? 'red' : 'neutral'}>Unsupported diagnoses {run.hallucination.unsupportedDiagnoses}</Badge>
                <Badge tone={run.hallucination.unsupportedMentalStatus > 0 ? 'red' : 'neutral'}>Unsupported MSE {run.hallucination.unsupportedMentalStatus}</Badge>
                <Badge tone={run.hallucination.unsupportedRiskStatements > 0 ? 'red' : 'neutral'}>Unsupported risk {run.hallucination.unsupportedRiskStatements}</Badge>
                <Badge tone={run.hallucination.unsupportedCitations > 0 ? 'amber' : 'neutral'}>Unverifiable citations {run.hallucination.unsupportedCitations}</Badge>
                <Badge tone={run.hallucination.factHypothesisConfusions > 0 ? 'red' : 'neutral'}>Fact/hypothesis confusion {run.hallucination.factHypothesisConfusions}</Badge>
              </div>
              <div className="soft small" style={{ display: 'block' }}>
                {run.hallucination.claimBreakdown.map((row) => (
                  <p key={row.status} style={{ margin: '2px 0' }}>
                    <strong>{CLAIM_STATUS_LABELS[row.status]}:</strong> {row.count}
                    {row.examples.length > 0 && <span className="muted"> — e.g. “{row.examples[0].slice(0, 100)}”</span>}
                  </p>
                ))}
              </div>
            </div>
          </Card>
        )}

        {run.retrieval && (
          <Card title="Retrieval quality" icon="search">
            <div className="stack-sm">
              <div className="cluster" style={{ flexWrap: 'wrap', gap: 8 }}>
                <Badge tone="green">Expected retrieved {run.retrieval.expectedRetrieved}</Badge>
                <Badge tone={run.retrieval.expectedMissed > 0 ? 'amber' : 'neutral'}>Expected missed {run.retrieval.expectedMissed}</Badge>
                <Badge tone={run.retrieval.irrelevantRetrieved > 0 ? 'amber' : 'neutral'}>Irrelevant retrieved {run.retrieval.irrelevantRetrieved}</Badge>
                <Badge tone="blue">Time periods {run.retrieval.timePeriodsCovered}</Badge>
                <Badge tone={run.retrieval.contradictionRetrieved ? 'green' : 'neutral'}>
                  Contradictions {run.retrieval.contradictionRetrieved ? 'retrieved' : 'none'}
                </Badge>
                <Badge tone={run.retrieval.isolationVerified ? 'green' : 'red'} icon="shield">
                  Isolation {run.retrieval.isolationVerified ? 'verified' : 'FAILED'}
                </Badge>
              </div>
              {run.retrieval.failureExplanations.map((explanation, i) => (
                <p key={i} className="small muted" style={{ margin: 0 }}>Retrieval failure: {explanation}</p>
              ))}
            </div>
          </Card>
        )}

        {run.riskSafety && (
          <Card title="Risk-safety evaluation" icon="shield">
            <div className="cluster" style={{ flexWrap: 'wrap', gap: 8 }}>
              <Badge tone="green">Expected risks found {run.riskSafety.expectedRisksFound}</Badge>
              <Badge tone={run.riskSafety.expectedRisksMissed > 0 ? 'red' : 'neutral'}>Missed {run.riskSafety.expectedRisksMissed}</Badge>
              <Badge tone={run.riskSafety.falseCurrentRiskInferences > 0 ? 'red' : 'green'}>
                False current-risk inferences {run.riskSafety.falseCurrentRiskInferences}
              </Badge>
              <Badge tone="blue">Qualifiers correct {run.riskSafety.qualifiersCorrect}/{run.riskSafety.qualifiersCorrect + run.riskSafety.qualifiersIncorrect}</Badge>
              <Badge tone={run.riskSafety.allRiskItemsIndividualReview ? 'green' : 'red'}>
                Individual review {run.riskSafety.allRiskItemsIndividualReview ? 'enforced' : 'MISSING'}
              </Badge>
              <Badge tone={run.riskSafety.noAutonomousDetermination ? 'green' : 'red'}>
                {run.riskSafety.noAutonomousDetermination ? 'No autonomous determination' : 'AUTONOMOUS DETERMINATION FOUND'}
              </Badge>
              <Badge tone="green">No bulk approval path</Badge>
            </div>
          </Card>
        )}

        {run.qualityChecks.length > 0 && (
          <Card title="Quality checks" icon="check">
            <div className="stack-sm">
              {run.qualityChecks.map((check, i) => (
                <div key={i} className="cluster" style={{ alignItems: 'flex-start' }}>
                  <Badge tone={check.passed ? 'green' : 'amber'} icon={check.passed ? 'check' : 'alert'}>
                    {check.passed ? 'pass' : 'review'}
                  </Badge>
                  <span className="small" style={{ flex: 1 }}>
                    <strong>{check.label}.</strong> <span className="muted">{check.detail}</span>
                  </span>
                </div>
              ))}
            </div>
          </Card>
        )}

        {run.errors.filter((e) => !e.highPriority).length > 0 && (
          <Card title={`Other findings (${run.errors.filter((e) => !e.highPriority).length})`} icon="info">
            <ul className="small" style={{ margin: 0 }}>
              {run.errors.filter((e) => !e.highPriority).map((error, i) => (
                <li key={i}>
                  <strong>{error.kind.replace(/-/g, ' ')}:</strong> {error.detail}
                  {error.generatedText && <span className="muted"> — “{error.generatedText.slice(0, 120)}”</span>}
                </li>
              ))}
            </ul>
          </Card>
        )}

        <Card title="Generated output (fictional content)" icon="file">
          <p className="soft small prewrap" style={{ maxHeight: 300, overflowY: 'auto' }}>{run.outputPreview || '—'}</p>
        </Card>

        <Card title="Clinician rating" icon="edit">
          {run.clinicianRating ? (
            <p className="small" style={{ margin: 0 }}>
              Rated <strong>{CLINICIAN_RATINGS.find((r) => r.value === run.clinicianRating)?.label}</strong>
              {run.clinicianComment ? ` — “${run.clinicianComment}”` : ''}
            </p>
          ) : (
            <div className="cluster" style={{ alignItems: 'flex-end', flexWrap: 'wrap' }}>
              <Field label="Rating">
                <select className="select" value={rating} onChange={(e) => setRating(e.target.value as ClinicianRating)}>
                  {CLINICIAN_RATINGS.map((r) => (
                    <option key={r.value} value={r.value}>{r.label}</option>
                  ))}
                </select>
              </Field>
              <Field label="Comment (optional)">
                <input className="input" value={comment} onChange={(e) => setComment(e.target.value)} />
              </Field>
              <button className="btn btn--primary btn--sm" onClick={() => void rateRun(run.id, rating, comment.trim() || undefined)}>
                <Icon name="check" size={13} /> Save rating
              </button>
            </div>
          )}
        </Card>
      </div>
    </main>
  );
}
