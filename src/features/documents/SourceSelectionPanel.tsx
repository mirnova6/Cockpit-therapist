import { useEffect, useMemo } from 'react';
import { Icon } from '../../app/components/Icon';
import { Badge, Card, Field } from '../../app/components/ui';
import { RiskFlagBadge } from '../../app/components/clinicalBadges';
import { DAP_STYLES, type SourceSelection } from '../../core/db/documentSchema';
import { inputTypeLabel } from '../../core/db/schema';
import { APPROVED_STATUSES } from '../../core/db/structuredSchema';
import { fmtDate } from '../../lib/format';
import { useDataStore } from '../../state/dataStore';
import { useDocumentsStore } from '../../state/documentsStore';
import { useStructuredStore } from '../../state/structuredStore';

/**
 * Source selection for document generation. Defaults to approved
 * information only; pending items require explicit opt-in with a warning;
 * rejected items are never shown as selectable; risk-related items require
 * the explicit confirmation checkbox (also enforced in the service layer).
 */
export function SourceSelectionPanel({
  clientId,
  docType,
  selection,
  onChange,
}: {
  clientId: string;
  docType: 'dap-note' | 'treatment-plan';
  selection: SourceSelection;
  onChange: (next: SourceSelection) => void;
}) {
  const inputs = useDataStore((s) => s.inputs[clientId]) ?? [];
  const structured = useStructuredStore((s) => s.byClient[clientId]);
  const docs = useDocumentsStore((s) => s.byClient[clientId]);
  const loadStructured = useStructuredStore((s) => s.loadClient);
  const loadDocs = useDocumentsStore((s) => s.loadClient);

  useEffect(() => {
    void loadStructured(clientId);
    void loadDocs(clientId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);

  const approvedFacts = useMemo(
    () => (structured?.facts ?? []).filter((f) => APPROVED_STATUSES.includes(f.reviewStatus)),
    [structured],
  );
  const pendingFacts = useMemo(
    () => (structured?.facts ?? []).filter((f) => f.reviewStatus === 'pending' || f.reviewStatus === 'needs-clarification'),
    [structured],
  );
  const assessments = (structured?.assessments ?? []).filter((a) => a.reviewStatus !== 'rejected');
  const hypotheses = (structured?.hypotheses ?? []).filter((h) => h.lifecycleStatus === 'active');
  const goals = docs?.goals ?? [];

  const toggle = (key: keyof Pick<SourceSelection, 'inputIds' | 'factIds' | 'assessmentIds' | 'hypothesisIds' | 'goalIds' | 'explicitlyIncludedPendingFactIds'>, id: string) => {
    const list = selection[key];
    onChange({
      ...selection,
      [key]: list.includes(id) ? list.filter((x) => x !== id) : [...list, id],
    });
  };

  const riskSelected =
    selection.includeRiskStatus ||
    inputs.some((i) => selection.inputIds.includes(i.id) && i.containsRisk) ||
    approvedFacts.some((f) => selection.factIds.includes(f.id) && f.riskRelated) ||
    assessments.some((a) => selection.assessmentIds.includes(a.id) && a.riskFlags.length > 0);

  const pendingSelected = selection.explicitlyIncludedPendingFactIds.length > 0;

  return (
    <div className="stack">
      <Card title="Style & instructions" icon="edit">
        <div className="form-grid">
          <Field label="Document style" hint="Styles adjust organization and emphasis — never the underlying facts.">
            <select
              className="select"
              value={selection.style}
              onChange={(e) => onChange({ ...selection, style: e.target.value as SourceSelection['style'] })}
            >
              {DAP_STYLES.map((s) => (
                <option key={s.value} value={s.value}>{s.label} — {s.note}</option>
              ))}
            </select>
          </Field>
          <Field label="Therapist instructions (optional)" hint="Included verbatim as therapist-authored content.">
            <input
              className="input"
              value={selection.therapistInstructions ?? ''}
              onChange={(e) => onChange({ ...selection, therapistInstructions: e.target.value })}
              placeholder="e.g. Next session: review sleep log"
            />
          </Field>
        </div>
      </Card>

      <Card title={`Raw clinical inputs (${selection.inputIds.length} selected)`} icon="file">
        {inputs.length === 0 ? (
          <p className="muted small">No clinical inputs recorded.</p>
        ) : (
          <div className="stack-sm">
            {inputs.slice(0, 30).map((input) => (
              <label key={input.id} className="checkbox-row" style={{ padding: '8px 12px' }}>
                <input
                  type="checkbox"
                  checked={selection.inputIds.includes(input.id)}
                  onChange={() => toggle('inputIds', input.id)}
                />
                <span className="small">
                  <strong>{inputTypeLabel(input.inputType)}</strong> · {fmtDate(input.dateOfInformation)}
                  {input.containsRisk && <> <RiskFlagBadge label="Risk-flagged" /></>}
                  <span className="muted" style={{ display: 'block' }}>
                    {input.rawText.slice(0, 110)}{input.rawText.length > 110 ? '…' : ''}
                  </span>
                </span>
              </label>
            ))}
          </div>
        )}
      </Card>

      <Card title={`Approved structured facts (${selection.factIds.length} selected)`} icon="clipboard">
        {approvedFacts.length === 0 ? (
          <p className="muted small">No approved facts yet. Run extraction or add facts in the Structured Profile.</p>
        ) : (
          <div className="stack-sm">
            <div className="cluster">
              <button
                className="btn btn--ghost btn--sm"
                onClick={() =>
                  onChange({
                    ...selection,
                    factIds:
                      selection.factIds.length === approvedFacts.length
                        ? []
                        : approvedFacts.map((f) => f.id),
                  })
                }
              >
                {selection.factIds.length === approvedFacts.length ? 'Clear all' : 'Select all approved'}
              </button>
            </div>
            {approvedFacts.map((fact) => (
              <label key={fact.id} className="checkbox-row" style={{ padding: '8px 12px' }}>
                <input
                  type="checkbox"
                  checked={selection.factIds.includes(fact.id)}
                  onChange={() => toggle('factIds', fact.id)}
                />
                <span className="small">
                  {fact.statement.slice(0, 140)}
                  {fact.riskRelated && <> <RiskFlagBadge label="Risk-related" /></>}
                </span>
              </label>
            ))}
          </div>
        )}
      </Card>

      {pendingFacts.length > 0 && (
        <Card title="Pending facts (excluded by default)" icon="clock">
          <div className="notice notice--warn" style={{ marginBottom: 10 }}>
            <Icon name="alert" size={16} />
            <span className="small">
              These items have NOT been clinician-approved. Including one labels it
              “PENDING” inside the draft and adds a warning to the document.
            </span>
          </div>
          <div className="stack-sm">
            {pendingFacts.map((fact) => (
              <label key={fact.id} className="checkbox-row" style={{ padding: '8px 12px' }}>
                <input
                  type="checkbox"
                  checked={selection.explicitlyIncludedPendingFactIds.includes(fact.id)}
                  onChange={() => toggle('explicitlyIncludedPendingFactIds', fact.id)}
                />
                <span className="small">
                  <Badge tone="amber" icon="clock">Pending</Badge> {fact.statement.slice(0, 130)}
                  {fact.riskRelated && <> <RiskFlagBadge label="Risk-related" /></>}
                </span>
              </label>
            ))}
          </div>
        </Card>
      )}

      <Card title={`Assessments (${selection.assessmentIds.length} selected)`} icon="activity">
        {assessments.length === 0 ? (
          <p className="muted small">No assessments recorded.</p>
        ) : (
          <div className="stack-sm">
            {assessments.map((record) => (
              <label key={record.id} className="checkbox-row" style={{ padding: '8px 12px' }}>
                <input
                  type="checkbox"
                  checked={selection.assessmentIds.includes(record.id)}
                  onChange={() => toggle('assessmentIds', record.id)}
                />
                <span className="small">
                  <strong>{record.name}</strong> {record.totalScore ?? '—'} · {fmtDate(record.dateAdministered)}
                  {record.riskFlags.length > 0 && <> <RiskFlagBadge label="Risk-flagged" /></>}
                </span>
              </label>
            ))}
          </div>
        )}
      </Card>

      {hypotheses.length > 0 && (
        <Card title={`Approved hypotheses (${selection.hypothesisIds.length} selected)`} icon="search">
          <p className="muted small" style={{ marginBottom: 8 }}>
            Included content is always labeled “Clinical hypothesis”, never presented as fact.
          </p>
          <div className="stack-sm">
            {hypotheses.map((h) => (
              <label key={h.id} className="checkbox-row" style={{ padding: '8px 12px' }}>
                <input
                  type="checkbox"
                  checked={selection.hypothesisIds.includes(h.id)}
                  onChange={() => toggle('hypothesisIds', h.id)}
                />
                <span className="small">{h.statement.slice(0, 140)}</span>
              </label>
            ))}
          </div>
        </Card>
      )}

      <Card title={`Treatment goals (${selection.goalIds.length} selected)`} icon="check">
        {goals.length === 0 ? (
          <p className="muted small">
            No goals yet — create them in the Goals &amp; Objectives tab.
            {docType === 'treatment-plan' && ' The plan generator will flag this as requiring clinician input.'}
          </p>
        ) : (
          <div className="stack-sm">
            {goals.map((goal) => (
              <label key={goal.id} className="checkbox-row" style={{ padding: '8px 12px' }}>
                <input
                  type="checkbox"
                  checked={selection.goalIds.includes(goal.id)}
                  onChange={() => toggle('goalIds', goal.id)}
                />
                <span className="small">
                  <Badge tone={goal.kind === 'short-term' ? 'blue' : 'plum'}>{goal.kind}</Badge> {goal.title}
                </span>
              </label>
            ))}
          </div>
        )}
      </Card>

      <Card title="Client record" icon="user">
        <div className="stack-sm">
          <label className="checkbox-row" style={{ padding: '8px 12px' }}>
            <input
              type="checkbox"
              checked={selection.includeDiagnoses}
              onChange={(e) => onChange({ ...selection, includeDiagnoses: e.target.checked })}
            />
            <span className="small">Include documented diagnoses &amp; impressions</span>
          </label>
          <label className="checkbox-row" style={{ padding: '8px 12px' }}>
            <input
              type="checkbox"
              checked={selection.includeMedications}
              onChange={(e) => onChange({ ...selection, includeMedications: e.target.checked })}
            />
            <span className="small">Include medication list</span>
          </label>
          <label className="checkbox-row checkbox-row--risk" style={{ padding: '8px 12px' }}>
            <input
              type="checkbox"
              checked={selection.includeRiskStatus}
              onChange={(e) => onChange({ ...selection, includeRiskStatus: e.target.checked })}
            />
            <span className="small">Include clinician-confirmed risk status</span>
          </label>
        </div>
      </Card>

      {(riskSelected || pendingSelected) && (
        <Card title="Confirmations" icon="shield">
          <div className="stack-sm">
            {riskSelected && (
              <label className="checkbox-row checkbox-row--risk">
                <input
                  type="checkbox"
                  checked={selection.riskConfirmed}
                  onChange={(e) => onChange({ ...selection, riskConfirmed: e.target.checked })}
                />
                <span className="small">
                  <strong>I confirm the inclusion of the selected risk-related information.</strong>
                  <span className="muted" style={{ display: 'block' }}>
                    Risk content in the generated draft will still require per-item confirmation
                    before the document can be approved.
                  </span>
                </span>
              </label>
            )}
            {pendingSelected && (
              <div className="notice notice--warn">
                <Icon name="alert" size={16} />
                <span className="small">
                  {selection.explicitlyIncludedPendingFactIds.length} pending item(s) will be
                  labeled “PENDING — not yet clinician-approved” inside the draft.
                </span>
              </div>
            )}
          </div>
        </Card>
      )}
    </div>
  );
}
