import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon } from '../../app/components/Icon';
import { Badge, Card, EmptyState, Field } from '../../app/components/ui';
import { ImportRefusedError, type ImportPreview } from '../../core/interop/importPreview';
import {
  ExportRefusedError,
  renderAssessmentCsv,
  renderPortableMarkdown,
} from '../../core/interop/portableRecord';
import { downloadJson, downloadText } from '../../lib/download';
import { useAuthStore } from '../../state/authStore';
import { useDataStore } from '../../state/dataStore';
import { useInteropStore } from '../../state/interopStore';

function fileStem(name: string): string {
  return name.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'client';
}

// --------------------------------------------------------------- export

function ExportPanel() {
  const clients = useDataStore((s) => s.clients);
  const loadAll = useDataStore((s) => s.loadAll);
  const buildExport = useInteropStore((s) => s.buildExport);

  const [clientId, setClientId] = useState('');
  const [acknowledged, setAcknowledged] = useState(false);
  const [includeLocalOnly, setIncludeLocalOnly] = useState(false);
  const [purpose, setPurpose] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [result, setResult] = useState<string>();

  useEffect(() => {
    if (clients.length === 0) void loadAll();
  }, [clients.length, loadAll]);

  const client = clients.find((c) => c.id === clientId);

  const run = async (format: 'json' | 'markdown' | 'csv') => {
    setError(undefined);
    setResult(undefined);
    if (!client) {
      setError('Choose a client to export.');
      return;
    }
    setBusy(true);
    try {
      const record = await buildExport(client.id, acknowledged, {
        includeLocalOnly,
        purpose: purpose.trim() || undefined,
      });
      const stem = `cockpit-${fileStem(client.displayName)}-${new Date().toISOString().slice(0, 10)}`;
      if (format === 'json') downloadJson(`${stem}.json`, record);
      if (format === 'markdown') downloadText(`${stem}.md`, renderPortableMarkdown(record));
      if (format === 'csv') downloadText(`${stem}-assessments.csv`, renderAssessmentCsv(record));
      setResult(
        `Exported ${record.counts.clinicalInputs} clinical input(s), ${record.counts.facts} fact(s), ` +
          `${record.counts.assessments} assessment(s), ${record.counts.hypotheses} hypothesis(es).` +
          (record.counts.localOnlyExcluded > 0
            ? ` ${record.counts.localOnlyExcluded} local-only record(s) excluded.`
            : ''),
      );
    } catch (e) {
      setError(
        e instanceof ExportRefusedError ? e.message : `Export failed: ${(e as Error).message}`,
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title="Export a client record" icon="download">
      <div className="stack-sm">
        <p className="notice notice--warn" style={{ margin: 0 }}>
          <Icon name="alert" size={14} /> An exported file is <strong>not encrypted</strong>. It
          contains clinical information in plain text. Handle it according to your confidentiality
          and records obligations, and delete it when it is no longer needed.
        </p>

        <Field label="Client" required>
          <select value={clientId} onChange={(e) => setClientId(e.target.value)}>
            <option value="">Choose a client…</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.displayName}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Purpose (recorded in the file)" hint="For example: transfer of care, clinician's own records.">
          <input value={purpose} onChange={(e) => setPurpose(e.target.value)} placeholder="Optional" />
        </Field>

        <label className="cluster" style={{ gap: 8, alignItems: 'flex-start' }}>
          <input
            type="checkbox"
            checked={includeLocalOnly}
            onChange={(e) => setIncludeLocalOnly(e.target.checked)}
          />
          <span className="small">
            Include records marked <strong>local-only</strong>. These are excluded by default because
            they were marked never to leave this device.
          </span>
        </label>

        <label className="cluster" style={{ gap: 8, alignItems: 'flex-start' }}>
          <input
            type="checkbox"
            checked={acknowledged}
            onChange={(e) => setAcknowledged(e.target.checked)}
          />
          <span className="small">
            I understand this file is unencrypted plain text and I am responsible for how it is
            stored and shared.
          </span>
        </label>

        <div className="cluster">
          <button className="btn btn--primary btn--sm" disabled={busy} onClick={() => void run('json')}>
            <Icon name="download" size={13} /> Export portable JSON
          </button>
          <button className="btn btn--secondary btn--sm" disabled={busy} onClick={() => void run('markdown')}>
            <Icon name="file" size={13} /> Export readable Markdown
          </button>
          <button className="btn btn--secondary btn--sm" disabled={busy} onClick={() => void run('csv')}>
            <Icon name="activity" size={13} /> Export assessment scores (CSV)
          </button>
        </div>

        {error && (
          <p className="notice notice--warn" role="alert" style={{ margin: 0 }}>
            {error}
          </p>
        )}
        {result && (
          <p className="notice" style={{ margin: 0 }} role="status">
            {result}
          </p>
        )}

        <p className="muted small" style={{ margin: 0 }}>
          Attachment files are never included — only their names, type and size. Encryption keys,
          passphrases, provider API keys and model prompts are never included.
        </p>
      </div>
    </Card>
  );
}

// --------------------------------------------------------------- import

function PreviewTable({ preview }: { preview: ImportPreview }) {
  const groups = useMemo(() => {
    const byKind = new Map<string, typeof preview.rows>();
    for (const row of preview.rows) {
      const list = byKind.get(row.kind) ?? [];
      list.push(row);
      byKind.set(row.kind, list);
    }
    return [...byKind.entries()];
  }, [preview]);

  return (
    <div className="stack-sm">
      {groups.map(([kind, rows]) => (
        <div key={kind}>
          <strong className="small">
            {kind} ({rows.length})
          </strong>
          <ul className="stack-sm" style={{ margin: '6px 0 0', paddingLeft: 18 }}>
            {rows.map((row, i) => (
              <li key={`${kind}-${i}`}>
                <span>{row.label}</span>
                {row.detail && <span className="muted small"> — {row.detail}</span>}{' '}
                {row.riskFlagged && (
                  <Badge tone="red" icon="alert">
                    Risk content
                  </Badge>
                )}{' '}
                {row.incomingStatus && row.resultingStatus && row.incomingStatus !== row.resultingStatus && (
                  <Badge tone="amber" icon="shield">
                    {row.incomingStatus} → {row.resultingStatus}
                  </Badge>
                )}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

function ImportPanel() {
  const navigate = useNavigate();
  const profileName = useAuthStore((s) => s.profileName);
  const preview = useInteropStore((s) => s.preview);
  const lastImport = useInteropStore((s) => s.lastImport);
  const loadImportFile = useInteropStore((s) => s.loadImportFile);
  const applyImport = useInteropStore((s) => s.applyImport);
  const reset = useInteropStore((s) => s.reset);

  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [acknowledgedNeedsReview, setAcknowledgedNeedsReview] = useState(false);
  const [acknowledgedRisk, setAcknowledgedRisk] = useState<string[]>([]);
  const [clinician, setClinician] = useState('');

  useEffect(() => {
    if (profileName) setClinician(profileName);
  }, [profileName]);

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setError(undefined);
    setAcknowledgedNeedsReview(false);
    setAcknowledgedRisk([]);
    setBusy(true);
    try {
      await loadImportFile(await file.text());
    } catch (e) {
      reset();
      setError(
        e instanceof ImportRefusedError ? e.message : `Could not read this file: ${(e as Error).message}`,
      );
    } finally {
      setBusy(false);
    }
  };

  const toggleRisk = (label: string) =>
    setAcknowledgedRisk((prev) =>
      prev.includes(label) ? prev.filter((l) => l !== label) : [...prev, label],
    );

  const doImport = async () => {
    if (!preview) return;
    setError(undefined);
    setBusy(true);
    try {
      const { clientId } = await applyImport({
        token: preview.token,
        confirmedByClinician: clinician,
        acknowledgedNeedsReview,
        acknowledgedRiskRows: acknowledgedRisk,
      });
      navigate(`/clients/${clientId}/review`);
    } catch (e) {
      setError(
        e instanceof ImportRefusedError ? e.message : `Import failed: ${(e as Error).message}`,
      );
    } finally {
      setBusy(false);
    }
  };

  const outstandingRisk = preview
    ? preview.riskRowsRequiringAcknowledgement.filter((l) => !acknowledgedRisk.includes(l)).length
    : 0;

  return (
    <Card title="Import a client record" icon="upload">
      <div className="stack-sm">
        <p className="muted small" style={{ margin: 0 }}>
          Importing always creates a <strong>new</strong> client. It never merges into, or
          overwrites, an existing record. Nothing is written until you confirm the preview below.
        </p>

        <Field label="Portable JSON file" hint="A file produced by Cockpit's portable export.">
          <input
            type="file"
            accept="application/json,.json"
            onChange={(e) => void onFile(e.target.files?.[0])}
          />
        </Field>

        {error && (
          <p className="notice notice--warn" role="alert" style={{ margin: 0 }}>
            {error}
          </p>
        )}

        {!preview && !error && lastImport && (
          <p className="notice" role="status" style={{ margin: 0 }}>
            Imported <strong>{lastImport.displayName}</strong>. Every imported record is pending
            review.{' '}
            <button className="btn btn--ghost btn--sm" onClick={() => navigate(`/clients/${lastImport.clientId}/review`)}>
              Open review queue
            </button>
          </p>
        )}

        {preview && (
          <>
            <div className="cluster" style={{ gap: 6, flexWrap: 'wrap' }}>
              <Badge tone="blue">{preview.counts.clinicalInputs} clinical inputs</Badge>
              <Badge tone="blue">{preview.counts.facts} facts</Badge>
              <Badge tone="blue">{preview.counts.assessments} assessments</Badge>
              <Badge tone="blue">{preview.counts.hypotheses} hypotheses</Badge>
              {preview.counts.riskFlagged > 0 && (
                <Badge tone="red" icon="alert">
                  {preview.counts.riskFlagged} risk-flagged
                </Badge>
              )}
            </div>

            {preview.warnings.map((w, i) => (
              <p key={i} className="notice notice--warn" style={{ margin: 0 }}>
                <Icon name="alert" size={13} /> {w}
              </p>
            ))}

            {preview.dropped.length > 0 && (
              <div>
                <strong className="small">Will not be imported</strong>
                <ul className="muted small" style={{ margin: '6px 0 0', paddingLeft: 18 }}>
                  {preview.dropped.map((d, i) => (
                    <li key={i}>
                      {d.kind} “{d.label}” — {d.reason}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <PreviewTable preview={preview} />

            {preview.riskRowsRequiringAcknowledgement.length > 0 && (
              <div className="stack-sm">
                <strong className="small">
                  Risk-flagged records — acknowledge each one individually
                </strong>
                {preview.riskRowsRequiringAcknowledgement.map((label) => (
                  <label key={label} className="cluster" style={{ gap: 8, alignItems: 'flex-start' }}>
                    <input
                      type="checkbox"
                      checked={acknowledgedRisk.includes(label)}
                      onChange={() => toggleRisk(label)}
                    />
                    <span className="small">{label}</span>
                  </label>
                ))}
              </div>
            )}

            <Field label="Confirmed by" required>
              <input value={clinician} onChange={(e) => setClinician(e.target.value)} />
            </Field>

            <label className="cluster" style={{ gap: 8, alignItems: 'flex-start' }}>
              <input
                type="checkbox"
                checked={acknowledgedNeedsReview}
                onChange={(e) => setAcknowledgedNeedsReview(e.target.checked)}
              />
              <span className="small">
                I understand that review status from the source workspace does not carry over, and
                that every imported record will be pending my review here.
              </span>
            </label>

            {outstandingRisk > 0 && (
              <p className="muted small" style={{ margin: 0 }}>
                {outstandingRisk} risk-flagged record(s) still need acknowledgement.
              </p>
            )}

            <div className="cluster">
              <button className="btn btn--primary btn--sm" disabled={busy} onClick={() => void doImport()}>
                <Icon name="check" size={13} /> Import {preview.counts.clinicalInputs +
                  preview.counts.facts +
                  preview.counts.assessments +
                  preview.counts.hypotheses}{' '}
                record(s)
              </button>
              <button className="btn btn--ghost btn--sm" disabled={busy} onClick={() => { reset(); setError(undefined); }}>
                Cancel
              </button>
            </div>
          </>
        )}

        {!preview && !error && !lastImport && (
          <EmptyState icon="upload" title="No file loaded">
            <span className="muted small">
              Choose a portable JSON file to see exactly what would be imported.
            </span>
          </EmptyState>
        )}
      </div>
    </Card>
  );
}

// --------------------------------------------------------------- screen

export function InteropScreen() {
  const navigate = useNavigate();
  return (
    <main id="main-content" tabIndex={-1} className="page">
      <div className="stack" style={{ maxWidth: 880, margin: '0 auto' }}>
        <div className="spread">
          <button className="btn btn--ghost btn--sm" onClick={() => navigate('/')}>
            <Icon name="chevron-left" size={15} /> Choose Client
          </button>
        </div>

        <div>
          <h1>Import &amp; export</h1>
          <p className="muted" style={{ marginTop: 4 }}>
            Move one client's record between Cockpit workspaces, or produce a readable copy for a
            clinician who does not run Cockpit.
          </p>
        </div>

        <ExportPanel />
        <ImportPanel />
      </div>
    </main>
  );
}
