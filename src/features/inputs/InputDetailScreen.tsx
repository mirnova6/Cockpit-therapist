import { useState } from 'react';
import { useNavigate, useOutletContext, useParams } from 'react-router-dom';
import { Icon } from '../../app/components/Icon';
import { Badge, Card, EmptyState, Field, Modal } from '../../app/components/ui';
import { authService } from '../../core/auth/authService';
import { inputTypeLabel, REPORTED_BY_OPTIONS } from '../../core/db/schema';
import { downloadBytes } from '../../lib/download';
import { fmtDate, fmtDateTime, formatBytes } from '../../lib/format';
import { useDataStore } from '../../state/dataStore';
import type { ClientContext } from '../dashboard/ClientDashboardLayout';

export function InputDetailScreen() {
  const { client } = useOutletContext<ClientContext>();
  const { inputId } = useParams<{ inputId: string }>();
  const navigate = useNavigate();
  const inputs = useDataStore((s) => s.inputs[client.id]) ?? [];
  const { updateInput, markRiskReviewed, deleteInput } = useDataStore();

  const input = inputs.find((i) => i.id === inputId);

  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState('');
  const [reviewNote, setReviewNote] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);

  if (!input) {
    return (
      <Card>
        <EmptyState icon="file" title="Entry not found">
          <button className="btn btn--secondary" onClick={() => navigate('../inputs')}>
            Back to clinical inputs
          </button>
        </EmptyState>
      </Card>
    );
  }

  const reportedLabel =
    REPORTED_BY_OPTIONS.find((o) => o.value === input.reportedBy)?.label ?? input.reportedBy;

  const startEdit = () => {
    setEditText(input.rawText);
    setEditing(true);
  };

  const saveEdit = async () => {
    setBusy(true);
    await updateInput(
      input.id,
      { rawText: editText },
      `Edited text of ${inputTypeLabel(input.inputType).toLowerCase()} dated ${fmtDate(input.dateOfInformation)}`,
    );
    setEditing(false);
    setBusy(false);
  };

  const review = async () => {
    setBusy(true);
    await markRiskReviewed(input.id, reviewNote.trim() || undefined);
    setReviewNote('');
    setBusy(false);
  };

  const downloadAttachment = async (blobId: string, name: string, mimeType: string) => {
    const db = authService.current();
    if (!db) return;
    const bytes = await db.getAttachmentBytes(blobId);
    if (bytes) downloadBytes(name, bytes, mimeType);
  };

  const remove = async () => {
    setBusy(true);
    await deleteInput(input.id);
    navigate('../inputs');
  };

  return (
    <div className="stack" style={{ maxWidth: 840 }}>
      <div className="spread">
        <button className="btn btn--ghost btn--sm" onClick={() => navigate('../inputs')}>
          <Icon name="chevron-left" size={15} /> All inputs
        </button>
        <div className="cluster">
          {!editing && (
            <button className="btn btn--secondary btn--sm" onClick={startEdit}>
              <Icon name="edit" size={14} /> Edit text
            </button>
          )}
          <button className="btn btn--secondary btn--sm" onClick={() => void updateInput(input.id, { archived: !input.archived }, input.archived ? 'Entry restored from archive' : 'Entry archived')}>
            <Icon name="archive" size={14} /> {input.archived ? 'Restore' : 'Archive'}
          </button>
          <button className="btn btn--danger btn--sm" onClick={() => setConfirmDelete(true)}>
            <Icon name="trash" size={14} /> Delete
          </button>
        </div>
      </div>

      {input.containsRisk && !input.riskReview && (
        <div className="card card--pad" style={{ borderColor: 'var(--red)', background: '#fdfaf9' }}>
          <div className="card__title" style={{ color: 'var(--red)', marginBottom: 10 }}>
            <Icon name="alert" size={15} /> Risk review required
          </div>
          <p className="soft small" style={{ marginBottom: 12 }}>
            This entry was flagged as containing risk information. Review the content below,
            complete or confirm a structured risk assessment per your protocol, and record your
            disposition. The app does not make risk determinations for you.
          </p>
          <div className="stack-sm">
            <Field label="Clinical response / disposition note" hint="e.g. C-SSRS administered, safety plan reviewed, supervisor consulted.">
              <textarea className="textarea" style={{ minHeight: 80 }} value={reviewNote} onChange={(e) => setReviewNote(e.target.value)} />
            </Field>
            <div className="cluster">
              <button className="btn btn--primary btn--sm" disabled={busy} onClick={() => void review()}>
                <Icon name="check" size={14} /> Mark reviewed
              </button>
              <span className="muted small">Recorded with your name and timestamp.</span>
            </div>
          </div>
        </div>
      )}

      {input.containsRisk && input.riskReview && (
        <div className="notice notice--warn">
          <Icon name="shield" size={18} />
          <span className="small">
            <strong>Risk content — reviewed</strong> by {input.riskReview.reviewedBy} on{' '}
            {fmtDateTime(input.riskReview.reviewedAt)}.
            {input.riskReview.note && <span style={{ display: 'block' }}>“{input.riskReview.note}”</span>}
          </span>
        </div>
      )}

      <Card
        title={inputTypeLabel(input.inputType)}
        icon="file"
        action={
          <div className="cluster" style={{ gap: 6 }}>
            {input.archived && <Badge tone="neutral" icon="archive">Archived</Badge>}
            <Badge tone="green" icon="shield">Local-only</Badge>
            <Badge tone="neutral">v{input.version}</Badge>
          </div>
        }
      >
        <dl className="kv" style={{ marginBottom: 16 }}>
          <dt>Date of information</dt>
          <dd>{fmtDate(input.dateOfInformation)}</dd>
          {input.sessionDate && (
            <>
              <dt>Session date</dt>
              <dd>{fmtDate(input.sessionDate)}{input.sessionNumber != null ? ` (session ${input.sessionNumber})` : ''}</dd>
            </>
          )}
          <dt>Entered</dt>
          <dd>{fmtDateTime(input.dateEntered)}</dd>
          <dt>Author / source</dt>
          <dd>{input.authorSource}</dd>
          <dt>Reported by</dt>
          <dd>{reportedLabel}</dd>
          <dt>AI analysis consent</dt>
          <dd>{input.allowAiAnalysis ? 'Allowed (pipeline ships in a later phase)' : 'Excluded from AI analysis'}</dd>
          {input.updatedAt !== input.dateEntered && (
            <>
              <dt>Last edited</dt>
              <dd>{fmtDateTime(input.updatedAt)}</dd>
            </>
          )}
        </dl>

        {editing ? (
          <div className="stack-sm">
            <textarea className="textarea" style={{ minHeight: 260 }} value={editText} onChange={(e) => setEditText(e.target.value)} />
            <div className="cluster">
              <button className="btn btn--primary btn--sm" disabled={busy} onClick={() => void saveEdit()}>
                Save changes (v{input.version + 1})
              </button>
              <button className="btn btn--ghost btn--sm" onClick={() => setEditing(false)}>Cancel</button>
            </div>
          </div>
        ) : input.rawText ? (
          <p className="prewrap soft" style={{ lineHeight: 1.7 }}>{input.rawText}</p>
        ) : (
          <p className="muted">No text content — see attachments.</p>
        )}
      </Card>

      {input.attachments.length > 0 && (
        <Card title="Attachments" icon="file">
          <div className="row-list">
            {input.attachments.map((a) => (
              <div key={a.id} className="list-row" style={{ cursor: 'default' }}>
                <Icon name="file" size={16} className="soft" />
                <span style={{ flex: 1 }} className="small soft">{a.name}</span>
                <span className="muted small">{formatBytes(a.size)}</span>
                <button
                  className="btn btn--secondary btn--sm"
                  onClick={() => void downloadAttachment(a.id, a.name, a.mimeType)}
                >
                  <Icon name="download" size={14} /> Download
                </button>
              </div>
            ))}
          </div>
        </Card>
      )}

      {confirmDelete && (
        <Modal
          narrow
          title="Delete this entry?"
          subtitle="The entry and its attachments will be permanently removed from the encrypted store. This cannot be undone."
          onClose={() => setConfirmDelete(false)}
        >
          <div className="modal__footer">
            <button className="btn btn--ghost" onClick={() => setConfirmDelete(false)}>Cancel</button>
            <button className="btn btn--danger" disabled={busy} onClick={() => void remove()}>
              <Icon name="trash" size={15} /> Delete permanently
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
