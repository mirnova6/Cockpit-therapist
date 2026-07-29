import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useOutletContext, useParams } from 'react-router-dom';
import { Icon } from '../../app/components/Icon';
import {
  ClassificationBadge,
  ConfidenceBadge,
  RiskFlagBadge,
} from '../../app/components/clinicalBadges';
import { Badge, Card, EmptyState, Field } from '../../app/components/ui';
import { extractionLabelText } from '../../core/ai/aiSchema';
import { ConsentRefusedError } from '../../core/ai/aiGateway';
import { REDACTION_DISCLAIMER, redactText } from '../../core/ai/redaction';
import { computeRiskFlags, getDefinition } from '../../core/assessments/definitions';
import { inputTypeLabel } from '../../core/db/schema';
import {
  FACT_CATEGORIES,
  bulkApprovalIneligibilityReason,
  factCategoryMeta,
  type FactCategory,
} from '../../core/db/structuredSchema';
import {
  AI_EXTRACTION_PROVIDER_ID,
  DEFAULT_PROVIDER_ID,
  getProvider,
  listProviders,
} from '../../core/extraction/registry';
import type { ProposedItem } from '../../core/extraction/types';
import { fmtDate, todayIsoDate } from '../../lib/format';
import { useAiStore } from '../../state/aiStore';
import { useDataStore } from '../../state/dataStore';
import { useStructuredStore } from '../../state/structuredStore';
import type { ClientContext } from '../dashboard/ClientDashboardLayout';

type Decision = 'approved' | 'rejected' | 'needs-clarification' | 'saved-hypothesis';

interface ProposalState {
  item: ProposedItem;
  decision?: Decision;
  editedStatement?: string;
  editedCategory?: FactCategory;
  dispositionNote?: string; // for risk items / risk-flagged scores
  saving?: boolean;
  error?: string;
}

