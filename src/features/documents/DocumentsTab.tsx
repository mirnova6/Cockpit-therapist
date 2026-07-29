import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useOutletContext } from 'react-router-dom';
import { Icon } from '../../app/components/Icon';
import { Badge, Card, EmptyState } from '../../app/components/ui';
import {
  APPROVED_DOC_STATUSES,
  DOC_STATUS_LABELS,
  type DapNote,
  type TreatmentPlanDoc,
} from '../../core/db/documentSchema';
import { fmtDate, relTime } from '../../lib/format';
import { useDocumentsStore } from '../../state/documentsStore';
import type { ClientContext } from '../dashboard/ClientDashboardLayout';
import { ExportModal } from './ExportModal';
import { statusTone } from './docShared';

type AnyDoc = (DapNote & { docType: 'dap' }) | (TreatmentPlanDoc & { docType: 'plan' });

export function DocumentsTab() {
  const { client } = useOutletContext<ClientContext>();
  const navigate = useNavigate();
  const docs = useDocumentsStore((s) => s.byClient[client.id]);
  const loadClient = useDocumentsStore((s) => s.loadClient);
  const [statusFilter, setStatusFilter] = useState<'all' | 'approved' | 'draft'>('all');
  const [exporting, setExporting] = useState<AnyDoc | null>(null);

  useEffect(() => {
    void loadClient(client.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client.id]);

  const all = useMemo((): AnyDoc[] => {
    const notes = (docs?.dapNotes ?? []).map((n) => ({ ...n, docType: 'dap' as const }));
    const plans = (docs?.plans ?? []).map((p) => ({ ...p, docType: 'plan' as const }));
    return [...notes, ...plans].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }, [docs]);

  const visible = all.filter((doc) => {
    if (statusFilter === 'approved') return APPROVED_DOC_STATUSES.includes(doc.reviewStatus);
    if (statusFilter === 'draft') return !APPROVED_DOC_STATUSES.includes(doc.reviewStatus);
    return true;
  });

  return (
    <div className="stack">
      <div className="spread">
        <div>
          <h2>Documents</h2>
          <p className="muted small">
            All clinical documents for {client.displayName}. Only approved documents can be exported
            without a draft watermark.
          </p>
        </div>
        <select className="select" style={{ width: 'auto' }} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)} aria-label="Filter documents">
          <option value="all">All documents</option>
          <option value="approved">Approved only</option>
          <option value="draft">Drafts &amp; other</option>
        </select>
      </div>

      {visible.length === 0 ? (
        <Card>
          <EmptyState icon="file" title="No documents">
            <p className="small">DAP notes and treatment plans appear here as you create them.</p>
          </EmptyState>
        </Card>
      ) : (
        <Card>
          <div className="row-list">
            {visible.map((doc) => (
              <div key={doc.id} className="list-row" style={{ cursor: 'default' }}>
                <Icon name={doc.docType === 'dap' ? 'file' : 'clipboard'} size={16} className="soft" />
                <button
                  className="list-row"
                  style={{ flex: 1, padding: 0 }}
                  onClick={() => navigate(doc.docType === 'dap' ? `../dap/${doc.id}` : `../plan/${doc.id}`)}
                >
                  <span>
                    <strong className="small">
                      {doc.docType === 'dap'
                        ? `DAP note — session ${fmtDate((doc as DapNote).sessionDate)}`
                        : `Treatment plan — ${fmtDate((doc as TreatmentPlanDoc).planDate)}`}
                    </strong>
                    <span className="muted small" style={{ display: 'block' }}>
                      {doc.generation.providerLabel} · v{doc.version} · updated {relTime(doc.updatedAt)}
                    </span>
                  </span>
                </button>
                <Badge tone={statusTone(doc.reviewStatus)}>{DOC_STATUS_LABELS[doc.reviewStatus]}</Badge>
                <button className="btn btn--secondary btn--sm" onClick={() => setExporting(doc)}>
                  <Icon name="download" size={13} /> Export
                </button>
              </div>
            ))}
          </div>
        </Card>
      )}

      {exporting && (
        <ExportModal
          doc={exporting}
          goals={docs?.goals ?? []}
          clientName={client.displayName}
          clientIdentifier={client.preferredIdentifier}
          onClose={() => setExporting(null)}
        />
      )}
    </div>
  );
}
