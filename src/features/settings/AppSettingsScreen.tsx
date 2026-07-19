import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon } from '../../app/components/Icon';
import { Badge, Card, Field, Modal } from '../../app/components/ui';
import { authService } from '../../core/auth/authService';
import { createBackup, isValidBackup, restoreBackup } from '../../core/backup/backupService';
import type { AuditEvent } from '../../core/db/schema';
import { downloadJson } from '../../lib/download';
import { fmtDateTime } from '../../lib/format';
import { useAuthStore } from '../../state/authStore';
import { useDataStore } from '../../state/dataStore';
import { AiSettingsCard } from './AiSettingsCard';

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

  const doRestore = async () => {
    if (!restoreFile) return;
    setRestoreErr(undefined);
    setBusy(true);
    try {
      const parsed = JSON.parse(await restoreFile.text());
      if (!isValidBackup(parsed)) {
        setRestoreErr('That file is not a valid Cockpit backup.');
        return;
      }
      const db = authService.require();
      await restoreBackup(db.adapter, parsed);
      // The keyring may have changed — force a clean re-authentication.
      await authService.close();
      useDataStore.getState().reset();
      setRestoreFile(undefined);
      await refresh();
      navigate('/');
    } catch (err) {
      setRestoreErr(err instanceof Error ? err.message : 'Restore failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <header className="topbar">
        <button className="icon-btn" aria-label="Back to Choose Client" onClick={() => navigate('/')}>
          <Icon name="chevron-left" />
        </button>
        <div className="topbar__brand">Workspace settings</div>
        <div className="topbar__spacer" />
        <Badge tone="green" icon="shield">Local-only</Badge>
      </header>

      <main className="page stack" style={{ maxWidth: 760 }}>
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

        <AiSettingsCard />

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
                  if (f) setRestoreFile(f);
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
          title="Replace workspace with backup?"
          subtitle={`"${restoreFile.name}" will replace every client record currently on this device. You will be asked to unlock with the passphrase that protected the backup.`}
          onClose={() => { setRestoreFile(undefined); setRestoreErr(undefined); }}
        >
          {restoreErr && (
            <div className="notice notice--danger" role="alert" style={{ marginBottom: 12 }}>
              <Icon name="alert" size={16} />
              <span>{restoreErr}</span>
            </div>
          )}
          <div className="modal__footer">
            <button className="btn btn--ghost" onClick={() => { setRestoreFile(undefined); setRestoreErr(undefined); }}>
              Cancel
            </button>
            <button className="btn btn--danger" disabled={busy} onClick={() => void doRestore()}>
              Replace workspace
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
