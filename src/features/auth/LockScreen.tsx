import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon } from '../../app/components/Icon';
import { Field } from '../../app/components/ui';
import { useAuthStore } from '../../state/authStore';

export function LockScreen() {
  const navigate = useNavigate();
  const { profileName, hasPin, error, lockoutUntil, unlock, clearError } = useAuthStore();
  const [method, setMethod] = useState<'passphrase' | 'pin'>('passphrase');
  const [secret, setSecret] = useState('');
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now());

  const lockedOut = lockoutUntil !== undefined && lockoutUntil > now;

  useEffect(() => {
    if (!lockedOut) return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [lockedOut]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!secret || lockedOut) return;
    setBusy(true);
    const ok = await unlock(secret, method);
    setBusy(false);
    if (!ok) setSecret('');
    // Per spec §4, the first screen after login is always Choose Client.
    else navigate('/', { replace: true });
  };

  const remaining = lockedOut ? Math.max(0, Math.ceil((lockoutUntil - now) / 1000)) : 0;

  return (
    <div className="auth-shell">
      <div className="auth-card">
        <div className="auth-brand">
          <div className="auth-brand__logo">
            <Icon name="lock" size={22} />
          </div>
          <div>
            <h1>Workspace locked</h1>
            <small>{profileName ? `Welcome back, ${profileName}` : 'Cockpit clinical workspace'}</small>
          </div>
        </div>

        <div className="cluster" style={{ marginBottom: 16 }}>
          <span className="badge badge--green">
            <Icon name="shield" size={13} />
            Local-only mode — data stays on this device
          </span>
        </div>

        <form onSubmit={submit} className="stack">
          {hasPin && (
            <div className="chips" role="tablist" aria-label="Unlock method">
              <button
                type="button"
                className="chip"
                aria-pressed={method === 'passphrase'}
                style={method === 'passphrase' ? { borderColor: 'var(--brand)', color: 'var(--brand-deep)', background: 'var(--brand-soft)' } : undefined}
                onClick={() => { setMethod('passphrase'); setSecret(''); clearError(); }}
              >
                Passphrase
              </button>
              <button
                type="button"
                className="chip"
                aria-pressed={method === 'pin'}
                style={method === 'pin' ? { borderColor: 'var(--brand)', color: 'var(--brand-deep)', background: 'var(--brand-soft)' } : undefined}
                onClick={() => { setMethod('pin'); setSecret(''); clearError(); }}
              >
                PIN
              </button>
            </div>
          )}

          <Field label={method === 'pin' ? 'PIN' : 'Passphrase'}>
            <input
              className="input"
              type="password"
              inputMode={method === 'pin' ? 'numeric' : undefined}
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              autoFocus
              autoComplete="current-password"
              disabled={lockedOut}
            />
          </Field>

          {lockedOut ? (
            <div className="notice notice--warn" role="alert">
              <Icon name="clock" size={18} />
              <span>
                Too many failed attempts. Try again in <strong>{remaining}s</strong>.
              </span>
            </div>
          ) : (
            error && (
              <div className="notice notice--danger" role="alert">
                <Icon name="alert" size={18} />
                <span>{error}</span>
              </div>
            )
          )}

          <button className="btn btn--primary" type="submit" disabled={busy || lockedOut || !secret}>
            <Icon name="unlock" size={16} />
            Unlock workspace
          </button>
        </form>
      </div>
    </div>
  );
}
