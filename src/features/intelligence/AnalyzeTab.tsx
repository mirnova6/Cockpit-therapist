import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useOutletContext, useParams } from 'react-router-dom';
import { Icon } from '../../app/components/Icon';
import { Badge, Card, EmptyState, Field, Modal } from '../../app/components/ui';
import { ConsentRefusedError } from '../../core/ai/aiGateway';
import { REDACTION_DISCLAIMER, redactText } from '../../core/ai/redaction';
import { inputTypeLabel } from '../../core/db/schema';
import type { UpdateSummaryItem } from '../../core/db/intelligenceSchema';
import { PIPELINE_STEPS } from '../../core/pipeline/analyzePipeline';
import { fmtDate } from '../../lib/format';
import { useAiStore } from '../../state/aiStore';
import { useDataStore } from '../../state/dataStore';
import { useIntelligenceStore } from '../../state/intelligenceStore';
import type { ClientContext } from '../dashboard/ClientDashboardLayout';
import {
  ConfidenceLevelBadge,
  EvidenceDrawer,
  FeedbackBar,
  GenerationStamp,
  RetrievalDebugPanel,
} from './shared';

const KIND_LABELS: Record<UpdateSummaryItem['kind'], string> = {
  'explicit-information': 'Explicit new information',
  'proposed-fact': 'Proposed structured facts (inferred)',
  'proposed-hypothesis': 'Proposed hypotheses',
  'assessment-change': 'Assessment changes',
  'risk-mention': 'Risk-related mentions',
  'goal-progress': 'Progress toward goals',
  'theme': 'New or repeated themes',
  'contradiction': 'Contradictions',
  'formulation-change': 'Formulation changes',
  'treatment-implication': 'Treatment-plan implications',
  'next-session-focus': 'Suggested next-session focus',
  'intervention-option': 'Intervention options',
  'missing-information': 'Missing information',
};

const KIND_ORDER: UpdateSummaryItem['kind'][] = [
  'risk-mention',
  'explicit-information',
  'proposed-fact',
  'proposed-hypothesis',
  'contradiction',
  'assessment-change',
  'goal-progress',
  'theme',
  'formulation-change',
  'treatment-implication',
  'next-session-focus',
  'intervention-option',
  'missing-information',
];

