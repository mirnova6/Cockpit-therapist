import { useMemo, useState } from 'react';
import { Icon } from '../../app/components/Icon';
import { Field, Modal } from '../../app/components/ui';
import {
  ASSESSMENT_DEFINITIONS,
  CUSTOM_DEFINITION_KEY,
  computeRiskFlags,
  getDefinition,
} from '../../core/assessments/definitions';
import type { SubscaleScore } from '../../core/db/structuredSchema';
import { todayIsoDate } from '../../lib/format';
import { useStructuredStore } from '../../state/structuredStore';

export function AssessmentFormModal({
  clientId,
  sourceInputId,
  onClose,
}: {
  clientId: string;
  sourceInputId?: string;
  onClose: () => void;
}) {
  const createAssessment = useStructuredStore((s) => s.createAssessment);
  const [definitionKey, setDefinitionKey] = useState('phq9');
  const [customName, setCustomName] = useState('');
  const [date, setDate] = useState(todayIsoDate());
  const [totalScore, setTotalScore] = useState('');
  const [categorical, setCategorical] = useState<Record<string, number>>({});
  const [subscales, setSubscales] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState('');
  const [riskQuestionChecked, setRiskQuestionChecked] = useState(false);
  const [disposition, setDisposition] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const def = getDefinition(definitionKey);
  const isCustom = definitionKey === CUSTOM_DEFINITION_KEY;

  const draftSubscales = useMemo((): SubscaleScore[] | undefined => {
    if (def?.entry === 'categorical') {
      return def.categoricalFields?.map((f) => ({
        label: f.label,
        score: categorical[f.key] ?? 0,
      }));
    }
    const entries = Object.entries(subscales).filter(([, v]) => v.trim() !== '');
    if (entries.length === 0) return undefined;
    return entries.map(([label, v]) => ({ label, score: Number(v) }));
  }, [def, categorical, subscales]);

  const pendingRiskFlags = useMemo(() => {
    const flags = computeRiskFlags({
      definitionKey,
      totalScore: totalScore === '' ? undefined : Number(totalScore),
      subscaleScores: draftSubscales,
    });
    if (riskQuestionChecked && def?.riskQuestion) flags.push(def.riskQuestion.flag);
    return flags;
  }, [definitionKey, totalScore, draftSubscales, riskQuestionChecked, def]);

  const save = async () => {
    setError(undefined);
    const name = isCustom ? customName.trim() : def?.label ?? definitionKey;
    if (!name) return setError('Enter a name for the custom assessment.');
    let score: number | undefined;
    if (def?.entry !== 'categorical') {
      if (totalScore.trim() === '') return setError('Enter the total score.');
      score = Number(totalScore);
      if (Number.isNaN(score)) return setError('Total score must be a number.');
      if (def?.min !== undefined && score < def.min) return setError(`Minimum score for ${def.label} is ${def.min}.`);
      if (def?.max !== undefined && score > def.max) return setError(`Maximum score for ${def.label} is ${def.max}.`);
    }
    if (pendingRiskFlags.length > 0 && !disposition.trim()) {
      return setError('This entry raises risk flags — record your disposition or follow-up first.');
    }
    setBusy(true);
    try {
      await createAssessment(
        {
          clientId,
          definitionKey: isCustom ? CUSTOM_DEFINITION_KEY : definitionKey,
          name,
          dateAdministered: date,
          totalScore: score,
          subscaleScores: draftSubscales,
          clinicianNotes: notes.trim() || undefined,
          sourceInputId,
          riskDisposition: disposition.trim() || undefined,
        },
        riskQuestionChecked && def?.riskQuestion ? [def.riskQuestion.flag] : [],
      );
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save assessment.');
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Record assessment"
      subtitle="Interpretations come only from encoded official scoring rules. Screening results are never diagnoses."
      onClose={onClose}
    >
      <div className="stack">
        <div className="form-grid">
          <Field label="Assessment">
            <select
              className="select"
              value={definitionKey}
              onChange={(e) => {
                setDefinitionKey(e.target.value);
                setCategorical({});
                setSubscales({});
                setRiskQuestionChecked(false);
              }}
            >
              {ASSESSMENT_DEFINITIONS.map((d) => (
                <option key={d.key} value={d.key}>{d.label} — {d.fullName}</option>
              ))}
              <option value={CUSTOM_DEFINITION_KEY}>Custom assessment…</option>
            </select>
          </Field>
          <Field label="Date administered">
            <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
        </div>

        {isCustom && (
          <Field label="Custom assessment name" hint="Custom measures show scores only — no interpretation is invented.">
            <input className="input" value={customName} onChange={(e) => setCustomName(e.target.value)} placeholder="e.g. Clinic Wellness Scale" />
          </Field>
        )}

        {def?.entry === 'categorical' ? (
          <div className="form-grid">
            {def.categoricalFields?.map((field) => (
              <Field key={field.key} label={field.label}>
                <select
                  className="select"
                  value={categorical[field.key] ?? 0}
                  onChange={(e) => setCategorical({ ...categorical, [field.key]: Number(e.target.value) })}
                >
                  {field.options.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </Field>
            ))}
          </div>
        ) : (
          <div className="form-grid">
            <Field
              label={`Total score${def?.min !== undefined && def?.max !== undefined ? ` (${def.min}–${def.max})` : ''}`}
            >
              <input
                className="input"
                type="number"
                value={totalScore}
                onChange={(e) => setTotalScore(e.target.value)}
                min={def?.min}
                max={def?.max}
              />
            </Field>
            {def?.subscales?.map((label) => (
              <Field key={label} label={`${label} (subscale, optional)`}>
                <input
                  className="input"
                  type="number"
                  value={subscales[label] ?? ''}
                  onChange={(e) => setSubscales({ ...subscales, [label]: e.target.value })}
                />
              </Field>
            ))}
          </div>
        )}

        {def?.riskQuestion && (
          <label className="checkbox-row checkbox-row--risk">
            <input
              type="checkbox"
              checked={riskQuestionChecked}
              onChange={(e) => setRiskQuestionChecked(e.target.checked)}
            />
            <span className="small"><strong>{def.riskQuestion.label}</strong></span>
          </label>
        )}

        {pendingRiskFlags.length > 0 && (
          <div className="notice notice--danger">
            <Icon name="alert" size={18} />
            <span className="small">
              <strong>Risk flags: {pendingRiskFlags.join(', ')}.</strong> A clinician disposition
              note is required. This entry will require individual review and is excluded from any
              bulk action. {def?.screeningNote}
            </span>
          </div>
        )}
        {pendingRiskFlags.length > 0 && (
          <Field label="Clinician disposition / follow-up (required)">
            <textarea className="textarea" style={{ minHeight: 70 }} value={disposition} onChange={(e) => setDisposition(e.target.value)} />
          </Field>
        )}

        <Field label="Clinician notes (optional)">
          <textarea className="textarea" style={{ minHeight: 60 }} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>

        {error && (
          <div className="notice notice--danger" role="alert">
            <Icon name="alert" size={16} />
            <span>{error}</span>
          </div>
        )}

        <div className="modal__footer">
          <button className="btn btn--ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn--primary" disabled={busy} onClick={() => void save()}>
            Save assessment
          </button>
        </div>
      </div>
    </Modal>
  );
}
