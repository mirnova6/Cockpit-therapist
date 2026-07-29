import { useState } from 'react';
import { Icon } from '../../app/components/Icon';
import { Field, Modal } from '../../app/components/ui';
import type { ClinicalInput } from '../../core/db/schema';
import {
  FACT_CATEGORIES,
  SOURCE_CLASSIFICATIONS,
  factCategoryMeta,
  type ExtractedFact,
  type FactCategory,
  type SourceClassification,
} from '../../core/db/structuredSchema';
import { todayIsoDate } from '../../lib/format';
import { useStructuredStore } from '../../state/structuredStore';

/**
 * Manual fact entry (extractionMethod: 'manual'). Clinician-authored facts
 * are approved on save — the clinician IS the reviewer. Editing an existing
 * fact preserves the prior version in history.
 */
export function FactFormModal({
  clientId,
  sourceInputs,
  existing,
  onClose,
}: {
  clientId: string;
  sourceInputs: ClinicalInput[];
  existing?: ExtractedFact;
  onClose: () => void;
}) {
  const createFact = useStructuredStore((s) => s.createFact);
  const editFact = useStructuredStore((s) => s.editFact);

  const [category, setCategory] = useState<FactCategory>(existing?.category ?? 'symptom');
  const [statement, setStatement] = useState(existing?.statement ?? '');
  const [classification, setClassification] = useState<SourceClassification>(
    existing?.classification ?? 'client-report',
  );
  const [sourceInputId, setSourceInputId] = useState(existing?.sourceInputId ?? sourceInputs[0]?.id ?? '');
  const [excerpt, setExcerpt] = useState(existing?.excerpt ?? '');
  const [dateOccurred, setDateOccurred] = useState(existing?.dateOccurred ?? '');
  const [temporalStatus, setTemporalStatus] = useState<'current' | 'historical'>(
    existing?.temporalStatus ?? 'current',
  );
  const [riskRelated, setRiskRelated] = useState(
    existing?.riskRelated ?? false,
  );
  const [editReason, setEditReason] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setError(undefined);
    if (!statement.trim()) return setError('Enter the clinical statement.');
    if (!existing && !sourceInputId) return setError('Choose the source clinical input this fact comes from.');
    if (existing && !editReason.trim()) return setError('Describe the reason for this change (kept in version history).');
    setBusy(true);
    try {
      if (existing) {
        await editFact(
          existing.id,
          clientId,
          {
            category,
            statement: statement.trim(),
            classification,
            excerpt: excerpt.trim() || undefined,
            dateOccurred: dateOccurred || undefined,
            temporalStatus,
            riskRelated: riskRelated || Boolean(factCategoryMeta(category).riskByDefault),
          },
          editReason.trim(),
        );
      } else {
        const input = sourceInputs.find((i) => i.id === sourceInputId);
        await createFact({
          clientId,
          sourceInputId,
          sourceInputVersion: input?.version ?? 1,
          category,
          statement: statement.trim(),
          excerpt: excerpt.trim() || undefined,
          dateOccurred: dateOccurred || undefined,
          dateRecorded: todayIsoDate(),
          classification,
          extractionMethod: 'manual',
          extractionConfidence: 'high',
          temporalStatus,
          riskRelated: riskRelated || Boolean(factCategoryMeta(category).riskByDefault),
          reviewStatus: 'approved',
        });
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save fact.');
      setBusy(false);
    }
  };

  return (
    <Modal
      title={existing ? 'Edit clinical fact' : 'Add clinical fact manually'}
      subtitle={
        existing
          ? 'The previous version is preserved in history.'
          : 'Labeled “Manually Entered” and attributed to you.'
      }
      onClose={onClose}
    >
      <div className="stack">
        <div className="form-grid">
          <Field label="Clinical category">
            <select className="select" value={category} onChange={(e) => setCategory(e.target.value as FactCategory)}>
              {FACT_CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </select>
          </Field>
          <Field label="Information source">
            <select className="select" value={classification} onChange={(e) => setClassification(e.target.value as SourceClassification)}>
              {SOURCE_CLASSIFICATIONS.map((c) => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </select>
          </Field>
          {!existing && (
            <Field label="Source clinical input">
              <select className="select" value={sourceInputId} onChange={(e) => setSourceInputId(e.target.value)}>
                {sourceInputs.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.inputType} · {i.dateOfInformation}
                  </option>
                ))}
              </select>
            </Field>
          )}
          <Field label="Date of occurrence (optional)">
            <input className="input" type="date" value={dateOccurred} onChange={(e) => setDateOccurred(e.target.value)} />
          </Field>
          <Field label="Current or historical">
            <select className="select" value={temporalStatus} onChange={(e) => setTemporalStatus(e.target.value as 'current' | 'historical')}>
              <option value="current">Current</option>
              <option value="historical">Historical</option>
            </select>
          </Field>
        </div>

        <Field label="Clinical statement">
          <textarea className="textarea" style={{ minHeight: 80 }} value={statement} onChange={(e) => setStatement(e.target.value)} />
        </Field>
        <Field label="Exact supporting excerpt (optional)" hint="Quote from the source that supports this fact.">
          <textarea className="textarea" style={{ minHeight: 60 }} value={excerpt} onChange={(e) => setExcerpt(e.target.value)} />
        </Field>

        <label className="checkbox-row checkbox-row--risk">
          <input type="checkbox" checked={riskRelated} onChange={(e) => setRiskRelated(e.target.checked)} />
          <span className="small"><strong>Risk-related</strong> — excluded from bulk actions; elevated visibility.</span>
        </label>

        {existing && (
          <Field label="Reason for change (required)">
            <input className="input" value={editReason} onChange={(e) => setEditReason(e.target.value)} />
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
            {existing ? 'Save new version' : 'Add fact'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
