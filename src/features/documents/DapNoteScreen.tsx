import { useEffect, useState } from 'react';
import { useNavigate, useOutletContext, useParams } from 'react-router-dom';
import { Icon } from '../../app/components/Icon';
import { Badge, Card, EmptyState, Field, Modal } from '../../app/components/ui';
import { VersionCompareModal } from '../../app/components/VersionCompareModal';
import { authService } from '../../core/auth/authService';
import {
  APPROVED_DOC_STATUSES,
  DAP_SECTIONS,
  DAP_STYLES,
  DOC_STATUS_LABELS,
  type DocSegment,
} from '../../core/db/documentSchema';
import type { VersionRecord } from '../../core/db/structuredSchema';
import { fmtDate, fmtDateTime } from '../../lib/format';
import { useDocumentsStore } from '../../state/documentsStore';
import type { ClientContext } from '../dashboard/ClientDashboardLayout';
import { ExportModal } from './ExportModal';
import { GenerationBanner, statusTone } from './docShared';
import { SegmentList } from './SegmentList';

export function DapNoteScreen() {
  const { client } = useOutletContext<ClientContext>();
  const { noteId } = useParams<{ noteId: string }>();
  const navigate = useNavigate();
  const docs = useDocumentsStore((s) => s.byClient[client.id]);
  const { loadClient, updateDapNote, decideDapNote, acknowledgeDapRisk, deleteDapNote } = useDocumentsStore();

  const note = docs?.dapNotes.find((n) => n.id === noteId);

  const [draftSegments, setDraftSegments] = useState<DocSegment[] | null>(null);
  const [comment, setComment] = useState('');
  const [error, setError] = useState<string>();
  const [showExport, setShowExport] = useState(false);
  const [compare, setCompare] = useState<VersionRecord | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [versions, setVersions] = useState<VersionRecord[]>([]);

  useEffect(() => {
    void loadClient(client.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client.id]);

  useEffect(() => {
    if (!noteId) return;
    const db = authService.current();
    if (db) void db.structured.listVersions(client.id, 'dap-note', noteId).then(setVersions);
  }, [client.id, noteId, note?.version]);

  // Autosave segment edits (draft documents only).
  useEffect(() => {
    if (!draftSegments || !note) return;
    const timer = window.setTimeout(() => {
      void updateDapNote(note.id, client.id, { segments: draftSegments }, 'Segment edits (autosave)').then(() =>
        setDraftSegments(null),
      );
    }, 800);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftSegments]);

  if (!note) {
    return (
      <Card>
        <EmptyState icon="file" title="DAP note not found">
          <button className="btn btn--secondary" onClick={() => navigate('..')}>Back to DAP notes</button>
        </EmptyState>
      </Card>
    );
  }

  const segments = draftSegments ?? note.segments;
  const isApproved = APPROVED_DOC_STATUSES.includes(note.reviewStatus);
  const editable = !isApproved && note.reviewStatus !== 'rejected' && note.reviewStatus !== 'superseded' && note.reviewStatus !== 'archived';
  const unacknowledgedRisk = segments.filter((s) => s.riskRelated && !s.riskAcknowledged).length;

  const decide = async (decision: 'approve' | 'reject' | 'archive' | 'submit-for-review' | 'needs-more-info') => {
    setError(undefined);
    try {
      await decideDapNote(note.id, client.id, decision, comment.trim() || undefined);
      setComment('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed.');
    }
  };

  return (
    <div className="stack" style={{ maxWidth: 880 }}>
      <div className="spread">
        <button className="btn btn--ghost btn--sm" onClick={() => navigate('..')}>
          <Icon name="chevron-left" size={14} /> All DAP notes
        </button>
        <div className="cluster">
          <Badge tone={statusTone(note.reviewStatus)}>{DOC_STATUS_LABELS[note.reviewStatus]}</Badge>
          <Badge tone="neutral">v{note.version}</Badge>
          {versions.length > 0 && (
            <button className="btn btn--secondary btn--sm" onClick={() => setCompare(versions[0])}>
              <Icon name="clock" size={13} /> Compare previous
            </button>
          )}
          <button className="btn btn--secondary btn--sm" onClick={() => setShowExport(true)}>
            <Icon name="download" size={13} /> Export
          </button>
          <button className="btn btn--danger btn--sm" onClick={() => setConfirmDelete(true)}>
            <Icon name="trash" size={13} /> Delete
          </button>
        </div>
      </div>

      <div>
        <h2>DAP note — session {fmtDate(note.sessionDate)}{note.sessionNumber ? ` (#${note.sessionNumber})` : ''}</h2>
        <p className="muted small">
          Style: {DAP_STYLES.find((s) => s.value === note.style)?.label} · Level of care: {note.levelOfCare}
          {note.approvedAt && <> · Approved {fmtDateTime(note.approvedAt)} by {note.reviewedBy}</>}
        </p>
      </div>

      <GenerationBanner generation={note.generation} />

      {unacknowledgedRisk > 0 && (
        <div className="notice notice--danger" role="alert">
          <Icon name="alert" size={18} />
          <span className="small">
            <strong>{unacknowledgedRisk} risk-related segment(s) require your individual confirmation.</strong>{' '}
            The note cannot be approved until each one is confirmed — bulk approval does not exist for documents.
          </span>
        </div>
      )}

      {DAP_SECTIONS.map(({ key, label }) => (
        <Card key={key} title={label} icon={key === 'data' ? 'file' : key === 'assessment' ? 'activity' : 'check'}>
          <SegmentList
            clientId={client.id}
            section={key}
            segments={segments}
            editable={editable}
            onChange={(next) => setDraftSegments(next)}
            onAcknowledgeRisk={(segmentId, note_) => void acknowledgeDapRisk(note.id, client.id, segmentId, note_)}
          />
        </Card>
      ))}

      {note.clinicianComments && (
        <Card title="Clinician comments" icon="edit">
          <p className="soft small prewrap">{note.clinicianComments}</p>
        </Card>
      )}

      {editable && (
        <Card title="Clinician review" icon="check">
          <div className="stack">
            <Field label="Comment (optional)">
              <input className="input" value={comment} onChange={(e) => setComment(e.target.value)} />
            </Field>
            {error && (
              <div className="notice notice--danger" role="alert">
                <Icon name="alert" size={16} />
                <span className="small">{error}</span>
              </div>
            )}
            <div className="cluster">
              <button className="btn btn--primary" onClick={() => void decide('approve')}>
                <Icon name="check" size={15} /> Approve
              </button>
              <button className="btn btn--secondary btn--sm" onClick={() => void decide('submit-for-review')}>
                Save as pending review
              </button>
              <button className="btn btn--secondary btn--sm" onClick={() => void decide('needs-more-info')}>
                Needs more information
              </button>
              <button className="btn btn--danger btn--sm" onClick={() => void decide('reject')}>
                <Icon name="x" size={13} /> Reject
              </button>
              <button className="btn btn--ghost btn--sm" onClick={() => void decide('archive')}>
                <Icon name="archive" size={13} /> Archive
              </button>
            </div>
            <p className="muted small">
              Draft edits autosave. Approving records your name and timestamp; the original generated
              draft is preserved unchanged either way.
            </p>
          </div>
        </Card>
      )}

      {isApproved && (
        <div className="notice notice--info">
          <Icon name="check" size={16} />
          <span className="small">
            Approved document. Editing it will reopen review and require re-approval.{' '}
            <button className="btn btn--ghost btn--sm" onClick={() => void updateDapNote(note.id, client.id, {}, 'Reopened for editing')}>
              Reopen for editing
            </button>
          </span>
        </div>
      )}

      {showExport && (
        <ExportModal
          doc={note}
          goals={docs?.goals ?? []}
          clientName={client.displayName}
          clientIdentifier={client.preferredIdentifier}
          onClose={() => setShowExport(false)}
        />
      )}
      {compare && <VersionCompareModal version={compare} current={note} onClose={() => setCompare(null)} />}
      {confirmDelete && (
        <Modal
          narrow
          title="Delete this DAP note?"
          subtitle="The note and its version history reference will be removed permanently."
          onClose={() => setConfirmDelete(false)}
        >
          <div className="modal__footer">
            <button className="btn btn--ghost" onClick={() => setConfirmDelete(false)}>Cancel</button>
            <button
              className="btn btn--danger"
              onClick={() => {
                void deleteDapNote(note.id, client.id).then(() => navigate('..'));
              }}
            >
              <Icon name="trash" size={14} /> Delete permanently
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
