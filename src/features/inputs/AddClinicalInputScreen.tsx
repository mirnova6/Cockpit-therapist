import { useState, type FormEvent } from 'react';
import { useNavigate, useOutletContext } from 'react-router-dom';
import { Icon } from '../../app/components/Icon';
import { Badge, Card, Field } from '../../app/components/ui';
import type { NewAttachment } from '../../core/db/database';
import {
  INPUT_TYPES,
  REPORTED_BY_OPTIONS,
  type ClinicalInputType,
  type ReportedBy,
} from '../../core/db/schema';
import { formatBytes, todayIsoDate } from '../../lib/format';
import { useAuthStore } from '../../state/authStore';
import { useDataStore } from '../../state/dataStore';
import type { ClientContext } from '../dashboard/ClientDashboardLayout';

interface PendingFile {
  name: string;
  mimeType: string;
  bytes: Uint8Array;
}

export function AddClinicalInputScreen() {
  const { client } = useOutletContext<ClientContext>();
  const navigate = useNavigate();
  const addInput = useDataStore((s) => s.addInput);
  const profileName = useAuthStore((s) => s.profileName) ?? '';

  const [inputType, setInputType] = useState<ClinicalInputType>('rough-notes');
  const [dateOfInformation, setDateOfInformation] = useState(todayIsoDate());
  const [sessionDate, setSessionDate] = useState('');
  const [sessionNumber, setSessionNumber] = useState('');
  const [authorSource, setAuthorSource] = useState(profileName);
  const [reportedBy, setReportedBy] = useState<ReportedBy>('therapist-entered');
  const [rawText, setRawText] = useState('');
  const [files, setFiles] = useState<PendingFile[]>([]);
  const [containsRisk, setContainsRisk] = useState(false);
  const [allowAiAnalysis, setAllowAiAnalysis] = useState(true);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const typeMeta = INPUT_TYPES.find((t) => t.value === inputType);

  const onFiles = async (list: FileList | null) => {
    if (!list) return;
    const added: PendingFile[] = [];
    for (const file of Array.from(list)) {
      if (file.size > 20 * 1024 * 1024) {
        setError(`"${file.name}" is larger than 20 MB and was skipped.`);
        continue;
      }
      added.push({
        name: file.name,
        mimeType: file.type || 'application/octet-stream',
        bytes: new Uint8Array(await file.arrayBuffer()),
      });
    }
    setFiles((prev) => [...prev, ...added]);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(undefined);
    if (!rawText.trim() && files.length === 0) {
      return setError('Enter text or attach at least one file.');
    }
    if (!dateOfInformation) {
      return setError('Please confirm the date this information refers to.');
    }
    setBusy(true);
    try {
      const input = await addInput(
        {
          clientId: client.id,
          inputType,
          dateOfInformation,
          sessionDate: sessionDate || undefined,
          sessionNumber: sessionNumber ? Number(sessionNumber) : undefined,
          rawText: rawText.trim(),
          authorSource: authorSource.trim() || profileName,
          reportedBy,
          containsRisk,
          allowAiAnalysis,
          localOnly: true,
        },
        files as NewAttachment[],
      );
      // Risk-flagged material routes straight to the review panel.
      navigate(`../inputs/${input.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save.');
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="stack" style={{ maxWidth: 840 }}>
      <Card title="Add clinical information" icon="plus">
        <div className="stack">
          <div className="form-grid">
            <Field label="Input type" required>
              <select className="select" value={inputType} onChange={(e) => setInputType(e.target.value as ClinicalInputType)}>
                {INPUT_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </Field>
            <Field label="Date of information" required hint="The date the information refers to.">
              <input className="input" type="date" value={dateOfInformation} onChange={(e) => setDateOfInformation(e.target.value)} />
            </Field>
            {typeMeta?.sessionLinked && (
              <>
                <Field label="Session date">
                  <input className="input" type="date" value={sessionDate} onChange={(e) => setSessionDate(e.target.value)} />
                </Field>
                <Field label="Session number">
                  <input className="input" type="number" min="1" value={sessionNumber} onChange={(e) => setSessionNumber(e.target.value)} />
                </Field>
              </>
            )}
            <Field label="Author / source" required>
              <input className="input" value={authorSource} onChange={(e) => setAuthorSource(e.target.value)} />
            </Field>
            <Field label="Reported by">
              <select className="select" value={reportedBy} onChange={(e) => setReportedBy(e.target.value as ReportedBy)}>
                {REPORTED_BY_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </Field>
          </div>

          <Field
            label="Clinical content"
            hint="Paste a transcript, type rough notes, bullet points, quotes, or observations. Stored exactly as entered."
          >
            <textarea
              className="textarea"
              style={{ minHeight: 220 }}
              value={rawText}
              onChange={(e) => setRawText(e.target.value)}
              placeholder={
                inputType === 'session-transcript'
                  ? 'Paste the session transcript here…'
                  : inputType === 'client-quote'
                    ? '“Exact words the client used…”'
                    : 'Enter the clinical information…'
              }
            />
          </Field>

          <div className="stack-sm">
            <span className="field__label">Attachments</span>
            {files.length > 0 && (
              <div className="row-list" style={{ border: '1px solid var(--line)', borderRadius: 10, padding: '0 10px' }}>
                {files.map((f, idx) => (
                  <div key={`${f.name}-${idx}`} className="list-row" style={{ cursor: 'default' }}>
                    <Icon name="file" size={16} className="soft" />
                    <span style={{ flex: 1 }} className="small soft">{f.name}</span>
                    <span className="muted small">{formatBytes(f.bytes.length)}</span>
                    <button
                      type="button"
                      className="icon-btn"
                      style={{ width: 28, height: 28 }}
                      aria-label={`Remove ${f.name}`}
                      onClick={() => setFiles(files.filter((_, i) => i !== idx))}
                    >
                      <Icon name="x" size={13} />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <label className="btn btn--secondary btn--sm" style={{ alignSelf: 'flex-start' }}>
              <Icon name="upload" size={14} />
              Attach files (encrypted at rest)
              <input type="file" multiple hidden onChange={(e) => { void onFiles(e.target.files); e.target.value = ''; }} />
            </label>
          </div>
        </div>
      </Card>

      <Card title="Classification & handling" icon="shield">
        <div className="stack">
          <label className="checkbox-row checkbox-row--risk">
            <input type="checkbox" checked={containsRisk} onChange={(e) => setContainsRisk(e.target.checked)} />
            <span>
              <strong>This entry contains risk information</strong>
              <span className="muted" style={{ display: 'block' }}>
                Suicidal ideation, self-harm, violence risk, abuse, acute deterioration, or similar.
                Flagged entries are routed to you for explicit review and cannot be bulk-approved.
              </span>
            </span>
          </label>

          <label className="checkbox-row">
            <input type="checkbox" checked={allowAiAnalysis} onChange={(e) => setAllowAiAnalysis(e.target.checked)} />
            <span>
              <strong>Allow AI analysis of this entry</strong>
              <span className="muted" style={{ display: 'block' }}>
                Stored as consent metadata with the record. The analysis pipeline ships in a later
                phase; entries marked “no” will always be excluded from it.
              </span>
            </span>
          </label>

          <div className="cluster">
            <Badge tone="green" icon="shield">Stored locally &amp; encrypted on this device</Badge>
          </div>
        </div>
      </Card>

      {error && (
        <div className="notice notice--danger" role="alert">
          <Icon name="alert" size={18} />
          <span>{error}</span>
        </div>
      )}

      <div className="cluster">
        <button type="submit" className="btn btn--primary" disabled={busy}>
          <Icon name="check" size={16} />
          Save to record
        </button>
        <button type="button" className="btn btn--ghost" onClick={() => navigate('..')} disabled={busy}>
          Cancel
        </button>
      </div>
    </form>
  );
}