export function ExtractionPreviewScreen() {
  const { client } = useOutletContext<ClientContext>();
  const { inputId } = useParams<{ inputId: string }>();
  const navigate = useNavigate();
  const inputs = useDataStore((s) => s.inputs[client.id]) ?? [];
  const structured = useStructuredStore((s) => s.byClient[client.id]);
  const loadClient = useStructuredStore((s) => s.loadClient);
  const createFact = useStructuredStore((s) => s.createFact);
  const decideFact = useStructuredStore((s) => s.decideFact);
  const createAssessment = useStructuredStore((s) => s.createAssessment);
  const createHypothesis = useStructuredStore((s) => s.createHypothesis);
  const aiSettings = useAiStore((s) => s.settings);
  const activeReady = useAiStore((s) => s.activeReady);
  const setOnlineConfirmed = useAiStore((s) => s.setOnlineConfirmed);

  const input = inputs.find((i) => i.id === inputId);
  const availableProviders = listProviders();
  const aiAvailable = availableProviders.some((p) => p.id === AI_EXTRACTION_PROVIDER_ID) && activeReady;
  const [providerId, setProviderId] = useState(DEFAULT_PROVIDER_ID);
  const provider = getProvider(providerId) ?? getProvider(DEFAULT_PROVIDER_ID)!;
  const isAiRun = providerId === AI_EXTRACTION_PROVIDER_ID;
  const isOnline = isAiRun && aiSettings.activeProviderType === 'online';
  const [outboundConfirmed, setOutboundConfirmed] = useState(false);
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<string>();
  const [providerLabelUsed, setProviderLabelUsed] = useState<string>();

  const [proposals, setProposals] = useState<ProposalState[]>([]);
  const [ran, setRan] = useState(false);

  useEffect(() => {
    void loadClient(client.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client.id]);

  const existingFromInput = useMemo(
    () => (structured?.facts ?? []).filter((f) => f.sourceInputId === inputId),
    [structured, inputId],
  );
  const existingAssessments = useMemo(
    () => (structured?.assessments ?? []).filter((a) => a.sourceInputId === inputId),
    [structured, inputId],
  );

  const redactionPreview = useMemo(() => {
    if (!input || !isOnline || !aiSettings.redactBeforeSend) return undefined;
    return redactText(input.rawText, {
      knownNames: [client.displayName, client.preferredIdentifier ?? ''].filter(Boolean),
    });
  }, [input, isOnline, aiSettings.redactBeforeSend, client.displayName, client.preferredIdentifier]);

  const runExtraction = async () => {
    if (!input || running) return;
    setRunning(true);
    setRunError(undefined);
    if (isOnline) setOnlineConfirmed(outboundConfirmed);
    try {
      const result = await provider.extract(input);
      setProviderLabelUsed(result.providerLabel);
      // Don't re-propose items the clinician has already decided on.
      const existingStatements = new Set(existingFromInput.map((f) => f.statement));
      const existingScores = new Set(existingAssessments.map((a) => `${a.definitionKey}:${a.totalScore}`));
      const fresh = result.items.filter((item) =>
        item.kind === 'fact'
          ? !existingStatements.has(item.statement)
          : item.kind === 'assessment-score'
            ? !existingScores.has(`${item.definitionKey}:${item.totalScore}`)
            : true,
      );
      setProposals(fresh.map((item) => ({ item })));
      setRan(true);
    } catch (err) {
      setRunError(
        err instanceof ConsentRefusedError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'Extraction failed.',
      );
    } finally {
      setOnlineConfirmed(false);
      setRunning(false);
    }
  };

  if (!input) {
    return (
      <Card>
        <EmptyState icon="file" title="Input not found">
          <button className="btn btn--secondary" onClick={() => navigate('../inputs')}>Back to inputs</button>
        </EmptyState>
      </Card>
    );
  }

  const update = (index: number, patch: Partial<ProposalState>) =>
    setProposals((prev) => prev.map((p, i) => (i === index ? { ...p, ...patch } : p)));

  const saveDecision = async (index: number, decision: Decision) => {
    const proposal = proposals[index];
    const { item } = proposal;
    update(index, { saving: true, error: undefined });
    try {
      if (item.kind === 'fact') {
        const isEdited = Boolean(
          (proposal.editedStatement && proposal.editedStatement !== item.statement) ||
            (proposal.editedCategory && proposal.editedCategory !== item.category),
        );
        const fact = await createFact({
          clientId: client.id,
          sourceInputId: input.id,
          sourceInputVersion: input.version,
          category: proposal.editedCategory ?? item.category,
          statement: (proposal.editedStatement ?? item.statement).trim(),
          excerpt: item.excerpt,
          sourceLocation: item.sourceLocation,
          dateOccurred: item.dateOccurred,
          dateRecorded: todayIsoDate(),
          classification: item.classification,
          extractionMethod: isAiRun ? 'ai-provider' : 'rule-based',
          extractionConfidence: item.confidence,
          temporalStatus: item.temporalStatus ?? 'current',
          riskRelated: item.riskRelated || Boolean(factCategoryMeta(proposal.editedCategory ?? item.category).riskByDefault),
        });
        if (decision === 'approved') {
          await decideFact(fact.id, client.id, 'approve', {
            asEdited: isEdited,
            correction: isEdited ? 'Edited during extraction review' : undefined,
            note: item.riskRelated ? proposal.dispositionNote : undefined,
          });
        } else if (decision === 'rejected') {
          await decideFact(fact.id, client.id, 'reject');
        } else if (decision === 'needs-clarification') {
          await decideFact(fact.id, client.id, 'needs-clarification');
        }
      } else if (item.kind === 'assessment-score') {
        if (decision === 'approved') {
          await createAssessment({
            clientId: client.id,
            definitionKey: item.definitionKey,
            name: item.name,
            dateAdministered: input.sessionDate ?? input.dateOfInformation,
            totalScore: item.totalScore,
            sourceInputId: input.id,
            clinicianNotes: `Extracted from ${inputTypeLabel(input.inputType)} (${item.sourceLocation ?? 'text'}); approved in extraction review.`,
          });
        }
        // Rejected/deferred proposed scores are simply not recorded.
      } else {
        // Hypothesis proposals can ONLY become hypotheses — pending review.
        if (decision === 'saved-hypothesis') {
          await createHypothesis(
            {
              clientId: client.id,
              category: item.category,
              statement: (proposal.editedStatement ?? item.statement).trim(),
              confidence: 'insufficient-evidence',
              alternativeExplanations: item.alternativeExplanations,
              missingInformation: [],
              questionsToAssess: item.questionsToAssess,
            },
            { reviewStatus: 'pending' },
          );
        }
        // Rejected hypothesis proposals are simply discarded.
      }
      update(index, { decision, saving: false });
    } catch (err) {
      update(index, { saving: false, error: err instanceof Error ? err.message : 'Could not save.' });
    }
  };

  /**
   * Why a proposal is excluded from bulk approval (medication, diagnosis,
   * risk content, flagged assessments, hypotheses), or null when eligible.
   * Mirrors the policy the service layer enforces independently.
   */
  const individualReviewReason = (proposal: ProposalState): string | null => {
    const { item } = proposal;
    if (item.kind === 'fact') {
      return bulkApprovalIneligibilityReason({
        category: proposal.editedCategory ?? item.category,
        riskRelated: item.riskRelated,
        reviewStatus: 'pending',
      });
    }
    if (item.kind === 'hypothesis') {
      return 'Hypotheses are interpretations and always require individual review';
    }
    const flags = computeRiskFlags({ definitionKey: item.definitionKey, totalScore: item.totalScore });
    return flags.length > 0 ? 'Risk-flagged assessments require individual review' : null;
  };

  const approveAllEligible = async () => {
    for (let i = 0; i < proposals.length; i++) {
      const p = proposals[i];
      if (!p.decision && individualReviewReason(p) === null) {
        await saveDecision(i, 'approved');
      }
    }
  };

  const undecided = proposals.filter((p) => !p.decision);
  const undecidedEligible = undecided.filter((p) => individualReviewReason(p) === null);
  const individualCount = proposals.filter((p) => individualReviewReason(p) !== null).length;

  return (
    <div className="stack" style={{ maxWidth: 900 }}>
      <div className="spread">
        <button className="btn btn--ghost btn--sm" onClick={() => navigate(`../inputs/${input.id}`)}>
          <Icon name="chevron-left" size={15} /> Back to entry
        </button>
        <Badge tone="plum" icon="list">{providerLabelUsed ?? provider.label}</Badge>
      </div>

      <Card title={`Extract structured information — ${inputTypeLabel(input.inputType)}`} icon="list">
        <div className="stack-sm">
          <p className="muted small">
            Source: {inputTypeLabel(input.inputType)} dated {fmtDate(input.dateOfInformation)} (v{input.version}).
            The raw entry is never modified — approved items become structured facts linked back to it.
          </p>

          {availableProviders.length > 1 && (
            <Field label="Extraction method">
              <select
                className="select"
                style={{ width: 'auto' }}
                value={providerId}
                onChange={(e) => {
                  setProviderId(e.target.value);
                  setOutboundConfirmed(false);
                }}
              >
                {availableProviders.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.id === AI_EXTRACTION_PROVIDER_ID
                      ? `${p.label} — ${aiSettings.activeProviderType === 'online' ? 'online (leaves this device)' : 'local model'}`
                      : `${p.label} (deterministic, on-device)`}
                  </option>
                ))}
              </select>
            </Field>
          )}
          {!aiAvailable && (
            <p className="muted small" style={{ margin: 0 }}>
              No AI model is connected — configure one under Workspace settings → AI processing to add AI extraction here.
            </p>
          )}

          <div className="notice notice--info">
            <Icon name="info" size={18} />
            <span className="small">{provider.capabilityNote}</span>
          </div>

          {isAiRun && !input.allowAiAnalysis && (
            <div className="notice notice--danger" role="alert">
              <Icon name="alert" size={18} />
              <span className="small">
                This entry was saved without AI-analysis consent. AI extraction will be refused — use the
                deterministic method, or update the consent flag on the entry first.
              </span>
            </div>
          )}

          {isOnline && (
            <div className="notice notice--warn" style={{ display: 'block' }}>
              <strong className="small">
                <Icon name="shield" size={14} /> This will send content to {aiSettings.onlineModel} (Anthropic) over HTTPS.
              </strong>
              <p className="small" style={{ margin: '6px 0' }}>
                Business Associate Agreement attested: {aiSettings.baaConfirmed ? 'yes (per your AI settings)' : 'NO'}.
                Exactly the following text leaves this device{aiSettings.redactBeforeSend ? ' after redaction' : ''}:
              </p>
              {aiSettings.redactBeforeSend && (
                <p className="small muted" style={{ margin: '6px 0' }}>{REDACTION_DISCLAIMER}</p>
              )}
              <div className="soft small prewrap" style={{ maxHeight: 200, overflowY: 'auto' }}>
                {redactionPreview ? redactionPreview.text : input.rawText}
              </div>
              {redactionPreview && redactionPreview.replacements.length > 0 && (
                <p className="small muted" style={{ margin: '6px 0 0' }}>
                  Redacted: {redactionPreview.replacements.map((r) => `${r.kind} ×${r.count}`).join(', ')}
                </p>
              )}
              <label className="cluster small" style={{ marginTop: 8, gap: 8 }}>
                <input
                  type="checkbox"
                  checked={outboundConfirmed}
                  onChange={(e) => setOutboundConfirmed(e.target.checked)}
                />
                I reviewed the text above and confirm it may be sent to the configured online provider.
              </label>
            </div>
          )}

          {(existingFromInput.length > 0 || existingAssessments.length > 0) && (
            <p className="muted small">
              Already processed from this entry: {existingFromInput.length} fact{existingFromInput.length === 1 ? '' : 's'}
              {existingAssessments.length > 0 && `, ${existingAssessments.length} assessment score(s)`} — these are not re-proposed.
            </p>
          )}

          {runError && (
            <div className="notice notice--danger" role="alert">
              <Icon name="alert" size={15} />
              <span className="small">{runError}</span>
            </div>
          )}

          {!ran && (
            <button
              className="btn btn--primary"
              style={{ alignSelf: 'flex-start' }}
              disabled={running || (isOnline && !outboundConfirmed)}
              onClick={() => void runExtraction()}
            >
              <Icon name="search" size={15} /> {running ? 'Analyzing…' : 'Run extraction preview'}
            </button>
          )}
        </div>
      </Card>

      {ran && proposals.length === 0 && (
        <Card>
          <EmptyState icon="search" title="No new structured items detected">
            <p className="small">
              {isAiRun ? 'The model' : 'The deterministic rules'} found nothing new to propose. You can still{' '}
              <Link to="../profile">add facts manually</Link> from the Structured Profile tab.
            </p>
          </EmptyState>
        </Card>
      )}

      {ran && proposals.length > 0 && (
        <>
          <div className="spread">
            <p className="muted small">
              {proposals.length} proposal{proposals.length === 1 ? '' : 's'} · {undecided.length} undecided
              {individualCount > 0 && (
                <span style={{ color: 'var(--red)', fontWeight: 600 }}>
                  {' '}· {individualCount} item{individualCount === 1 ? ' requires' : 's require'} individual review
                </span>
              )}
            </p>
            <button
              className="btn btn--secondary btn--sm"
              disabled={undecidedEligible.length === 0}
              onClick={() => void approveAllEligible()}
              title="Medication, diagnosis, risk-related, flagged, and hypothesis items are excluded and must be reviewed one by one."
            >
              <Icon name="check" size={14} /> Approve eligible low-risk items ({undecidedEligible.length})
            </button>
          </div>

          {proposals.map((proposal, index) => {
            const { item } = proposal;
            const isRiskFact = item.kind === 'fact' && item.riskRelated;
            const isHypothesis = item.kind === 'hypothesis';
            const reviewReason = individualReviewReason(proposal);
            return (
              <Card key={index}>
                <div className="stack-sm">
                  <div className="cluster">
                    {item.kind === 'fact' ? (
                      <>
                        <Badge tone="blue" icon="clipboard">
                          {FACT_CATEGORIES.find((c) => c.value === (proposal.editedCategory ?? item.category))?.label}
                        </Badge>
                        <ClassificationBadge value={item.classification} />
                        {item.extractionLabel && (
                          <Badge tone={item.explicit ? 'green' : 'amber'} icon={item.explicit ? 'check' : 'info'}>
                            {extractionLabelText(item.extractionLabel)}
                          </Badge>
                        )}
                      </>
                    ) : item.kind === 'assessment-score' ? (
                      <Badge tone="green" icon="activity">
                        Assessment score detected: {item.name} = {item.totalScore}
                      </Badge>
                    ) : (
                      <Badge tone="plum" icon="search">
                        Hypothesis — interpretation, not fact
                      </Badge>
                    )}
                    {'confidence' in item && item.kind !== 'hypothesis' && (
                      <ConfidenceBadge confidence={item.confidence} />
                    )}
                    {isRiskFact && <RiskFlagBadge />}
                    {reviewReason && !proposal.decision && (
                      <Badge tone="amber" icon="alert">Individual review required</Badge>
                    )}
                    {proposal.decision && (
                      <Badge
                        tone={
                          proposal.decision === 'approved' || proposal.decision === 'saved-hypothesis'
                            ? 'green'
                            : proposal.decision === 'rejected'
                              ? 'red'
                              : 'plum'
                        }
                        icon={
                          proposal.decision === 'approved' || proposal.decision === 'saved-hypothesis'
                            ? 'check'
                            : proposal.decision === 'rejected'
                              ? 'x'
                              : 'info'
                        }
                      >
                        {proposal.decision === 'approved'
                          ? 'Approved'
                          : proposal.decision === 'saved-hypothesis'
                            ? 'Saved as pending hypothesis'
                            : proposal.decision === 'rejected'
                              ? 'Rejected'
                              : 'Needs clarification'}
                      </Badge>
                    )}
                  </div>

                  {reviewReason && !proposal.decision && (
                    <p className="muted small" style={{ margin: 0 }}>
                      {reviewReason} — excluded from “Approve eligible low-risk items”.
                    </p>
                  )}

                  {item.kind === 'fact' && item.possibleContradiction && (
                    <div className="notice notice--warn">
                      <Icon name="alert" size={15} />
                      <span className="small">Possible contradiction: {item.possibleContradiction}</span>
                    </div>
                  )}

                  {(item.kind === 'fact' || isHypothesis) && proposal.decision === undefined ? (
                    <>
                      <Field label={isHypothesis ? 'Proposed hypothesis (editable)' : 'Proposed statement (editable)'}>
                        <textarea
                          className="textarea"
                          style={{ minHeight: 56 }}
                          value={proposal.editedStatement ?? item.statement}
                          onChange={(e) => update(index, { editedStatement: e.target.value })}
                        />
                      </Field>
                      {item.kind === 'fact' && (
                        <div className="cluster">
                          <select
                            className="select"
                            style={{ width: 'auto' }}
                            value={proposal.editedCategory ?? item.category}
                            onChange={(e) => update(index, { editedCategory: e.target.value as FactCategory })}
                            aria-label="Category"
                          >
                            {FACT_CATEGORIES.map((c) => (
                              <option key={c.value} value={c.value}>{c.label}</option>
                            ))}
                          </select>
                        </div>
                      )}
                    </>
                  ) : item.kind === 'fact' || isHypothesis ? (
                    <p className="soft small prewrap">{proposal.editedStatement ?? item.statement}</p>
                  ) : (
                    <p className="soft small">
                      Will record {item.name} = {item.totalScore} on {fmtDate(input.sessionDate ?? input.dateOfInformation)}
                      {getDefinition(item.definitionKey)?.interpret ? ' with encoded-rule interpretation.' : ' (no interpretation rules configured).'}
                    </p>
                  )}

                  {isHypothesis && item.questionsToAssess.length > 0 && (
                    <p className="muted small" style={{ margin: 0 }}>
                      Questions to assess: {item.questionsToAssess.join(' · ')}
                    </p>
                  )}
                  {item.kind === 'fact' && item.suggestedQuestion && (
                    <p className="muted small" style={{ margin: 0 }}>
                      Suggested clarification: {item.suggestedQuestion}
                    </p>
                  )}

                  <div className="notice notice--info" style={{ display: 'block' }}>
                    <strong className="small">Exact evidence{item.sourceLocation ? ` (${item.sourceLocation})` : ''}:</strong>
                    <span className="small prewrap" style={{ display: 'block' }}>“{item.excerpt}”</span>
                  </div>

                  {isRiskFact && !proposal.decision && (
                    <Field label="Clinical note for this risk item (recorded with your review)">
                      <input
                        className="input"
                        value={proposal.dispositionNote ?? ''}
                        onChange={(e) => update(index, { dispositionNote: e.target.value })}
                        placeholder="e.g. discussed in session; risk assessment updated"
                      />
                    </Field>
                  )}

                  {proposal.error && (
                    <div className="notice notice--danger" role="alert">
                      <Icon name="alert" size={15} />
                      <span className="small">{proposal.error}</span>
                    </div>
                  )}

                  {!proposal.decision && (
                    <div className="cluster">
                      {isHypothesis ? (
                        <>
                          <button className="btn btn--primary btn--sm" disabled={proposal.saving} onClick={() => void saveDecision(index, 'saved-hypothesis')}>
                            <Icon name="check" size={13} /> Save as hypothesis (pending review)
                          </button>
                          <button className="btn btn--danger btn--sm" disabled={proposal.saving} onClick={() => void saveDecision(index, 'rejected')}>
                            <Icon name="x" size={13} /> Discard
                          </button>
                        </>
                      ) : (
                        <>
                          <button className="btn btn--primary btn--sm" disabled={proposal.saving} onClick={() => void saveDecision(index, 'approved')}>
                            <Icon name="check" size={13} /> {proposal.editedStatement || proposal.editedCategory ? 'Approve edited' : 'Approve'}
                          </button>
                          <button className="btn btn--danger btn--sm" disabled={proposal.saving} onClick={() => void saveDecision(index, 'rejected')}>
                            <Icon name="x" size={13} /> Reject
                          </button>
                          {item.kind === 'fact' && (
                            <button className="btn btn--secondary btn--sm" disabled={proposal.saving} onClick={() => void saveDecision(index, 'needs-clarification')}>
                              <Icon name="info" size={13} /> Needs clarification
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  )}
                </div>
              </Card>
            );
          })}

          {undecided.length === 0 && (
            <div className="notice notice--info">
              <Icon name="check" size={18} />
              <span className="small">
                All proposals reviewed. Approved items are now in the{' '}
                <Link to="../profile">Structured Profile</Link>
                {proposals.some((p) => p.item.kind === 'assessment-score' && p.decision === 'approved') && (
                  <> and <Link to="../assessments">Assessments</Link></>
                )}
                {proposals.some((p) => p.decision === 'saved-hypothesis') && (
                  <>; saved hypotheses await review under <Link to="../hypotheses">Hypotheses</Link></>
                )}.
              </span>
            </div>
          )}
        </>
      )}
    </div>
  );
}
