import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Icon } from '../../app/components/Icon';
import { Badge, Card } from '../../app/components/ui';
import { authService } from '../../core/auth/authService';
import { platformCapabilities, runtimeEnvironment } from '../../core/platform/platform';

/**
 * Device & storage settings (Phase 6). Shows the honest platform posture and
 * lets the clinician enable OS device unlock WHEN a real secure keystore is
 * present. Browser builds show the guidance without offering unavailable
 * features (no placeholder buttons).
 */
export function DeviceStorageCard() {
  const caps = platformCapabilities();
  const runtime = runtimeEnvironment();
  const [available, setAvailable] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'err'; text: string }>();

  const refresh = async () => {
    setAvailable(await authService.isDeviceUnlockAvailable());
    setEnabled(await authService.hasDeviceUnlock());
  };

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const enable = async () => {
    setBusy(true);
    setMsg(undefined);
    try {
      await authService.enableDeviceUnlock();
      await refresh();
      setMsg({ tone: 'ok', text: `Device unlock enabled via ${authService.keyStoreLabel()}.` });
    } catch (err) {
      setMsg({ tone: 'err', text: err instanceof Error ? err.message : 'Could not enable device unlock.' });
    } finally {
      setBusy(false);
    }
  };

  const disable = async () => {
    setBusy(true);
    setMsg(undefined);
    try {
      await authService.disableDeviceUnlock();
      await refresh();
      setMsg({ tone: 'ok', text: 'Device unlock disabled. Unlock now requires the passphrase or PIN.' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title="Device & storage" icon="shield">
      <div className="stack-sm">
        <div className="cluster" style={{ gap: 8, flexWrap: 'wrap' }}>
          <Badge tone={runtime.mode === 'browser-development' ? 'amber' : 'blue'} icon="settings">
            {runtime.label}
          </Badge>
          <Badge tone={caps.fileSystemStorage ? 'blue' : 'green'} icon="shield">
            {caps.fileSystemStorage ? 'Durable file storage' : 'Browser storage (development)'}
          </Badge>
        </div>
        {!caps.fileSystemStorage && (
          <p className="muted small" style={{ margin: 0 }}>
            This is the development browser build. Data is encrypted in the browser's IndexedDB, which can be
            evicted under storage pressure — keep a current backup. Native desktop/mobile builds use durable,
            backup-safe file storage. See the native packaging plan.
          </p>
        )}

        <hr className="divider" style={{ margin: '2px 0' }} />

        <strong className="small">OS device unlock {enabled ? '(enabled)' : available ? '(available)' : '(unavailable here)'}</strong>
        {available ? (
          <>
            <p className="muted small" style={{ margin: 0 }}>
              Adds an optional convenience: the data key is wrapped by a key held only in the OS secure store
              ({authService.keyStoreLabel()}). Your passphrase still works and remains the recovery path — there
              is no backdoor. If the device is wiped or the app reinstalled, the OS key is gone and you must use
              your passphrase.
            </p>
            <div className="cluster">
              {enabled ? (
                <button className="btn btn--ghost btn--sm" disabled={busy} onClick={() => void disable()}>
                  <Icon name="x" size={13} /> Disable device unlock
                </button>
              ) : (
                <button className="btn btn--secondary btn--sm" disabled={busy} onClick={() => void enable()}>
                  <Icon name="lock" size={13} /> Enable device unlock
                </button>
              )}
            </div>
          </>
        ) : (
          <p className="muted small" style={{ margin: 0 }}>
            OS-level secure key storage is not available in this environment, so device unlock is not offered
            here. It becomes available in the native desktop/mobile builds (macOS/iOS Keychain, Windows
            Credential Manager, Android Keystore).
          </p>
        )}
        {msg && (
          <div className={`notice ${msg.tone === 'ok' ? 'notice--info' : 'notice--danger'}`} role="status">
            <Icon name={msg.tone === 'ok' ? 'check' : 'alert'} size={15} />
            <span className="small">{msg.text}</span>
          </div>
        )}

        <hr className="divider" style={{ margin: '2px 0' }} />
        <div className="cluster" style={{ flexWrap: 'wrap' }}>
          <Link className="btn btn--ghost btn--sm" to="/guides">
            <Icon name="file" size={13} /> Guides & checklists
          </Link>
          <Link className="btn btn--ghost btn--sm" to="/readiness">
            <Icon name="check" size={13} /> Readiness & production report
          </Link>
        </div>
      </div>
    </Card>
  );
}