export function AnalyzeTab() {
  const { client } = useOutletContext<ClientContext>();
  const navigate = useNavigate();
  const inputs = useDataStore((s) => s.inputs[client.id]) ?? [];
  const data = useIntelligenceStore((s) => s.byClient[client.id]);
  const loadClient = useIntelligenceStore((s) => s.loadClient);
  const runAnalyze = useIntelligenceStore((s) => s.runAnalyze);
  const requestCancel = useIntelligenceStore((s) => s.requestPipelineCancel);
  const progress = useIntelligenceStore((s) => s.pipelineProgress);
  const aiSettings = useAiStore((s) => s.settings);
  const activeReady = useAiStore((s) => s.activeReady);
  const setOnlineConfirmed = useAiStore((s) => s.setOnlineConfirmed);

  const [inputId, setInputId] = useState('');
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string>();
  const [confirmChecked, setConfirmChecked] = useState(false);

  const isOnline = aiSettings.activeProviderType === 'online' && activeReady;
  const selectedInput = inputs.find((i) => i.id === inputId);
  const summaries = data?.updateSummaries ?? [];

  useEffect(() => {
    void loadClient(client.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client.id]);

  const redactionPreview = useMemo(() => {
    if (!selectedInput || !isOnline || !aiSettings.redactBeforeSend) return undefined;
    return redactText(selectedInput.rawText, {
      knownNames: [client.displayName, client.preferredIdentifier ?? ''].filter(Boolean),
    });
  }, [selectedInput, isOnline, aiSettings.redactBeforeSend, client.displayName, client.preferredIdentifier]);

  const run = async () => {
    if (!selectedInput || running) return;
    setRunning(true);
    setError(undefined);
    if (isOnline) setOnlineConfirmed(confirmChecked);
    try {
      const summary = await runAnalyze(client.id, selectedInput.id, isOnline ? confirmChecked : undefined);
      navigate(`../analyze/${summary.id}`);
    } catch (err) {
      setError(
        err instanceof ConsentRefusedError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'Analysis failed.',
      );
    } finally {
      setOnlineConfirmed(false);
      setRunning(false);
    }
  };

  return (
    <div className="stack" style={{ maxWidth: 940 }}>
      <Card title="Analyze and Update" icon="activity">
        <div className="stack-sm">
          <p className="muted small" style={{ margin: 0 }}>
            Runs the 20-step clinical reasoning sequence over one entry: extraction, longitudinal retrieval,
            contradiction search, knowledge lookup, verification, and isolation checks. Every result is a
            proposal — nothing enters the record until you decide item by item.
            {!activeReady || aiSettings.activeProviderType === 'deterministic'
              ? ' No AI model is connected: extraction uses deterministic rules and is labeled accordingly.'
              : ''}
          </p>
          <Field label="Entry to analyze">
            <select className="select" value={inputId} onChange={(e) => { setInputId(e.target.value); setConfirmChecked(false); }}>
              <option value="">Select a clinical entry…</option>
              {inputs.map((input) => (
                <option key={input.id} value={input.id}>
                  {inputTypeLabel(input.inputType)} — {fmtDate(input.dateOfInformation)}
                  {input.containsRisk ? ' (risk-flagged)' : ''}
                </option>
              ))}
            </select>
          </Field>

          {selectedInput && isOnline && (
            <div className="notice notice--warn" style={{ display: 'block' }}>
              <strong className="small">
                <Icon name="upload" size={14} /> Online mode: this entry's text will be sent to {aiSettings.onlineModel} for extraction.
              </strong>
              {aiSettings.redactBeforeSend && (
                <p className="small muted" style={{ margin: '6px 0' }}>{REDACTION_DISCLAIMER}</p>
              )}
              <div className="soft small prewrap" style={{ maxHeight: 180, overflowY: 'auto' }}>
                {redactionPreview ? redactionPreview.text : selectedInput.rawText}
              </div>
              <label className="cluster small" style={{ marginTop: 8, gap: 8 }}>
                <input type="checkbox" checked={confirmChecked} onChange={(e) => setConfirmChecked(e.target.checked)} />
                I reviewed the text above and confirm it may be sent to the online provider.
              </label>
            </div>
          )}

          {error && (
            <div className="notice notice--danger" role="alert">
              <Icon name="alert" size={15} />
              <span className="small">{error}</span>
            </div>
          )}

          {running && progress ? (
            <div className="notice notice--info" style={{ display: 'block' }}>
              <div className="spread">
                <span className="small">
                  Step {progress.step}/{PIPELINE_STEPS.length}: {progress.name}…
                </span>
                <button className="btn btn--danger btn--sm" onClick={requestCancel}>
                  <Icon name="x" size={13} /> Cancel analysis
                </button>
              </div>
            </div>
          ) : (
            <button
              className="btn btn--primary"
              style={{ alignSelf: 'flex-start' }}
              disabled={!selectedInput || running || (isOnline && !confirmChecked)}
              onClick={() => void run()}
            >
              <Icon name="activity" size={15} /> {running ? 'Analyzing…' : 'Analyze and Update'}
            </button>
          )}
        </div>
      </Card>

      <Card title={`Clinical update summaries (${summaries.length})`} icon="list">
        {summaries.length === 0 ? (
          <EmptyState icon="activity" title="No analyses yet">
            <p className="small">Run “Analyze and Update” on an entry to create the first Clinical Update Summary.</p>
          </EmptyState>
        ) : (
          <div className="stack-sm">
            {summaries.map((summary) => {
              const undecided = summary.items.filter((i) => !i.decision).length;
              return (
                <div key={summary.id} className="spread soft" style={{ padding: 10 }}>
                  <div>
                    <Link to={`../analyze/${summary.id}`} className="small" style={{ fontWeight: 600 }}>
                      {fmtDate(summary.createdAt.slice(0, 10))} · {summary.items.length} item(s)
                    </Link>
                    <span className="muted small" style={{ display: 'block' }}>
                      {summary.generation.providerType === 'deterministic' ? 'Deterministic' : summary.generation.providerType === 'local' ? 'Local AI' : 'Online AI'}
                      {' · '}
                      {summary.status === 'pending-review'
                        ? `${undecided} awaiting review`
                        : summary.status === 'completed'
                          ? 'All items decided'
                          : 'Dismissed'}
                    </span>
                  </div>
                  <Badge
                    tone={summary.status === 'pending-review' ? 'amber' : summary.status === 'completed' ? 'green' : 'neutral'}
                    icon={summary.status === 'pending-review' ? 'clock' : 'check'}
                  >
                    {summary.status === 'pending-review' ? 'Pending review' : summary.status}
                  </Badge>
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------- detail

export function UpdateSummaryScreen() {
  const { client } = useOutletContext<ClientContext>();
  const { summaryId } = useParams<{ summaryId: string }>();
  const navigate = useNavigate();
  const data = useIntelligenceStore((s) => s.byClient[client.id]);
  const loadClient = useIntelligenceStore((s) => s.loadClient);
  const decideItem = useIntelligenceStore((s) => s.decideUpdateItem);
  const dismiss = useIntelligenceStore((s) => s.dismissSummary);
  const [editing, setEditing] = useState<UpdateSummaryItem>();
  const [editedText, setEditedText] = useState('');
  const [riskNote, setRiskNote] = useState('');
  const [comment, setComment] = useState<Record<string, string>>({});
  const [itemError, setItemError] = useState<Record<string, string>>({});
  const [showSteps, setShowSteps] = useState(false);

  useEffect(() => {
    void loadClient(client.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client.id]);

  const summary = (data?.updateSummaries ?? []).find((s) => s.id === summaryId);
  if (!summary) {
    return (
      <Card>
        <EmptyState icon="activity" title="Summary not found">
          <button className="btn btn--secondary" onClick={() => navigate('../analyze')}>Back to analyses</button>
        </EmptyState>
      </Card>
    );
  }

  const decide = async (
    item: UpdateSummaryItem,
    decision: 'approve' | 'edit-approve' | 'reject' | 'save-as-hypothesis' | 'needs-further-assessment' | 'do-not-save',
    editedStatement?: string,
  ) => {
    setItemError((prev) => ({ ...prev, [item.id]: '' }));
    try {
      await decideItem(summary.id, client.id, item.id, decision, {
        editedStatement,
        comment: comment[item.id]?.trim() || undefined,
        riskNote: riskNote.trim() || undefined,
      });
      setEditing(undefined);
      setRiskNote('');
    } catch (err) {
      setItemError((prev) => ({ ...prev, [item.id]: err instanceof Error ? err.message : 'Could not save.' }));
    }
  };

  const grouped = KIND_ORDER.map((kind) => ({
    kind,
    items: summary.items.filter((i) => i.kind === kind),
  })).filter((g) => g.items.length > 0);

  const undecided = summary.items.filter((i) => !i.decision).length;
  const individualCount = summary.items.filter((i) => i.requiresIndividualReview).length;

  return (
    <div className="stack" style={{ maxWidth: 940 }}>
      <div className="spread">
        <button className="btn btn--ghost btn--sm" onClick={() => navigate('../analyze')}>
          <Icon name="chevron-left" size={15} /> All analyses
        </button>
        <div className="cluster">
          <ConfidenceLevelBadge level={summary.overallConfidence} />
          <Badge tone={summary.status === 'pending-review' ? 'amber' : 'green'} icon={summary.status === 'pending-review' ? 'clock' : 'check'}>
            {summary.status === 'pending-review' ? `${undecided} of ${summary.items.length} awaiting review` : summary.status}
          </Badge>
        </div>
      </div>

      <Card title={`Clinical Update Summary — ${fmtDate(summary.createdAt.slice(0, 10))}`} icon="activity">
        <div className="stack-sm">
          <GenerationStamp generation={summary.generation} />
          {individualCount > 0 && (
            <div className="notice notice--warn">
              <Icon name="alert" size={16} />
              <span className="small">
                {individualCount} item{individualCount === 1 ? '' : 's'} require{individualCount === 1 ? 's' : ''} individual review
                (risk-sensitive, medication, diagnosis, hypothesis, or flagged by verification). There is no bulk
                approval here — every decision is per item.
              </span>
            </div>
          )}
          <div className="cluster">
            <button className="btn btn--ghost btn--sm" onClick={() => setShowSteps((v) => !v)}>
              <Icon name="list" size={13} /> Processing steps ({summary.steps.length})
            </button>
            {summary.retrievalDebug && <RetrievalDebugPanel debug={summary.retrievalDebug} />}
            <EvidenceDrawer sources={summary.sourcesUsed} clientId={client.id} label="Sources used" />
            {summary.status === 'pending-review' && (
              <button className="btn btn--ghost btn--sm" onClick={() => void dismiss(summary.id, client.id).then(() => navigate('../analyze'))}>
                <Icon name="x" size={13} /> Dismiss without saving anything
              </button>
            )}
          </div>
          {showSteps && (
            <ol className="small" style={{ margin: 0, paddingLeft: 20 }}>
              {summary.steps.map((step) => (
                <li key={step.step}>
                  {step.name} — <span className="muted">{step.status}{step.note ? `: ${step.note}` : ''}</span>
                </li>
              ))}
            </ol>
          )}
        </div>
      </Card>

      {grouped.map((group) => (
        <Card key={group.kind} title={`${KIND_LABELS[group.kind]} (${group.items.length})`} icon={group.kind === 'risk-mention' ? 'alert' : 'clipboard'}>
          <div className="stack-sm">
            {group.items.map((item) => (
              <div key={item.id} className="soft" style={{ display: 'block', padding: 12 }}>
                <div className="cluster" style={{ gap: 6 }}>
                  {item.riskRelated && <Badge tone="red" icon="alert">Risk-sensitive — individual review</Badge>}
                  {item.requiresIndividualReview && !item.riskRelated && (
                    <Badge tone="amber" icon="alert">Individual review required</Badge>
                  )}
                  {item.extractionLabel && <Badge tone="blue" icon="info">{item.extractionLabel.replace(/-/g, ' ')}</Badge>}
                  {item.confidence && <ConfidenceLevelBadge level={item.confidence} />}
                  {item.decision && (
                    <Badge
                      tone={item.decision === 'rejected' || item.decision === 'not-saved' ? 'neutral' : 'green'}
                      icon={item.decision === 'rejected' || item.decision === 'not-saved' ? 'x' : 'check'}
                    >
                      {item.decision.replace(/-/g, ' ')}
                    </Badge>
                  )}
                </div>
                <p className="small" style={{ margin: '6px 0', fontWeight: 600 }}>{item.title}</p>
                <p className="muted small prewrap" style={{ margin: '0 0 6px' }}>{item.detail}</p>
                {item.suggestedQuestion && (
                  <p className="muted small" style={{ margin: '0 0 6px' }}>Suggested question: {item.suggestedQuestion}</p>
                )}
                <EvidenceDrawer sources={item.sources} clientId={client.id} label="Exact evidence" />

                {itemError[item.id] && (
                  <div className="notice notice--danger" role="alert">
                    <Icon name="alert" size={15} />
                    <span className="small">{itemError[item.id]}</span>
                  </div>
                )}

                {!item.decision && (
                  <div className="stack-sm" style={{ marginTop: 8 }}>
                    {item.riskRelated && (
                      <input
                        className="input"
                        placeholder="Clinical note for this risk item (recorded with your review)"
                        value={riskNote}
                        onChange={(e) => setRiskNote(e.target.value)}
                      />
                    )}
                    <div className="cluster" style={{ flexWrap: 'wrap', gap: 6 }}>
                      {(item.factPayload || item.hypothesisPayload) && (
                        <>
                          <button className="btn btn--primary btn--sm" onClick={() => void decide(item, 'approve')}>
                            <Icon name="check" size={13} /> Approve
                          </button>
                          <button
                            className="btn btn--secondary btn--sm"
                            onClick={() => {
                              setEditing(item);
                              setEditedText(item.title);
                            }}
                          >
                            <Icon name="edit" size={13} /> Edit and approve
                          </button>
                        </>
                      )}
                      {item.factPayload && (
                        <button className="btn btn--secondary btn--sm" onClick={() => void decide(item, 'save-as-hypothesis')}>
                          <Icon name="search" size={13} /> Save as hypothesis
                        </button>
                      )}
                      <button className="btn btn--secondary btn--sm" onClick={() => void decide(item, 'needs-further-assessment')}>
                        <Icon name="info" size={13} /> Mark needs further assessment
                      </button>
                      {(item.factPayload || item.hypothesisPayload) && (
                        <button className="btn btn--danger btn--sm" onClick={() => void decide(item, 'reject')}>
                          <Icon name="x" size={13} /> Reject
                        </button>
                      )}
                      <button className="btn btn--ghost btn--sm" onClick={() => void decide(item, 'do-not-save')}>
                        Do not save
                      </button>
                    </div>
                    <input
                      className="input"
                      placeholder="Add clinician comment (optional, saved with your decision)"
                      value={comment[item.id] ?? ''}
                      onChange={(e) => setComment((prev) => ({ ...prev, [item.id]: e.target.value }))}
                    />
                  </div>
                )}
              </div>
            ))}
          </div>
        </Card>
      ))}

      <FeedbackBar clientId={client.id} targetType="update-summary" targetId={summary.id} operationId={summary.generation.operationId} />

      {editing && (
        <Modal title="Edit and approve" subtitle="Your edited wording is saved; the AI proposal and your correction are both versioned." onClose={() => setEditing(undefined)}>
          <div className="stack-sm">
            <textarea className="textarea" style={{ minHeight: 80 }} value={editedText} onChange={(e) => setEditedText(e.target.value)} />
            <div className="cluster">
              <button
                className="btn btn--primary"
                disabled={!editedText.trim()}
                onClick={() => void decide(editing, 'edit-approve', editedText.trim())}
              >
                <Icon name="check" size={14} /> Save edited version
              </button>
              <button className="btn btn--secondary" onClick={() => setEditing(undefined)}>Cancel</button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
