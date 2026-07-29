import { useState } from 'react';
import { Icon } from '../../app/components/Icon';
import { Field, Modal } from '../../app/components/ui';
import type { ClinicalInput } from '../../core/db/schema';
import { inputTypeLabel } from '../../core/db/schema';
import type { GapPriority } from '../../core/db/structuredSchema';
import { todayIsoDate } from '../../lib/format';
import { useStructuredStore } from '../../state/structuredStore';

export function ContradictionFormModal({
  clientId,
  inputs,
  onClose,
}: {
  clientId: string;
  inputs: ClinicalInput[];
  onClose: () => void;
}) {
  const createContradiction = useStructuredStore((s) => s.createContradiction);
  const [topic, setTopic] = useState('');
  const [description, setDescription] = useState('');
  const [significance, setSignificance] = useState('');
  const [firstDesc, setFirstDesc] = useState('');
  const [firstSource, setFirstSource] = useState('');
  const [secondDesc, setSecondDesc] = useState('');
  const [secondSource, setSecondSource] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setError(undefined);
    if (!topic.trim() || !description.trim() || !firstDesc.trim() || !secondDesc.trim()) {
      return setError('Topic, description, and both evidence descriptions are required.');
    }
    setBusy(true);
    try {
      await createContradiction({
        clientId,
        topic: topic.trim(),
        description: description.trim(),
        clinicalSignificance: significance.trim() || undefined,
        firstEvidence: { description: firstDesc.trim(), sourceInputId: firstSource || undefined },
        secondEvidence: { description: secondDesc.trim(), sourceInputId: secondSource || undefined },
        dateIdentified: todayIsoDate(),
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save.');
      setBusy(false);
    }
  };

  const sourcePicker = (value: string, onChange: (v: string) => void, label: string) => (
    <Field label={label}>
      <select className="select" value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">No linked source</option>
        {inputs.map((i) => (
          <option key={i.id} value={i.id}>
            {inputTypeLabel(i.inputType)} · {i.dateOfInformation}
          </option>
        ))}
      </select>
    </Field>
  );

  return (
    <Modal
      title="Record contradiction"
      subtitle="Contradictory information stays visible until you resolve it — it is never auto-resolved."
      onClose={onClose}
    >
      <div className="stack">
        <Field label="Topic">
          <input className="input" value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="e.g. Current alcohol use" />
        </Field>
        <Field label="Description">
          <textarea className="textarea" style={{ minHeight: 70 }} value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <div className="form-grid">
          <Field label="First evidence — description">
            <input className="input" value={firstDesc} onChange={(e) => setFirstDesc(e.target.value)} />
          </Field>
          {sourcePicker(firstSource, setFirstSource, 'First evidence — source input')}
          <Field label="Second evidence — description">
            <input className="input" value={secondDesc} onChange={(e) => setSecondDesc(e.target.value)} />
          </Field>
          {sourcePicker(secondSource, setSecondSource, 'Second evidence — source input')}
        </div>
        <Field label="Clinical significance (optional)">
          <input className="input" value={significance} onChange={(e) => setSignificance(e.target.value)} />
        </Field>
        {error && (
          <div className="notice notice--danger" role="alert">
            <Icon name="alert" size={15} />
            <span>{error}</span>
          </div>
        )}
        <div className="modal__footer">
          <button className="btn btn--ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn--primary" disabled={busy} onClick={() => void save()}>Save contradiction</button>
        </div>
      </div>
    </Modal>
  );
}

export function GapFormModal({ clientId, onClose }: { clientId: string; onClose: () => void }) {
  const createGap = useStructuredStore((s) => s.createGap);
  const [topic, setTopic] = useState('');
  const [reason, setReason] = useState('');
  const [existingEvidence, setExistingEvidence] = useState('');
  const [questions, setQuestions] = useState('');
  const [priority, setPriority] = useState<GapPriority>('medium');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setError(undefined);
    if (!topic.trim() || !reason.trim()) return setError('Topic and reason are required.');
    setBusy(true);
    try {
      await createGap({
        clientId,
        topic: topic.trim(),
        reason: reason.trim(),
        existingEvidence: existingEvidence.trim() || undefined,
        suggestedQuestions: questions
          .split('\n')
          .map((q) => q.trim())
          .filter(Boolean),
        priority,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save.');
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Needs further assessment"
      subtitle="Record what is missing instead of guessing — the app never fabricates missing information."
      onClose={onClose}
    >
      <div className="stack">
        <Field label="Topic">
          <input className="input" value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="e.g. Attachment style" />
        </Field>
        <Field label="Why the information is insufficient">
          <textarea className="textarea" style={{ minHeight: 60 }} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
        <Field label="Existing evidence (optional)">
          <input className="input" value={existingEvidence} onChange={(e) => setExistingEvidence(e.target.value)} />
        </Field>
        <Field label="Suggested questions to explore (one per line)">
          <textarea className="textarea" style={{ minHeight: 80 }} value={questions} onChange={(e) => setQuestions(e.target.value)} />
        </Field>
        <Field label="Priority">
          <select className="select" value={priority} onChange={(e) => setPriority(e.target.value as GapPriority)}>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
        </Field>
        {error && (
          <div className="notice notice--danger" role="alert">
            <Icon name="alert" size={15} />
            <span>{error}</span>
          </div>
        )}
        <div className="modal__footer">
          <button className="btn btn--ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn--primary" disabled={busy} onClick={() => void save()}>Save item</button>
        </div>
      </div>
    </Modal>
  );
}
