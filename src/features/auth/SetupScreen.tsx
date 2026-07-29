import { useRef, useState, type FormEvent } from 'react';
import { Icon } from '../../app/components/Icon';
import { Field } from '../../app/components/ui';
import { authService } from '../../core/auth/authService';
import { inspectBackup, restoreBackup } from '../../core/backup/backupService';
import { IndexedDbAdapter } from '../../core/storage/indexedDbAdapter';
import { useAuthStore } from '../../state/authStore';

export function SetupScreen() {
  const setup = useAuthStore((s) => s.setup);
  const refresh = useAuthStore((s) => s.refresh);

  const [name, setName] = useState('');
  const [passphrase, setPassphrase] = useState('');
  const [confirm, setConfirm] = useState('');
  const [usePin, setUsePin] = useState(false);
  const [pin, setPin] = useState('');
  const [autoLock, setAutoLock] = useState(5);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [restoreMsg, setRestoreMsg] = useState<string>();
  const fileRef = useRef<HTMLInputElement>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(undefined);
    if (name.trim().length === 0) return setError('Please enter your name.');
    if (passphrase.length < 8) return setError('Passphrase must be at least 8 characters.');
    if (passphrase !== confirm) return setError('Passphrases do not match.');
    if (usePin && !/^\d{4,8}$/.test(pin)) return setError('PIN must be 4–8 digits.');
    setBusy(true);
    try {
      await setup({
        name: name.trim(),
        passphrase,
        pin: usePin ? pin : undefined,
        autoLockMinutes: autoLock,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Setup failed.');
      setBusy(false);
    }
  };

  const restoreFromFile = async (file: File) => {
    setError(undefined);
    setRestoreMsg(undefined);
    setBusy(true);
    try {
      const parsed = JSON.parse(await file.text());
      const inspection = await inspectBackup(parsed);
      if (!inspection.valid) {
        setError(`This backup cannot be restored: ${inspection.blockers.join(' ')}`);
        return;
      }
      const adapter = await IndexedDbAdapter.open();
      const result = await restoreBackup(adapter, parsed);
      adapter.close();
      await authService.close();
      await refresh();
      setRestoreMsg(
        `Backup restored (${result.restored.records} records, ${result.restored.blobs} attachments). Unlock with the passphrase that protected the backup.`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not read that backup file.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-shell">
      <div className="auth-card">
        <div className="auth-brand">
          <div className="auth-brand__logo">
            <Icon name="compass" size={24} />
          </div>
          <div>
            <h1>Cockpit</h1>
            <small>Clinical workspace — first-time setup</small>
          </div>
        </div>

        <div className="notice notice--info" style={{ marginBottom: 18 }}>
          <Icon name="shield" size={28} />
          <span>
            This workspace runs in <strong>local-only mode</strong>. Client records are encrypted
            with a key derived from your passphrase and stored only on this device. If you lose
            the passphrase, the data cannot be recovered.
          </span>
        </div>

        <form onSubmit={submit} className="stack">
          <Field label="Your name" required hint="Shown as the author on every record change.">
            <input
              className="input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="name"
              placeholder="e.g. Dr. Sanaz Razavi, LMFT"
            />
          </Field>
          <Field label="Passphrase" required hint="Minimum 8 characters. Encrypts all client data.">
            <input
              className="input"
              type="password"
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              autoComplete="new-password"
            />
          </Field>
          <Field label="Confirm passphrase" required>
            <input
              className="input"
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              autoComplete="new-password"
            />
          </Field>

          <label className="checkbox-row">
            <input type="checkbox" checked={usePin} onChange={(e) => setUsePin(e.target.checked)} />
            <span>
              <strong>Enable quick-unlock PIN</strong>
              <span className="muted" style={{ display: 'block' }}>
                Convenient on this device, but shorter than a passphrase — anyone who guesses the
                PIN can open the workspace.
              </span>
            </span>
          </label>
          {usePin && (
            <Field label="PIN (4–8 digits)">
              <input
                className="input"
                type="password"
                inputMode="numeric"
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 8))}
              />
            </Field>
          )}

          <Field label="Auto-lock after inactivity">
            <select
              className="select"
              value={autoLock}
              onChange={(e) => setAutoLock(Number(e.target.value))}
            >
              <option value={1}>1 minute</option>
              <option value={2}>2 minutes</option>
              <option value={5}>5 minutes</option>
              <option value={10}>10 minutes</option>
              <option value={15}>15 minutes</option>
              <option value={30}>30 minutes</option>
            </select>
          </Field>

          {error && (
            <div className="notice notice--danger" role="alert">
              <Icon name="alert" size={18} />
              <span>{error}</span>
            </div>
          )}
          {restoreMsg && (
            <div className="notice notice--info" role="status">
              <Icon name="check" size={18} />
              <span>{restoreMsg}</span>
            </div>
          )}

          <button className="btn btn--primary" type="submit" disabled={busy}>
            <Icon name="lock" size={16} />
            Create encrypted workspace
          </button>
        </form>

        <hr className="divider" />
        <div className="spread">
          <span className="muted">Moving from another device?</span>
          <button
            className="btn btn--ghost btn--sm"
            type="button"
            disabled={busy}
            onClick={() => fileRef.current?.click()}
          >
            <Icon name="upload" size={15} />
            Restore encrypted backup
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void restoreFromFile(file);
              e.target.value = '';
            }}
          />
        </div>
      </div>
    </div>
  );
}
