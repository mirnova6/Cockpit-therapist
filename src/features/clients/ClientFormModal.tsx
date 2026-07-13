import { useState, type FormEvent } from 'react';
import { Icon } from '../../app/components/Icon';
import { Field, Modal } from '../../app/components/ui';
import type { ClientDraft } from '../../core/db/database';
import {
  CLIENT_STATUSES,
  LEVELS_OF_CARE,
  RISK_LEVELS,
  newId,
  type Client,
  type DiagnosisEntry,
  type MedicationEntry,
} from '../../core/db/schema';
import { useAuthStore } from '../../state/authStore';

interface Props {
  existing?: Client;
  onSave: (draft: ClientDraft) => Promise<void>;
  onClose: () => void;
}

export function ClientFormModal({ existing, onSave, onClose }: Props) {
  const therapistName = useAuthStore((s) => s.profileName) ?? '';
  const [displayName, setDisplayName] = useState(existing?.displayName ?? '');
  const [preferredIdentifier, setPreferredIdentifier] = useState(existing?.preferredIdentifier ?? '');
  const [pronouns, setPronouns] = useState(existing?.pronouns ?? '');
  const [dateOfBirth, setDateOfBirth] = useState(existing?.dateOfBirth ?? '');
  const [levelOfCare, setLevelOfCare] = useState(existing?.levelOfCare ?? 'outpatient');
  const [status, setStatus] = useState(existing?.status ?? 'active');
  const [admissionDate, setAdmissionDate] = useState(existing?.admissionDate ?? '');
  const [dischargeDate, setDischargeDate] = useState(existing?.dischargeDate ?? '');
  const [assignedTherapist, setAssignedTherapist] = useState(
    existing?.assignedTherapist ?? therapistName,
  );
  const [presentingProblem, setPresentingProblem] = useState(existing?.presentingProblem ?? '');
  const [contactEnabled, setContactEnabled] = useState(existing?.contactEnabled ?? false);
  const [phone, setPhone] = useState(existing?.contact?.phone ?? '');
  const [email, setEmail] = useState(existing?.contact?.email ?? '');
  const [emergencyContact, setEmergencyContact] = useState(existing?.contact?.emergencyContact ?? '');
  const [riskLevel, setRiskLevel] = useState(existing?.risk.level ?? 'not-assessed');
  const [riskNote, setRiskNote] = useState(existing?.risk.note ?? '');
  const [diagnoses, setDiagnoses] = useState<DiagnosisEntry[]>(existing?.diagnoses ?? []);
  const [medications, setMedications] = useState<MedicationEntry[]>(existing?.medications ?? []);
  const [dxLabel, setDxLabel] = useState('');
  const [dxCode, setDxCode] = useState('');
  const [dxKind, setDxKind] = useState<'diagnosis' | 'impression'>('diagnosis');
  const [medName, setMedName] = useState('');
  const [medDose, setMedDose] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const addDiagnosis = () => {
    if (!dxLabel.trim()) return;
    setDiagnoses([
      ...diagnoses,
      { id: newId(), label: dxLabel.trim(), code: dxCode.trim() || undefined, kind: dxKind },
    ]);
    setDxLabel('');
    setDxCode('');
  };

  const addMedication = () => {
    if (!medName.trim()) return;
    setMedications([
      ...medications,
      { id: newId(), name: medName.trim(), dose: medDose.trim() || undefined, status: 'current' },
    ]);
    setMedName('');
    setMedDose('');
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!displayName.trim()) return setError('A name or initials is required.');
    setBusy(true);
    try {
      await onSave({
        displayName: displayName.trim(),
        preferredIdentifier: preferredIdentifier.trim() || undefined,
        pronouns: pronouns.trim() || undefined,
        dateOfBirth: dateOfBirth || undefined,
        contactEnabled,
        contact: contactEnabled
          ? {
              phone: phone.trim() || undefined,
              email: email.trim() || undefined,
              emergencyContact: emergencyContact.trim() || undefined,
            }
          : undefined,
        levelOfCare,
        status,
        admissionDate: admissionDate || undefined,
        dischargeDate: dischargeDate || undefined,
        assignedTherapist: assignedTherapist.trim() || undefined,
        presentingProblem: presentingProblem.trim() || undefined,
        diagnoses,
        medications,
        risk: existing
          ? existing.risk
          : { level: riskLevel, note: riskNote.trim() || undefined },
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save client.');
      setBusy(false);
    }
  };

  return (
    <Modal
      title={existing ? 'Edit client details' : 'Add client'}
      subtitle="Use initials or an identifier if you prefer not to store full names."
      onClose={onClose}
    >
      <form onSubmit={submit} className="stack">
        <div className="form-grid">
          <Field label="Name or initials" required>
            <input className="input" value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="e.g. J.T." />
          </Field>
          <Field label="Preferred identifier" hint="Optional chart / case number.">
            <input className="input" value={preferredIdentifier} onChange={(e) => setPreferredIdentifier(e.target.value)} />
          </Field>
          <Field label="Pronouns">
            <input className="input" value={pronouns} onChange={(e) => setPronouns(e.target.value)} placeholder="e.g. she/her" />
          </Field>
          <Field label="Date of birth">
            <input className="input" type="date" value={dateOfBirth} onChange={(e) => setDateOfBirth(e.target.value)} />
          </Field>
          <Field label="Level of care">
            <select className="select" value={levelOfCare} onChange={(e) => setLevelOfCare(e.target.value as typeof levelOfCare)}>
              {LEVELS_OF_CARE.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </Field>
          <Field label="Treatment status">
            <select className="select" value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
              {CLIENT_STATUSES.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </Field>
          <Field label="Admission date">
            <input className="input" type="date" value={admissionDate} onChange={(e) => setAdmissionDate(e.target.value)} />
          </Field>
          <Field label="Discharge date">
            <input className="input" type="date" value={dischargeDate} onChange={(e) => setDischargeDate(e.target.value)} />
          </Field>
          <Field label="Assigned therapist">
            <input className="input" value={assignedTherapist} onChange={(e) => setAssignedTherapist(e.target.value)} />
          </Field>
        </div>

        <Field label="Presenting problem" hint="Brief summary shown on the dashboard.">
          <textarea className="textarea" style={{ minHeight: 70 }} value={presentingProblem} onChange={(e) => setPresentingProblem(e.target.value)} />
        </Field>

        {!existing && (
          <div className="form-grid">
            <Field label="Initial risk level" hint="You can update this any time from the dashboard.">
              <select className="select" value={riskLevel} onChange={(e) => setRiskLevel(e.target.value as typeof riskLevel)}>
                {RISK_LEVELS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label} — {o.description}</option>
                ))}
              </select>
            </Field>
            <Field label="Risk note">
              <input className="input" value={riskNote} onChange={(e) => setRiskNote(e.target.value)} />
            </Field>
          </div>
        )}

        <fieldset style={{ border: 'none', padding: 0, margin: 0 }} className="stack-sm">
          <span className="field__label">Diagnoses &amp; diagnostic impressions</span>
          {diagnoses.length > 0 && (
            <div className="chips">
              {diagnoses.map((d) => (
                <span key={d.id} className="badge badge--blue">
                  {d.label}
                  {d.code ? ` (${d.code})` : ''} · {d.kind === 'diagnosis' ? 'Dx' : 'Impression'}
                  <button
                    type="button"
                    className="icon-btn"
                    style={{ width: 18, height: 18, border: 'none', background: 'transparent' }}
                    aria-label={`Remove ${d.label}`}
                    onClick={() => setDiagnoses(diagnoses.filter((x) => x.id !== d.id))}
                  >
                    <Icon name="x" size={11} />
                  </button>
                </span>
              ))}
            </div>
          )}
          <div className="cluster">
            <input className="input" style={{ flex: 2, minWidth: 140 }} placeholder="e.g. Major depressive disorder" value={dxLabel} onChange={(e) => setDxLabel(e.target.value)} />
            <input className="input" style={{ flex: 1, minWidth: 90 }} placeholder="Code" value={dxCode} onChange={(e) => setDxCode(e.target.value)} />
            <select className="select" style={{ width: 'auto' }} value={dxKind} onChange={(e) => setDxKind(e.target.value as typeof dxKind)}>
              <option value="diagnosis">Documented diagnosis</option>
              <option value="impression">Diagnostic impression</option>
            </select>
            <button type="button" className="btn btn--secondary btn--sm" onClick={addDiagnosis}>
              <Icon name="plus" size={14} /> Add
            </button>
          </div>
        </fieldset>

        <fieldset style={{ border: 'none', padding: 0, margin: 0 }} className="stack-sm">
          <span className="field__label">Medications</span>
          {medications.length > 0 && (
            <div className="chips">
              {medications.map((m) => (
                <span key={m.id} className="badge badge--plum">
                  {m.name}
                  {m.dose ? ` ${m.dose}` : ''}
                  <button
                    type="button"
                    className="icon-btn"
                    style={{ width: 18, height: 18, border: 'none', background: 'transparent' }}
                    aria-label={`Remove ${m.name}`}
                    onClick={() => setMedications(medications.filter((x) => x.id !== m.id))}
                  >
                    <Icon name="x" size={11} />
                  </button>
                </span>
              ))}
            </div>
          )}
          <div className="cluster">
            <input className="input" style={{ flex: 2, minWidth: 140 }} placeholder="e.g. Sertraline" value={medName} onChange={(e) => setMedName(e.target.value)} />
            <input className="input" style={{ flex: 1, minWidth: 90 }} placeholder="Dose" value={medDose} onChange={(e) => setMedDose(e.target.value)} />
            <button type="button" className="btn btn--secondary btn--sm" onClick={addMedication}>
              <Icon name="plus" size={14} /> Add
            </button>
          </div>
        </fieldset>

        <label className="checkbox-row">
          <input type="checkbox" checked={contactEnabled} onChange={(e) => setContactEnabled(e.target.checked)} />
          <span>
            <strong>Store contact information</strong>
            <span className="muted" style={{ display: 'block' }}>
              Optional. Kept encrypted with the rest of the record.
            </span>
          </span>
        </label>
        {contactEnabled && (
          <div className="form-grid">
            <Field label="Phone"><input className="input" value={phone} onChange={(e) => setPhone(e.target.value)} /></Field>
            <Field label="Email"><input className="input" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
            <Field label="Emergency contact"><input className="input" value={emergencyContact} onChange={(e) => setEmergencyContact(e.target.value)} /></Field>
          </div>
        )}

        {error && (
          <div className="notice notice--danger" role="alert">
            <Icon name="alert" size={18} />
            <span>{error}</span>
          </div>
        )}

        <div className="modal__footer">
          <button type="button" className="btn btn--ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn--primary" disabled={busy}>
            {existing ? 'Save changes' : 'Create client'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
