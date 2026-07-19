import { useEffect, useState } from 'react';
import { useNavigate, useOutletContext } from 'react-router-dom';
import { Icon } from '../../app/components/Icon';
import { Badge, Card, EmptyState, Field } from '../../app/components/ui';
import { DAP_STYLES, DOC_STATUS_LABELS, EMPTY_SELECTION, type SourceSelection } from '../../core/db/documentSchema';
import { LEVELS_OF_CARE } from '../../core/db/schema';
import { fmtDate, todayIsoDate } from '../../lib/format';
import { useAiStore } from '../../state/aiStore';
import { useDocumentsStore } from '../../state/documentsStore';
import type { ClientContext } from '../dashboard/ClientDashboardLayout';
import { AiGeneratorPicker, DEFAULT_DOCUMENT_PROVIDER_ID } from './AiGeneratorPicker';
import { SourceSelectionPanel } from './SourceSelectionPanel';
import { statusTone } from './docShared';

export function DapNotesTab() {
  const { client } = useOutletContext<ClientContext>();
  const navigate = useNavigate();
  const docs = useDocumentsStore((s) => s.byClient[client.id]);
  const loadClient = useDocumentsStore((s) => s.loadClient);
  const generateDapNote = useDocumentsStore((s) => s.generateDapNote);

  const [creating, setCreating] = useState(false);
  const [selection, setSelection] = useState<SourceSelection>(EMPTY_SELECTION);
  const [sessionDate, setSessionDate] = useState(todayIsoDate());
  const [sessionNumber, setSessionNumber] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [providerId, setProviderId] = useState(DEFAULT_DOCUMENT_PROVIDER_ID);
  const [onlineConfirmed, setOnlineConfirmed] = useState(false);
  const aiSettings = useAiStore((s) => s.settings);
  const setStoreOnlineConfirmed = useAiStore((s) => s.setOnlineConfirmed);
  const onlineGate =
    providerId !== DEFAULT_DOCUMENT_PROVIDER_ID && aiSettings.activeProviderType === 'online';

  useEffect(() => {
    void loadClient(client.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client.id]);

  const notes = docs?.dapNotes ?? [];

  const generate = async () => {
    setError(undefined);
    setBusy(true);
    if (onlineGate) setStoreOnlineConfirmed(onlineConfirmed);
    try {
      const note = await generateDapNote(client.id, selection, {
        sessionDate,
        sessionNumber: sessionNumber ? Number(sessionNumber) : undefined,
        levelOfCare: client.levelOfCare,
        style: selection.style,
        providerId,
      });
      navigate(note.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Generation failed.');
      setBusy(false);
    } finally {
      setStoreOnlineConfirmed(false);
    }
  };

  if (creating) {
    return (
      <div className="stack" style={{ maxWidth: 860 }}>
        <div className="spread">
          <div>
            <h2>New DAP note — select sources</h2>
            <p className="muted small">
              Only information you select here reaches the draft. Approved information is the default;
              rejected information can never be included.
            </p>
          </div>
          <button className="btn btn--ghost btn--sm" onClick={() => setCreating(false)}>Cancel</button>
        </div>

        <Card title="Session" icon="calendar">
          <div className="form-grid">
            <Field label="Session date">
              <input className="input" type="date" value={sessionDate} onChange={(e) => setSessionDate(e.target.value)} />
            </Field>
            <Field label="Session number (optional)">
              <input className="input" type="number" min="1" value={sessionNumber} onChange={(e) => setSessionNumber(e.target.value)} />
            </Field>
            <Field label="Level of care">
              <input className="input" value={LEVELS_OF_CARE.find((l) => l.value === client.levelOfCare)?.label ?? client.levelOfCare} disabled />
            </Field>
          </div>
        </Card>

        <SourceSelectionPanel clientId={client.id} docType="dap-note" selection={selection} onChange={setSelection} />

        <Card title="Generator" icon="activity">
          <AiGeneratorPicker
            clientId={client.id}
            clientNames={[client.displayName, client.preferredIdentifier ?? ''].filter(Boolean)}
            selection={selection}
            providerId={providerId}
            onProviderChange={setProviderId}
            onlineConfirmed={onlineConfirmed}
            setOnlineConfirmed={setOnlineConfirmed}
          />
        </Card>

        {error && (
          <div className="notice notice--danger" role="alert">
            <Icon name="alert" size={16} />
            <span>{error}</span>
          </div>
        )}

        <div className="cluster">
          <button className="btn btn--primary" disabled={busy || (onlineGate && !onlineConfirmed)} onClick={() => void generate()}>
            <Icon name="file" size={15} /> {busy ? 'Generating…' : 'Generate draft'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="stack">
      <div className="spread">
        <div>
          <h2>DAP notes</h2>
          <p className="muted small">Structured session documentation. Drafts never count as the official record.</p>
        </div>
        <button className="btn btn--primary" onClick={() => { setSelection(EMPTY_SELECTION); setCreating(true); }}>
          <Icon name="plus" size={15} /> New DAP note
        </button>
      </div>

      {notes.length === 0 ? (
        <Card>
          <EmptyState icon="file" title="No DAP notes yet">
            <p className="small">Generate a draft from selected session sources, review it, and approve it.</p>
          </EmptyState>
        </Card>
      ) : (
        <Card>
          <div className="row-list">
            {notes.map((note) => (
              <button key={note.id} className="list-row" onClick={() => navigate(note.id)}>
                <Icon name="file" size={16} className="soft" />
                <span style={{ flex: 1 }}>
                  <strong className="small">Session {fmtDate(note.sessionDate)}{note.sessionNumber ? ` (#${note.sessionNumber})` : ''}</strong>
                  <span className="muted small" style={{ display: 'block' }}>
                    {DAP_STYLES.find((s) => s.value === note.style)?.label} · {note.generation.providerLabel} · v{note.version}
                  </span>
                </span>
                <Badge tone={statusTone(note.reviewStatus)}>{DOC_STATUS_LABELS[note.reviewStatus]}</Badge>
                <Icon name="chevron-right" size={15} className="soft" />
              </button>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
