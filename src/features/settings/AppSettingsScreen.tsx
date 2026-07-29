import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon } from '../../app/components/Icon';
import { ProcessingStatusBadge } from '../../app/components/ProcessingStatusBadge';
import { Badge, Card, Field, Modal } from '../../app/components/ui';
import { authService } from '../../core/auth/authService';
import {
  createBackup,
  inspectBackup,
  restoreBackup,
  type BackupInspection,
  type WorkspaceBackup,
} from '../../core/backup/backupService';
import type { AuditEvent } from '../../core/db/schema';
import { downloadJson } from '../../lib/download';
import { fmtDateTime } from '../../lib/format';
import { useAuthStore } from '../../state/authStore';
import { useDataStore } from '../../state/dataStore';
import { AiSettingsCard } from './AiSettingsCard';
import { DeviceStorageCard } from './DeviceStorageCard';
import { SemanticRetrievalCard } from './SemanticRetrievalCard';

export function AppSettingsScreen() {
  const navigate = useNavigate();
  const { profileName, hasPin, autoLockMinutes, setAutoLockMinutes, refresh, lock } = useAuthStore();

  const [currentPass, setCurrentPass] = useState('');
  const [newPass, setNewPass] = useState('');
  const [confirmPass, setConfirmPass] = useState('');
  const [passMsg, setPassMsg] = useState<{ tone: 'ok' | 'err'; text: string }>();

  const [pinValue, setPinValue] = useState('');
  const [pinMsg, setPinMsg] = useState<{ tone: 'ok' | 'err'; text: string }>();

  const [audit, setAudit] = useState<AuditEvent[]>([]);
  const [restoreFile, setRestoreFile] = useState<File>();
  const [restoreErr, setRestoreErr] = useState<string>();
  const [restorePreview, setRestorePreview] = useState<BackupInspection>();
  const [parsedBackup, setParsedBackup] = useState<WorkspaceBackup>();
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const db = authService.current();
    if (db) void db.listAudit(30).then(setAudit);
  }, []);

  const changePass = async () => {
    setPassMsg(undefined);
    if (newPass.length < 8) return setPassMsg({ tone: 'err', text: 'New passphrase must be at least 8 characters.' });
    if (newPass !== confirmPass) return setPassMsg({ tone: 'err', text: 'New passphrases do not match.' });
    setBusy(true);
    try {
      await authService.changePassphrase(currentPass, newPass);
      setPassMsg({ tone: 'ok', text: 'Passphrase changed. Existing data was re-secured under the new passphrase.' });
      setCurrentPass(''); setNewPass(''); setConfirmPass('');
    } catch {
      setPassMsg({ tone: 'err', text: 'Current passphrase is not correct.' });
    } finally {
      setBusy(false);
    }
  };

  const savePin = async () => {
    setPinMsg(undefined);
    if (!/^\d{4,8}$/.test(pinValue)) return setPinMsg({ tone: 'err', text: 'PIN must be 4–8 digits.' });
    setBusy(true);
    try {
      await authService.setPin(pinValue);
      await refresh();
      setPinMsg({ tone: 'ok', text: hasPin ? 'PIN updated.' : 'PIN enabled.' });
      setPinValue('');
    } finally {
      setBusy(false);
    }
  };

  const dropPin = async () => {
    setBusy(true);
    await authService.removePin();
    await refresh();
    setPinMsg({ tone: 'ok', text: 'PIN removed. Unlock now requires the passphrase.' });
    setBusy(false);
  };

  const makeBackup = async () => {
    const db = authService.current();
    if (!db) return;
    setBusy(true);
    const backup = await createBackup(db.adapter);
    await db.audit('backup', 'backup.created');
    downloadJson(`cockpit-backup-${new Date().toISOString().slice(0, 10)}.json`, backup);
    setBusy(false);
  };

  // Inspect the chosen file (checksum, counts, compatibility) WITHOUT
  // touching the workspace, so the clinician sees a restore preview first.
  const previewRestore = async (file: File) => {
    setRestoreErr(undefined);
    setRestorePreview(undefined);
    setParsedBackup(undefined);
    setRestoreFile(file);
    try {
      const parsed = JSON.parse(await file.text());
      const inspection = await inspectBackup(parsed);
      setRestorePreview(inspection);
      if (inspection.valid) setParsedBackup(parsed as WorkspaceBackup);
    } catch {
      setRestorePreview({
        valid: false,
        blockers: ['The file could not be parsed as JSON — it is not a Cockpit backup.'],
        warnings: [],
        version: 'unknown',
        counts: { meta: 0, records: 0, blobs: 0, byCollection: {}, hasKeyring: false },
        checksumStatus: 'absent-legacy',
        compatible: false,
      });
    }
  };

  const doRestore = async () => {
    if (!parsedBackup) return;
    setRestoreErr(undefined);
    setBusy(true);
    try {
      const db = authService.require();
      // Dry-run first: verify integrity end-to-end before any write.
      await restoreBackup(db.adapter, parsedBackup, { dryRun: true });
      await restoreBackup(db.adapter, parsedBackup);
      await db.audit('backup', 'backup.restored');
      // The keyring may have changed — force a clean re-authentication.
      await authService.close();
      useDataStore.getState().reset();
      closeRestore();
      await refresh();
      navigate('/');
    } catch (err) {
      setRestoreErr(err instanceof Error ? err.message : 'Restore failed.');
    } finally {
      setBusy(false);
    }
  };

  const closeRestore = () => {
    setRestoreFile(undefined);
    setRestoreErr(undefined);
    setRestorePreview(undefined);
    setParsedBackup(undefined);
  };

  return (
    <>
      <header className="topbar">
        <button className="icon-btn" aria-label="Back to Choose Client" onClick={() => navigate('/')}>
          <Icon name="chevron-left" />
        </button>
        <div className="topbar__brand">Workspace settings</div>
        <div className="topbar__spacer" />
        <ProcessingStatusBadge />
      </header>

      <main id="main-content" tabIndex={-1} className="page stack" style={{ maxWidth: 760 }}>
        <Card title="Profile" icon="user">
          <dl className="kv">
            <dt>Clinician</dt>
            <dd>{profileName}</dd>
            <dt>Storage mode</dt>
            <dd>Local-only — encrypted on this device. No data leaves it unless you export.</dd>
          </dl>
        </Card>

        <Card title="Security" icon="lock">
          <div className="stack">
            <Field label="Auto-lock after inactivity">
              <select
                className="select"
                value={autoLockMinutes}
                onChange={(e) => void setAutoLockMinutes(Number(e.target.value))}
              >
                <option value={1}>1 minute</option>
                <option value={2}>2 minutes</option>
                <option value={5}>5 minutes</option>
                <option value={10}>10 minutes</option>
                <option value={15}>15 minutes</option>
                <option value={30}>30 minutes</option>
              </select>
            </Field>

            <hr className="divider" style={{ margin: '4px 0' }} />

            <strong className="small">Change passphrase</strong>
            <div className="form-grid">
              <Field label="Current passphrase">
                <input className="input" type="password" value={currentPass} onChange={(e) => setCurrentPass(e.target.value)} autoComplete="current-password" />
              </Field>
              <Field label="New passphrase">
                <input className="input" type="password" value={newPass} onChange={(e) => setNewPass(e.target.value)} autoComplete="new-password" />
              </Field>
              <Field label="Confirm new passphrase">
                <input className="input" type="password" value={confirmPass} onChange={(e) => setConfirmPass(e.target.value)} autoComplete="new-password" />
              </Field>
            </div>
            {passMsg && (
              <div className={`notice ${passMsg.tone === 'ok' ? 'notice--info' : 'notice--danger'}`} role="status">
                <Icon name={passMsg.tone === 'ok' ? 'check' : 'alert'} size={16} />
                <span>{passMsg.text}</span>
              </div>
            )}
            <button className="btn btn--secondary btn--sm" style={{ alignSelf: 'flex-start' }} disabled={busy || !currentPass || !newPass} onClick={() => void changePass()}>
              Change passphrase
            </button>

            <hr className="divider" style={{ margin: '4px 0' }} />

            <strong className="small">Quick-unlock PIN {hasPin ? '(enabled)' : '(disabled)'}</strong>
            <div className="cluster">
              <input
                className="input"
                style={{ width: 180 }}
                type="password"
                inputMode="numeric"
                placeholder="New 4–8 digit PIN"
                value={pinValue}
                onChange={(e) => setPinValue(e.target.value.replace(/\D/g, '').slice(0, 8))}
              />
              <button className="btn btn--secondary btn--sm" disabled={busy || !pinValue} onClick={() => void savePin()}>
                {hasPin ? 'Update PIN' : 'Enable PIN'}
              </button>
              {hasPin && (
                <button className="btn btn--ghost btn--sm" disabled={busy} onClick={() => void dropPin()}>
                  Remove PIN
                </button>
              )}
            </div>
            {pinMsg && (
              <div className={`notice ${pinMsg.tone === 'ok' ? 'notice--info' : 'notice--danger'}`} role="status">
                <Icon name={pinMsg.tone === 'ok' ? 'check' : 'alert'} size={16} />
                <span>{pinMsg.text}</span>
              </div>
            )}
          </div>
        </Card>

        <Card title="Security & HIPAA-conscious readiness" icon="shield">
          <div className="stack-sm">
            <p className="muted small" style={{ margin: 0 }}>
              Readiness dashboard, Real PHI readiness gate, security review packet, data-flow map, threat model,
              policy & disclosure drafts, and AI vendor/BAA review — prepared for independent legal/security review.
              Real PHI use is not approved until all required reviews are completed.
            </p>
            <button className="btn btn--secondary btn--sm" style={{ alignSelf: 'flex-start' }} onClick={() => navigate('/governance')}>
              <Icon name="shield" size={14} /> Open readiness dashboard
            </button>
          </div>
        </Card>

        <Card title="Beta testing & release" icon="activity">
          <div className="stack-sm">
            <p className="muted small" style={{ margin: 0 }}>
              Beta testing mode (fictional / de-identified data only), PHI-free bug reporting, the release checklist, and
              the deployment decision report. Real PHI stays blocked by the Real PHI Readiness Gate.
            </p>
            <div className="cluster">
              <button className="btn btn--secondary btn--sm" onClick={() => navigate('/beta')}>
                <Icon name="activity" size={14} /> Beta testing mode
              </button>
              <button className="btn btn--secondary btn--sm" onClick={() => navigate('/release')}>
                <Icon name="check" size={14} /> Release & deployment
              </button>
              <button className="btn btn--secondary btn--sm" onClick={() => navigate('/maintenance')}>
                <Icon name="activity" size={14} /> Maintenance & diagnostics
              </button>
            </div>
          </div>
        </Card>

        <Card title="Import &amp; export" icon="download">
          <div className="stack-sm">
            <p className="muted small" style={{ margin: 0 }}>
              Move one client's record between Cockpit workspaces, or produce a readable copy for a
              clinician who does not run Cockpit. Exported files are not encrypted; imported records
              always arrive pending review.
            </p>
            <button
              className="btn btn--secondary btn--sm"
              style={{ alignSelf: 'flex-start' }}
              onClick={() => navigate('/interop')}
            >
              <Icon name="download" size={14} /> Open import &amp; export
            </button>
          </div>
        </Card>

        <DeviceStorageCard />

        <AiSettingsCard />

        <SemanticRetrievalCard />

        <Card title="Backup & restore" icon="download">
          <div className="stack">
            <div className="spread">
              <div>
                <strong className="small">Create encrypted backup</strong>
                <p className="muted small">
                  Downloads the whole workspace as one encrypted file. It can only be opened with
                  your current passphrase.
                </p>
              </div>
              <button className="btn btn--secondary btn--sm" disabled={busy} onClick={() => void makeBackup()}>
                <Icon name="download" size={14} /> Create backup
              </button>
            </div>
            <hr className="divider" style={{ margin: 0 }} />
            <div className="spread">
              <div>
                <strong className="small">Restore from backup</strong>
                <p className="muted small" style={{ color: 'var(--red)' }}>
                  Replaces everything currently in this workspace with the backup's contents.
                </p>
              </div>
              <button className="btn btn--secondary btn--sm" disabled={busy} onClick={() => fileRef.current?.click()}>
                <Icon name="upload" size={14} /> Choose file…
              </button>
              <input
                ref={fileRef}
                type="file"
                accept="application/json,.json"
                hidden
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void previewRestore(f);
                  e.target.value = '';
                }}
              />
            </div>
          </div>
        </Card>

        <Card title="Recent security activity" icon="activity">
          {audit.length === 0 ? (
            <p className="muted">Events like unlocks, exports, and backups appear here.</p>
          ) : (
            <div className="stack-sm" style={{ gap: 8 }}>
              {audit.map((event) => (
                <div key={event.id} className="spread small">
                  <span className="soft">
                    <Badge tone={event.category === 'auth' || event.category === 'security' ? 'blue' : event.category === 'export' || event.category === 'backup' ? 'amber' : 'neutral'}>
                      {event.category}
                    </Badge>{' '}
                    {event.action}
                  </span>
                  <span className="muted">{fmtDateTime(event.at)}</span>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card title="About this workspace" icon="info">
          <p className="muted small" style={{ lineHeight: 1.7 }}>
            Cockpit is a documentation and organization aid. It does not make clinical decisions,
            and clinician review is required before anything becomes part of the official record.
            The app is built with encryption at rest and other privacy-conscious practices, but
            using it alone does not make your practice HIPAA-compliant — compliance also depends
            on your policies, devices, agreements, and applicable law. Phase 1 provides the
            encrypted foundation; structured extraction, documentation generation, and analysis
            arrive in later phases.
          </p>
          <hr className="divider" />
          <button className="btn btn--ghost btn--sm" onClick={() => void lock()}>
            <Icon name="lock" size={14} /> Lock workspace now
          </button>
        </Card>
      </main>

      {restoreFile && (
        <Modal
          narrow
          title="Restore preview"
          subtitle={`"${restoreFile.name}" — reviewed before anything is changed. Restore replaces every client record on this device, and you will unlock afterward with the passphrase that protected the backup.`}
          onClose={closeRestore}
        >
          {restorePreview && (
            <div className="stack-sm" style={{ marginBottom: 12 }}>
              <div className="cluster" style={{ gap: 6, flexWrap: 'wrap' }}>
                <Badge tone={restorePreview.valid ? 'green' : 'red'} icon={restorePreview.valid ? 'check' : 'alert'}>
                  {restorePreview.valid ? 'Ready to restore' : 'Cannot restore'}
                </Badge>
                <Badge tone="neutral">format v{restorePreview.version}</Badge>
                <Badge
                  tone={restorePreview.checksumStatus === 'valid' ? 'green' : restorePreview.checksumStatus === 'mismatch' ? 'red' : 'amber'}
                  icon="shield"
                >
                  {restorePreview.checksumStatus === 'valid'
                    ? 'Integrity verified'
                    : restorePreview.checksumStatus === 'mismatch'
                      ? 'Checksum mismatch'
                      : 'No checksum (legacy)'}
                </Badge>
              </div>
              <p className="muted small" style={{ margin: 0 }}>
                {restorePreview.createdAt ? `Created ${fmtDateTime(restorePreview.createdAt)}. ` : ''}
                {restorePreview.counts.records} record(s), {restorePreview.counts.blobs} attachment(s),{' '}
                {restorePreview.counts.hasKeyring ? 'keyring present' : 'NO keyring'}.
              </p>
              {Object.keys(restorePreview.counts.byCollection).length > 0 && (
                <details>
                  <summary className="small" style={{ cursor: 'pointer' }}>Records by collection</summary>
                  <ul className="small" style={{ margin: '4px 0' }}>
                    {Object.entries(restorePreview.counts.byCollection)
                      .sort((a, b) => b[1] - a[1])
                      .map(([collection, n]) => (
                        <li key={collection}>{collection}: {n}</li>
                      ))}
                  </ul>
                </details>
              )}
              {restorePreview.blockers.map((b, i) => (
                <div key={i} className="notice notice--danger" role="alert">
                  <Icon name="alert" size={15} />
                  <span className="small">{b}</span>
                </div>
              ))}
              {restorePreview.warnings.map((w, i) => (
                <div key={i} className="notice notice--warn">
                  <Icon name="info" size={15} />
                  <span className="small">{w}</span>
                </div>
              ))}
            </div>
          )}
          {restoreErr && (
            <div className="notice notice--danger" role="alert" style={{ marginBottom: 12 }}>
              <Icon name="alert" size={16} />
              <span>{restoreErr}</span>
            </div>
          )}
          <div className="modal__footer">
            <button className="btn btn--ghost" onClick={closeRestore}>Cancel</button>
            <button
              className="btn btn--danger"
              disabled={busy || !restorePreview?.valid}
              onClick={() => void doRestore()}
            >
              Replace workspace
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
