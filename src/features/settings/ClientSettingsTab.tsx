import { useState } from 'react';
import { useNavigate, useOutletContext } from 'react-router-dom';
import { Icon } from '../../app/components/Icon';
import { Card, Field, Modal } from '../../app/components/ui';
import { fmtDateTime } from '../../lib/format';
import { useDataStore } from '../../state/dataStore';
import { downloadJson } from '../../lib/download';
import { ClientFormModal } from '../clients/ClientFormModal';
import type { ClientContext } from '../dashboard/ClientDashboardLayout';

export function ClientSettingsTab() {
  const { client } = useOutletContext<ClientContext>();
  const navigate = useNavigate();
  const { updateClient, setClientArchived, deleteClient, exportClientRecord } = useDataStore();

  const [showEdit, setShowEdit] = useState(false);
  const [showExportWarning, setShowExportWarning] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [busy, setBusy] = useState(false);

  const doExport = async () => {
    setBusy(true);
    const record = await exportClientRecord(client.id);
    downloadJson(`cockpit-client-${client.displayName.replace(/\s+/g, '_')}.json`, record);
    setBusy(false);
    setShowExportWarning(false);
  };

  const doDelete = async () => {
    setBusy(true);
    await deleteClient(client.id);
    navigate('/');
  };

  return (
    <div className="stack" style={{ maxWidth: 720 }}>
      <Card
        title="Client details"
        icon="user"
        action={
          <button className="btn btn--secondary btn--sm" onClick={() => setShowEdit(true)}>
            <Icon name="edit" size={14} /> Edit details
          </button>
        }
      >
        <dl className="kv">
          <dt>Name / initials</dt>
          <dd>{client.displayName}</dd>
          <dt>Identifier</dt>
          <dd>{client.preferredIdentifier ?? '—'}</dd>
          <dt>Created</dt>
          <dd>{fmtDateTime(client.createdAt)}</dd>
          <dt>Last updated</dt>
          <dd>{fmtDateTime(client.updatedAt)}</dd>
          {client.contactEnabled && client.contact && (
            <>
              <dt>Phone</dt>
              <dd>{client.contact.phone ?? '—'}</dd>
              <dt>Email</dt>
              <dd>{client.contact.email ?? '—'}</dd>
              <dt>Emergency contact</dt>
              <dd>{client.contact.emergencyContact ?? '—'}</dd>
            </>
          )}
        </dl>
      </Card>

      <Card title="Export" icon="download">
        <div className="spread">
          <div>
            <strong className="small">Export client record (JSON)</strong>
            <p className="muted small">
              Full record including inputs and change history, decrypted for use outside Cockpit.
            </p>
          </div>
          <button className="btn btn--secondary btn--sm" onClick={() => setShowExportWarning(true)}>
            <Icon name="download" size={14} /> Export…
          </button>
        </div>
      </Card>

      <Card title="Archive & deletion" icon="archive">
        <div className="stack">
          <div className="spread">
            <div>
              <strong className="small">{client.archived ? 'Restore from archive' : 'Archive client'}</strong>
              <p className="muted small">
                {client.archived
                  ? 'Returns the client to the active list.'
                  : 'Hides the client from the active list. Nothing is deleted.'}
              </p>
            </div>
            <button
              className="btn btn--secondary btn--sm"
              disabled={busy}
              onClick={() => void setClientArchived(client.id, !client.archived)}
            >
              <Icon name="archive" size={14} /> {client.archived ? 'Restore' : 'Archive'}
            </button>
          </div>
          <hr className="divider" style={{ margin: 0 }} />
          <div className="spread">
            <div>
              <strong className="small" style={{ color: 'var(--red)' }}>Delete client permanently</strong>
              <p className="muted small">
                Securely removes the client, every clinical input, all attachments, and the change
                history from the encrypted store.
              </p>
            </div>
            <button className="btn btn--danger btn--sm" onClick={() => setShowDelete(true)}>
              <Icon name="trash" size={14} /> Delete…
            </button>
          </div>
        </div>
      </Card>

      {showEdit && (
        <ClientFormModal
          existing={client}
          onClose={() => setShowEdit(false)}
          onSave={async (draft) => {
            await updateClient(client.id, draft, 'Client details edited');
          }}
        />
      )}

      {showExportWarning && (
        <Modal
          narrow
          title="Export unencrypted record?"
          subtitle="The exported file is NOT encrypted. It will contain everything documented about this client. Store and transmit it according to your confidentiality obligations and organizational policy."
          onClose={() => setShowExportWarning(false)}
        >
          <div className="modal__footer">
            <button className="btn btn--ghost" onClick={() => setShowExportWarning(false)}>Cancel</button>
            <button className="btn btn--primary" disabled={busy} onClick={() => void doExport()}>
              <Icon name="download" size={15} /> I understand — export
            </button>
          </div>
        </Modal>
      )}

      {showDelete && (
        <Modal
          narrow
          title={`Delete ${client.displayName}?`}
          subtitle="This permanently removes the client and all associated records. It cannot be undone. Consider exporting the record first if your retention policy requires it."
          onClose={() => { setShowDelete(false); setDeleteConfirmText(''); }}
        >
          <Field label={`Type "${client.displayName}" to confirm`}>
            <input
              className="input"
              value={deleteConfirmText}
              onChange={(e) => setDeleteConfirmText(e.target.value)}
            />
          </Field>
          <div className="modal__footer">
            <button className="btn btn--ghost" onClick={() => { setShowDelete(false); setDeleteConfirmText(''); }}>
              Cancel
            </button>
            <button
              className="btn btn--danger"
              disabled={busy || deleteConfirmText !== client.displayName}
              onClick={() => void doDelete()}
            >
              <Icon name="trash" size={15} /> Delete permanently
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
