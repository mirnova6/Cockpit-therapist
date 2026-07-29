import { useState } from 'react';
import { Icon } from '../../app/components/Icon';
import { Field, Modal } from '../../app/components/ui';
import { RISK_LEVELS, type Client, type RiskLevel } from '../../core/db/schema';
import { useAuthStore } from '../../state/authStore';
import { useDataStore } from '../../state/dataStore';

/**
 * Clinician-confirmed risk status update. This is a deliberate, single-purpose
 * dialog: risk changes are never bundled into bulk edits (spec §23).
 */
export function RiskUpdateModal({ client, onClose }: { client: Client; onClose: () => void }) {
  const setClientRisk = useDataStore((s) => s.setClientRisk);
  const reviewer = useAuthStore((s) => s.profileName) ?? 'Clinician';
  const [level, setLevel] = useState<RiskLevel>(client.risk.level);
  const [note, setNote] = useState(client.risk.note ?? '');
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    await setClientRisk(client.id, {
      level,
      note: note.trim() || undefined,
      reviewedBy: reviewer,
      reviewedAt: new Date().toISOString(),
    });
    onClose();
  };

  return (
    <Modal
      narrow
      title="Update risk & safety status"
      subtitle="This records your clinical determination. It is not an automated assessment."
      onClose={onClose}
    >
      <div className="stack">
        <Field label="Clinician-confirmed risk level">
          <select className="select" value={level} onChange={(e) => setLevel(e.target.value as RiskLevel)}>
            {RISK_LEVELS.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label} — {r.description}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Clinical note" hint="Basis for the determination, safety plan status, next steps.">
          <textarea className="textarea" style={{ minHeight: 90 }} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>

        {(level === 'high' || level === 'acute') && (
          <div className="notice notice--danger">
            <Icon name="alert" size={18} />
            <span>
              Elevated risk selected. Follow your organization's crisis procedures and
              documentation requirements — this app does not replace them.
            </span>
          </div>
        )}

        <label className="checkbox-row checkbox-row--risk">
          <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
          <span className="small">
            I confirm this risk determination reflects my own clinical judgment.
          </span>
        </label>

        <div className="modal__footer">
          <button className="btn btn--ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn--primary" disabled={!confirmed || busy} onClick={() => void save()}>
            Save risk status
          </button>
        </div>
      </div>
    </Modal>
  );
}
