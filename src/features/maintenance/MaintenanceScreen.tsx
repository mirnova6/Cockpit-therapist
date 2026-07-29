import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon } from '../../app/components/Icon';
import { Badge, Card, EmptyState, Field, type BadgeTone } from '../../app/components/ui';
import {
  CLOSED_STATUSES,
  FEEDBACK_CATEGORIES,
  FEEDBACK_PRIORITIES,
  FEEDBACK_SEVERITIES,
  FEEDBACK_STATUSES,
  REPRODUCIBILITY,
  type FeedbackCategory,
  type FeedbackPriority,
  type FeedbackSeverity,
  type FeedbackStatus,
  type Reproducibility,
} from '../../core/beta/feedbackTriage';
import { DiagnosticExportRefusedError } from '../../core/observability/diagnostics';
import { MigrationError } from '../../core/storage/migrations';
import { runtimeEnvironment } from '../../core/platform/platform';
import { buildInfo } from '../../core/release/buildInfo';
import { downloadJson } from '../../lib/download';
import { fmtDateTime } from '../../lib/format';
import { useMaintenanceStore } from '../../state/maintenanceStore';

function severityTone(severity: FeedbackSeverity): BadgeTone {
  return severity === 'blocker' ? 'red' : severity === 'major' ? 'amber' : 'neutral';
}

function statusTone(status: FeedbackStatus): BadgeTone {
  if (status === 'Fixed') return 'green';
  if (CLOSED_STATUSES.includes(status)) return 'neutral';
  return 'blue';
}

// ------------------------------------------------------------ triage

