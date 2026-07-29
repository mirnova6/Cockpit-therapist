import { useState } from 'react';
import { Icon } from '../../app/components/Icon';
import { Field, Modal } from '../../app/components/ui';
import type { DapNote, TreatmentGoal, TreatmentPlanDoc } from '../../core/db/documentSchema';
import {
  isApprovedDoc,
  renderDapText,
  renderDocJson,
  renderPlanText,
  renderPrintHtml,
  type ExportOptions,
} from '../../core/documents/exportService';
import { downloadJson } from '../../lib/download';
import { useAuthStore } from '../../state/authStore';
import { useDocumentsStore } from '../../state/documentsStore';

export function ExportModal({
  doc,
  goals,
  clientName,
  clientIdentifier,
  onClose,
}: {
  doc: DapNote | TreatmentPlanDoc;
  goals: TreatmentGoal[];
  clientName: string;
  clientIdentifier?: string;
  onClose: () => void;
}) {
  const clinician = useAuthStore((s) => s.profileName) ?? 'Clinician';
  const auditExport = useDocumentsStore((s) => s.auditExport);
  const approved = isApprovedDoc(doc);
  const isDap = 'sessionDate' in doc;

  const [identifierMode, setIdentifierMode] = useState<'name' | 'initials' | 'chart'>('name');
  const [includeClinician, setIncludeClinician] = useState(true);
  const [includeRefs, setIncludeRefs] = useState(false);
  const [includeVersion, setIncludeVersion] = useState(true);
  const [confirmed, setConfirmed] = useState(false);
  const [message, setMessage] = useState<string>();

  const identifier =
    identifierMode === 'name'
      ? clientName
      : identifierMode === 'initials'
        ? clientName
            .split(/\s+/)
            .map((p) => p[0])
            .join('.')
            .toUpperCase() + '.'
        : clientIdentifier || clientName;

  const opts: ExportOptions = {
    clientIdentifier: identifier,
    clinicianName: includeClinician ? clinician : undefined,
    includeEvidenceRefs: includeRefs,
    includeVersionInfo: includeVersion,
  };

  const text = isDap ? renderDapText(doc as DapNote, opts) : renderPlanText(doc as TreatmentPlanDoc, goals, opts);
  const title = isDap
    ? `DAP note — ${(doc as DapNote).sessionDate}`
    : `Treatment plan — ${(doc as TreatmentPlanDoc).planDate}`;

  const doExport = async (kind: 'copy' | 'text' | 'json' | 'print') => {
    if (kind === 'print') {
      // Print preview is available for drafts too, always watermarked.
      const html = renderPrintHtml(text, title, !approved);
      const win = window.open('', '_blank');
      if (win) {
        win.document.write(html);
        win.document.close();
        win.focus();
      }
      await auditExport(doc.clientId, `${title} (print preview${approved ? '' : ', DRAFT watermark'})`);
      setMessage('Print preview opened. Use the browser print dialog for paper or PDF.');
      return;
    }
    if (!approved) return;
    if (kind === 'copy') {
      await navigator.clipboard.writeText(text);
      setMessage('Copied to clipboard.');
    } else if (kind === 'text') {
      const blob = new Blob([text], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${title.replace(/[^\w-]+/g, '_')}.txt`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      setMessage('Plain-text file downloaded.');
    } else {
      downloadJson(`${title.replace(/[^\w-]+/g, '_')}.json`, renderDocJson(doc, goals, opts));
      setMessage('Structured JSON downloaded.');
    }
    await auditExport(doc.clientId, `${title} (${kind})`);
  };

  return (
    <Modal
      title={`Export — ${title}`}
      subtitle={
        approved
          ? 'Exports are unencrypted. Handle according to your confidentiality obligations.'
          : 'This document is NOT approved. Only a watermarked print preview is available; approve the document to enable export.'
      }
      onClose={onClose}
    >
      <div className="stack">
        <div className="form-grid">
          <Field label="Client identifier format">
            <select className="select" value={identifierMode} onChange={(e) => setIdentifierMode(e.target.value as typeof identifierMode)}>
              <option value="name">Name as recorded ({clientName})</option>
              <option value="initials">Initials only</option>
              <option value="chart">Chart identifier{clientIdentifier ? ` (${clientIdentifier})` : ' (falls back to name)'}</option>
            </select>
          </Field>
        </div>
        <div className="cluster">
          <label className="chip"><input type="checkbox" checked={includeClinician} onChange={(e) => setIncludeClinician(e.target.checked)} style={{ accentColor: 'var(--brand)' }} /> Clinician name</label>
          <label className="chip"><input type="checkbox" checked={includeRefs} onChange={(e) => setIncludeRefs(e.target.checked)} style={{ accentColor: 'var(--brand)' }} /> Evidence references</label>
          <label className="chip"><input type="checkbox" checked={includeVersion} onChange={(e) => setIncludeVersion(e.target.checked)} style={{ accentColor: 'var(--brand)' }} /> Version info</label>
        </div>

        <div className="card card--pad" style={{ maxHeight: 240, overflowY: 'auto', background: 'var(--surface-2)' }}>
          <pre className="small prewrap" style={{ margin: 0, fontFamily: 'inherit' }}>{text.slice(0, 2500)}{text.length > 2500 ? '\n…' : ''}</pre>
        </div>

        {approved && (
          <label className="checkbox-row checkbox-row--risk">
            <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
            <span className="small">
              I understand this export is unencrypted and I am responsible for handling it securely.
            </span>
          </label>
        )}

        {message && (
          <div className="notice notice--info" role="status">
            <Icon name="check" size={15} />
            <span className="small">{message}</span>
          </div>
        )}

        <div className="cluster">
          <button className="btn btn--secondary btn--sm" onClick={() => void doExport('print')}>
            <Icon name="eye" size={13} /> Print view / PDF
          </button>
          <button className="btn btn--secondary btn--sm" disabled={!approved || !confirmed} onClick={() => void doExport('copy')}>
            <Icon name="clipboard" size={13} /> Copy to clipboard
          </button>
          <button className="btn btn--secondary btn--sm" disabled={!approved || !confirmed} onClick={() => void doExport('text')}>
            <Icon name="download" size={13} /> Plain text
          </button>
          <button className="btn btn--secondary btn--sm" disabled={!approved || !confirmed} onClick={() => void doExport('json')}>
            <Icon name="download" size={13} /> Structured JSON
          </button>
        </div>

        <div className="modal__footer">
          <button className="btn btn--ghost" onClick={onClose}>Close</button>
        </div>
      </div>
    </Modal>
  );
}
