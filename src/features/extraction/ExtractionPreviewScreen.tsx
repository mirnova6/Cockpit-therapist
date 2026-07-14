import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useOutletContext, useParams } from 'react-router-dom';
import { Icon } from '../../app/components/Icon';
import {
  ClassificationBadge,
  ConfidenceBadge,
  RiskFlagBadge,
} from '../../app/components/clinicalBadges';
import { Badge, Card, EmptyState, Field } from '../../app/components/ui';
import { getDefinition } from '../../core/assessments/definitions';
import { inputTypeLabel } from '../../core/db/schema';
import {
  FACT_CATEGORIES,
  factCategoryMeta,
  type FactCategory,
} from '../../core/db/structuredSchema';
import { DEFAULT_PROVIDER_ID, getProvider } from '../../core/extraction/registry';
import type { ProposedItem } from '../../core/extraction/types';
import { fmtDate, todayIsoDate } from '../../lib/format';
import { useDataStore } from '../../state/dataStore';
import { useStructuredStore } from '../../state/structuredStore';
import type { ClientContext } from '../dashboard/ClientDashboardLayout';

type Decision = 'approved' | 'rejected' | 'needs-clarification';

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

  const input = inputs.find((i) => i.id === inputId);
  const provider = getProvider(DEFAULT_PROVIDER_ID)!;
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

  const runExtraction = () => {
    if (!input) return;
    const result = provider.extract(input);
    // Don't re-propose items the clinician has already decided on.
    const existingStatements = new Set(existingFromInput.map((f) => f.statement));
    const existingScores = new Set(existingAssessments.map((a) => `${a.definitionKey}:${a.totalScore}`));
    const fresh = result.items.filter((item) =>
      item.kind === 'fact'
        ? !existingStatements.has(item.statement)
        : !existingScores.has(`${item.definitionKey}:${item.totalScore}`),
    );
    setProposals(fresh.map((item) => ({ item })));
    setRan(true);
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
          extractionMethod: 'rule-based',
          extractionConfidence: item.confidence,
          temporalStatus: 'current',
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
        } else {
          await decideFact(fact.id, client.id, 'needs-clarification');
        }
      } else {
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
      }
      update(index, { decision, saving: false });
    } catch (err) {
      update(index, { saving: false, error: err instanceof Error ? err.message : 'Could not save.' });
    }
  };

  const approveAllSafe = async () => {
    for (let i = 0; i < proposals.length; i++) {
      const p = proposals[i];
      const isRisk = p.item.kind === 'fact' && p.item.riskRelated;
      if (!p.decision && !isRisk) {
        await saveDecision(i, 'approved');
      }
    }
  };

  const undecided = proposals.filter((p) => !p.decision);
  const undecidedSafe = undecided.filter((p) => !(p.item.kind === 'fact' && p.item.riskRelated));
  const riskCount = proposals.filter((p) => p.item.kind === 'fact' && p.item.riskRelated).length;

  return (
    <div className="stack" style={{ maxWidth: 900 }}>
      <div className="spread">
        <button className="btn btn--ghost btn--sm" onClick={() => navigate(`../inputs/${input.id}`)}>
          <Icon name="chevron-left" size={15} /> Back to entry
        </button>
        <Badge tone="plum" icon="list">{provider.label}</Badge>
      </div>

      <Card title={`Extract structured information — ${inputTypeLabel(input.inputType)}`} icon="list">
        <div className="stack-sm">
          <p className="muted small">
            Source: {inputTypeLabel(input.inputType)} dated {fmtDate(input.dateOfInformation)} (v{input.version}).
            The raw entry is never modified — approved items become structured facts linked back to it.
          </p>
          <div className="notice notice--info">
            <Icon name="info" size={18} />
            <span className="small">{provider.capabilityNote}</span>
          </div>
          {(existingFromInput.length > 0 || existingAssessments.length > 0) && (
            <p className="muted small">
              Already processed from this entry: {existingFromInput.length} fact{existingFromInput.length === 1 ? '' : 's'}
              {existingAssessments.length > 0 && `, ${existingAssessments.length} assessment score(s)`} — these are not re-proposed.
            </p>
          )}
          {!ran && (
            <button className="btn btn--primary" style={{ alignSelf: 'flex-start' }} onClick={runExtraction}>
              <Icon name="search" size={15} /> Run extraction preview
            </button>
          )}
        </div>
      </Card>

      {ran && proposals.length === 0 && (
        <Card>
          <EmptyState icon="search" title="No new structured items detected">
            <p className="small">
              The deterministic rules found nothing new to propose. You can still{' '}
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
              {riskCount > 0 && (
                <span style={{ color: 'var(--red)', fontWeight: 600 }}>
                  {' '}· {riskCount} risk item{riskCount === 1 ? '' : 's'} require individual review
                </span>
              )}
            </p>
            <button
              className="btn btn--secondary btn--sm"
              disabled={undecidedSafe.length === 0}
              onClick={() => void approveAllSafe()}
            >
              <Icon name="check" size={14} /> Approve all non-risk ({undecidedSafe.length})
            </button>
          </div>

          {proposals.map((proposal, index) => {
            const { item } = proposal;
            const isRiskFact = item.kind === 'fact' && item.riskRelated;
            return (
              <Card key={index} className={proposal.decision ? '' : isRiskFact ? '' : ''}>
                <div className="stack-sm">
                  <div className="cluster">
                    {item.kind === 'fact' ? (
                      <>
                        <Badge tone="blue" icon="clipboard">
                          {FACT_CATEGORIES.find((c) => c.value === (proposal.editedCategory ?? item.category))?.label}
                        </Badge>
                        <ClassificationBadge value={item.classification} />
                      </>
                    ) : (
                      <Badge tone="green" icon="activity">
                        Assessment score detected: {item.name} = {item.totalScore}
                      </Badge>
                    )}
                    <ConfidenceBadge confidence={item.confidence} />
                    {isRiskFact && <RiskFlagBadge />}
                    {proposal.decision && (
                      <Badge
                        tone={proposal.decision === 'approved' ? 'green' : proposal.decision === 'rejected' ? 'red' : 'plum'}
                        icon={proposal.decision === 'approved' ? 'check' : proposal.decision === 'rejected' ? 'x' : 'info'}
                      >
                        {proposal.decision === 'approved' ? 'Approved' : proposal.decision === 'rejected' ? 'Rejected' : 'Needs clarification'}
                      </Badge>
                    )}
                  </div>

                  {item.kind === 'fact' && proposal.decision === undefined ? (
                    <>
                      <Field label="Proposed statement (editable)">
                        <textarea
                          className="textarea"
                          style={{ minHeight: 56 }}
                          value={proposal.editedStatement ?? item.statement}
                          onChange={(e) => update(index, { editedStatement: e.target.value })}
                        />
                      </Field>
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
                    </>
                  ) : item.kind === 'fact' ? (
                    <p className="soft small prewrap">{proposal.editedStatement ?? item.statement}</p>
                  ) : (
                    <p className="soft small">
                      Will record {item.name} = {item.totalScore} on {fmtDate(input.sessionDate ?? input.dateOfInformation)}
                      {getDefinition(item.definitionKey)?.interpret ? ' with encoded-rule interpretation.' : ' (no interpretation rules configured).'}
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
                )}.
              </span>
            </div>
          )}
        </>
      )}
    </div>
  );
}