function NewTriageForm({ onDone }: { onDone: () => void }) {
  const createTriage = useMaintenanceStore((s) => s.createTriage);
  const runtime = runtimeEnvironment();

  const [featureArea, setFeatureArea] = useState('');
  const [category, setCategory] = useState<FeedbackCategory>('Bug');
  const [severity, setSeverity] = useState<FeedbackSeverity>('minor');
  const [priority, setPriority] = useState<FeedbackPriority>('P2');
  const [reproducibility, setReproducibility] = useState<Reproducibility>('sometimes');
  const [description, setDescription] = useState('');
  const [expectedBehavior, setExpected] = useState('');
  const [actualBehavior, setActual] = useState('');
  const [noPhi, setNoPhi] = useState(false);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setError(undefined);
    if (!featureArea.trim() || !description.trim() || !expectedBehavior.trim() || !actualBehavior.trim()) {
      setError('Feature area, description, expected behaviour and actual behaviour are all required.');
      return;
    }
    if (!noPhi) {
      setError('Confirm that this item contains no client information before saving.');
      return;
    }
    setBusy(true);
    try {
      await createTriage({
        appVersion: buildInfo().version,
        platform: runtime.label,
        runtime: runtime.mode,
        featureArea: featureArea.trim(),
        category,
        severity,
        reproducibility,
        description,
        expectedBehavior,
        actualBehavior,
        status: 'New',
        priority,
        noPhiConfirmed: true,
      });
      onDone();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stack-sm">
      <p className="muted small" style={{ margin: 0 }}>
        Structured fields only. Do not paste session content, client names, transcripts, prompts,
        model output or keys — there is no field here that can hold them, and free text is scrubbed
        of secret-shaped tokens before it is stored.
      </p>

      <Field label="Feature area" required hint="Where in the app, e.g. “Review queue”, “DAP note”.">
        <input value={featureArea} onChange={(e) => setFeatureArea(e.target.value)} />
      </Field>

      <div className="cluster" style={{ gap: 12, flexWrap: 'wrap' }}>
        <Field label="Category">
          <select value={category} onChange={(e) => setCategory(e.target.value as FeedbackCategory)}>
            {FEEDBACK_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Severity">
          <select value={severity} onChange={(e) => setSeverity(e.target.value as FeedbackSeverity)}>
            {FEEDBACK_SEVERITIES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Priority">
          <select value={priority} onChange={(e) => setPriority(e.target.value as FeedbackPriority)}>
            {FEEDBACK_PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Reproducibility">
          <select value={reproducibility} onChange={(e) => setReproducibility(e.target.value as Reproducibility)}>
            {REPRODUCIBILITY.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <Field label="What happened" required>
        <textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
      </Field>
      <Field label="Expected behaviour" required>
        <textarea rows={2} value={expectedBehavior} onChange={(e) => setExpected(e.target.value)} />
      </Field>
      <Field label="Actual behaviour" required>
        <textarea rows={2} value={actualBehavior} onChange={(e) => setActual(e.target.value)} />
      </Field>

      <label className="cluster" style={{ gap: 8, alignItems: 'flex-start' }}>
        <input type="checkbox" checked={noPhi} onChange={(e) => setNoPhi(e.target.checked)} />
        <span className="small">
          This item contains no client information of any kind.
        </span>
      </label>

      {error && (
        <p className="notice notice--warn" role="alert" style={{ margin: 0 }}>
          {error}
        </p>
      )}

      <div className="cluster">
        <button className="btn btn--primary btn--sm" disabled={busy} onClick={() => void submit()}>
          <Icon name="check" size={13} /> Save item
        </button>
        <button className="btn btn--ghost btn--sm" onClick={onDone}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function TriageCard() {
  const triage = useMaintenanceStore((s) => s.triage);
  const dashboard = useMaintenanceStore((s) => s.dashboard);
  const updateTriage = useMaintenanceStore((s) => s.updateTriage);
  const deleteTriage = useMaintenanceStore((s) => s.deleteTriage);
  const [showNew, setShowNew] = useState(false);
  const [showClosed, setShowClosed] = useState(false);

  const visible = showClosed ? triage : triage.filter((i) => !CLOSED_STATUSES.includes(i.status));

  return (
    <Card
      title="Beta feedback triage"
      icon="activity"
      action={
        <button className="btn btn--secondary btn--sm" onClick={() => setShowNew((v) => !v)}>
          <Icon name="plus" size={13} /> {showNew ? 'Close form' : 'New item'}
        </button>
      }
    >
      <div className="stack-sm">
        {dashboard && (
          <div className="cluster" style={{ gap: 6, flexWrap: 'wrap' }}>
            <Badge tone="blue">{dashboard.total} total</Badge>
            <Badge tone={dashboard.open > 0 ? 'amber' : 'green'}>{dashboard.open} open</Badge>
            {dashboard.highestSeverity.length > 0 && (
              <Badge tone="red" icon="alert">
                {dashboard.highestSeverity.length} blocker/major open
              </Badge>
            )}
            {dashboard.regressionCandidates.length > 0 && (
              <Badge tone="plum">{dashboard.regressionCandidates.length} regression candidate(s)</Badge>
            )}
          </div>
        )}

        {showNew && <NewTriageForm onDone={() => setShowNew(false)} />}

        {dashboard && dashboard.mostCommon.length > 0 && (
          <p className="muted small" style={{ margin: 0 }}>
            Most common:{' '}
            {dashboard.mostCommon
              .slice(0, 4)
              .map((c) => `${c.category} (${c.count})`)
              .join(' · ')}
          </p>
        )}

        {visible.length === 0 ? (
          <EmptyState icon="check" title={showClosed ? 'No feedback items yet' : 'No open feedback items'}>
            <span className="muted small">
              Items you record here track product issues found during beta testing.
            </span>
          </EmptyState>
        ) : (
          <div className="stack-sm">
            {visible.map((item) => (
              <div key={item.id} className="card card--pad">
                <div className="spread">
                  <div>
                    <strong>
                      {item.reference} — {item.featureArea}
                    </strong>
                    <div className="cluster" style={{ gap: 6, marginTop: 4, flexWrap: 'wrap' }}>
                      <Badge tone={severityTone(item.severity)} icon="alert">
                        {item.severity}
                      </Badge>
                      <Badge tone={statusTone(item.status)}>{item.status}</Badge>
                      <Badge tone="outline">{item.priority}</Badge>
                      <Badge tone="outline">{item.category}</Badge>
                      <Badge tone="outline">{item.platform}</Badge>
                    </div>
                  </div>
                  <span className="muted small">{fmtDateTime(item.createdAt)}</span>
                </div>
                <p className="small" style={{ marginTop: 8 }}>
                  {item.description}
                </p>
                <dl className="kv">
                  <dt>Expected</dt>
                  <dd>{item.expectedBehavior}</dd>
                  <dt>Actual</dt>
                  <dd>{item.actualBehavior}</dd>
                  <dt>Reproducibility</dt>
                  <dd>{item.reproducibility}</dd>
                  {item.resolutionNotes && (
                    <>
                      <dt>Resolution</dt>
                      <dd>{item.resolutionNotes}</dd>
                    </>
                  )}
                </dl>
                <div className="cluster" style={{ gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                  <label className="cluster" style={{ gap: 6 }}>
                    <span className="muted small">Status</span>
                    <select
                      value={item.status}
                      onChange={(e) => void updateTriage(item.id, { status: e.target.value as FeedbackStatus })}
                    >
                      {FEEDBACK_STATUSES.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="cluster" style={{ gap: 6 }}>
                    <span className="muted small">Priority</span>
                    <select
                      value={item.priority}
                      onChange={(e) => void updateTriage(item.id, { priority: e.target.value as FeedbackPriority })}
                    >
                      {FEEDBACK_PRIORITIES.map((p) => (
                        <option key={p} value={p}>
                          {p}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button className="btn btn--ghost btn--sm" onClick={() => void deleteTriage(item.id)}>
                    <Icon name="trash" size={13} /> Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        <label className="cluster" style={{ gap: 8 }}>
          <input type="checkbox" checked={showClosed} onChange={(e) => setShowClosed(e.target.checked)} />
          <span className="small">Show closed items</span>
        </label>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------- migrations

function MigrationCard() {
  const schemaVersion = useMaintenanceStore((s) => s.schemaVersion);
  const currentSchemaVersion = useMaintenanceStore((s) => s.currentSchemaVersion);
  const plan = useMaintenanceStore((s) => s.migrationPlan);
  const envelopeCheck = useMaintenanceStore((s) => s.envelopeCheck);
  const previewMigrations = useMaintenanceStore((s) => s.previewMigrations);
  const applyMigrations = useMaintenanceStore((s) => s.applyMigrations);
  const checkEnvelopes = useMaintenanceStore((s) => s.checkEnvelopes);

  const [backupConfirmed, setBackupConfirmed] = useState(false);
  const [error, setError] = useState<string>();
  const [applied, setApplied] = useState<string>();
  const [busy, setBusy] = useState(false);

  const upToDate = schemaVersion !== undefined && schemaVersion >= currentSchemaVersion;

  const run = async (fn: () => Promise<unknown>, done?: (r: unknown) => void) => {
    setError(undefined);
    setApplied(undefined);
    setBusy(true);
    try {
      done?.(await fn());
    } catch (e) {
      setError(e instanceof MigrationError ? e.message : `Failed: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title="Data schema &amp; migrations" icon="database">
      <div className="stack-sm">
        <div className="cluster" style={{ gap: 6, flexWrap: 'wrap' }}>
          <Badge tone={upToDate ? 'green' : 'amber'} icon="shield">
            Workspace schema v{schemaVersion ?? '—'}
          </Badge>
          <Badge tone="outline">This build supports v{currentSchemaVersion}</Badge>
        </div>

        <p className="muted small" style={{ margin: 0 }}>
          Migrations preview first and never run automatically. A workspace written by a newer build
          is refused rather than partially interpreted, records are verified to still be encryption
          envelopes before and after, and a migration that would lose a record is aborted.
        </p>

        <div className="cluster">
          <button className="btn btn--secondary btn--sm" disabled={busy} onClick={() => void run(previewMigrations)}>
            <Icon name="search" size={13} /> Preview migrations (dry run)
          </button>
          <button className="btn btn--secondary btn--sm" disabled={busy} onClick={() => void run(checkEnvelopes)}>
            <Icon name="shield" size={13} /> Verify encryption envelopes
          </button>
        </div>

        {envelopeCheck && (
          <p
            className={envelopeCheck.invalid.length === 0 ? 'notice' : 'notice notice--warn'}
            style={{ margin: 0 }}
            role="status"
          >
            Checked {envelopeCheck.checked} record(s).{' '}
            {envelopeCheck.invalid.length === 0
              ? 'Every record is a valid encryption envelope.'
              : `${envelopeCheck.invalid.length} record(s) are NOT valid envelopes: ${envelopeCheck.invalid
                  .slice(0, 5)
                  .join(', ')}`}
          </p>
        )}

        {plan && (
          <div className="stack-sm">
            <strong className="small">
              Plan: v{plan.fromVersion} → v{plan.toVersion} ({plan.migrations.length} migration(s),{' '}
              {plan.totalChanges} record change(s))
            </strong>
            {plan.migrations.length === 0 ? (
              <p className="muted small" style={{ margin: 0 }}>
                Nothing to do — this workspace is already at the current schema version.
              </p>
            ) : (
              <>
                <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
                  {plan.migrations.map((m) => (
                    <li key={m.id}>
                      <strong>{m.id}</strong> — {m.description}{' '}
                      {m.destructive && (
                        <Badge tone="red" icon="alert">
                          destructive
                        </Badge>
                      )}{' '}
                      <span className="muted">({m.changeCount} change(s))</span>
                    </li>
                  ))}
                </ul>
                {plan.requiresBackup && (
                  <label className="cluster" style={{ gap: 8, alignItems: 'flex-start' }}>
                    <input
                      type="checkbox"
                      checked={backupConfirmed}
                      onChange={(e) => setBackupConfirmed(e.target.checked)}
                    />
                    <span className="small">
                      I have created a backup of this workspace before migrating.
                    </span>
                  </label>
                )}
                <button
                  className="btn btn--primary btn--sm"
                  disabled={busy}
                  onClick={() =>
                    void run(
                      () => applyMigrations(backupConfirmed),
                      (r) => {
                        const result = r as typeof plan;
                        setApplied(
                          `Migrated to schema v${result.toVersion}. ${result.totalChanges} record change(s) applied.`,
                        );
                      },
                    )
                  }
                >
                  <Icon name="check" size={13} /> Apply migrations
                </button>
              </>
            )}
          </div>
        )}

        {error && (
          <p className="notice notice--warn" role="alert" style={{ margin: 0 }}>
            {error}
          </p>
        )}
        {applied && (
          <p className="notice" role="status" style={{ margin: 0 }}>
            {applied}
          </p>
        )}
      </div>
    </Card>
  );
}

// --------------------------------------------------------- diagnostics

function DiagnosticsCard() {
  const diagnostics = useMaintenanceStore((s) => s.diagnostics);
  const exportDiagnostics = useMaintenanceStore((s) => s.exportDiagnostics);
  const clearDiagnostics = useMaintenanceStore((s) => s.clearDiagnostics);

  const [noPhi, setNoPhi] = useState(false);
  const [error, setError] = useState<string>();
  const [status, setStatus] = useState<string>();

  const doExport = () => {
    setError(undefined);
    setStatus(undefined);
    try {
      const payload = exportDiagnostics(noPhi);
      downloadJson(`cockpit-diagnostics-${new Date().toISOString().slice(0, 10)}.json`, payload);
      setStatus(`Exported ${payload.events.length} event(s).`);
    } catch (e) {
      setError(
        e instanceof DiagnosticExportRefusedError ? e.message : `Export failed: ${(e as Error).message}`,
      );
    }
  };

  return (
    <Card title="Diagnostics" icon="activity">
      <div className="stack-sm">
        <p className="muted small" style={{ margin: 0 }}>
          Operational events only: feature, severity, a machine code, duration and an opaque
          reference. There is no field capable of holding clinical text, prompts, model output or
          API keys, and codes are sanitized before they are stored.
        </p>

        {diagnostics.length === 0 ? (
          <EmptyState icon="check" title="No diagnostic events recorded" />
        ) : (
          <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
            {diagnostics.slice(0, 25).map((e) => (
              <li key={e.id}>
                <Badge tone={e.severity === 'error' ? 'red' : e.severity === 'warning' ? 'amber' : 'neutral'}>
                  {e.severity}
                </Badge>{' '}
                <code>{e.code}</code> <span className="muted">· {e.feature} · {fmtDateTime(e.at)}</span>
                {e.durationMs !== undefined && <span className="muted"> · {e.durationMs}ms</span>}
              </li>
            ))}
          </ul>
        )}

        <label className="cluster" style={{ gap: 8, alignItems: 'flex-start' }}>
          <input type="checkbox" checked={noPhi} onChange={(e) => setNoPhi(e.target.checked)} />
          <span className="small">
            I confirm this diagnostic export contains no client information.
          </span>
        </label>

        <div className="cluster">
          <button className="btn btn--secondary btn--sm" onClick={doExport}>
            <Icon name="download" size={13} /> Export diagnostics
          </button>
          <button
            className="btn btn--ghost btn--sm"
            disabled={diagnostics.length === 0}
            onClick={() => void clearDiagnostics().then((n) => setStatus(`Cleared ${n} event(s).`))}
          >
            <Icon name="trash" size={13} /> Clear
          </button>
        </div>

        {error && (
          <p className="notice notice--warn" role="alert" style={{ margin: 0 }}>
            {error}
          </p>
        )}
        {status && (
          <p className="notice" role="status" style={{ margin: 0 }}>
            {status}
          </p>
        )}
      </div>
    </Card>
  );
}

// -------------------------------------------------------------- screen

export function MaintenanceScreen() {
  const navigate = useNavigate();
  const loadAll = useMaintenanceStore((s) => s.loadAll);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  return (
    <main id="main-content" tabIndex={-1} className="page">
      <div className="stack" style={{ maxWidth: 940, margin: '0 auto' }}>
        <div className="spread">
          <button className="btn btn--ghost btn--sm" onClick={() => navigate('/settings')}>
            <Icon name="chevron-left" size={15} /> Workspace settings
          </button>
        </div>

        <div>
          <h1>Maintenance &amp; diagnostics</h1>
          <p className="muted" style={{ marginTop: 4 }}>
            Beta feedback triage, data-schema migrations, and PHI-free operational diagnostics.
          </p>
        </div>

        <TriageCard />
        <MigrationCard />
        <DiagnosticsCard />
      </div>
    </main>
  );
}
