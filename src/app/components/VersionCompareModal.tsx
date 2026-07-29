import { Modal } from './ui';
import type { VersionRecord } from '../../core/db/structuredSchema';
import { fmtDateTime } from '../../lib/format';

const HIDDEN_KEYS = new Set(['id', 'clientId', 'createdAt', 'snapshot']);

function entries(value: unknown): Array<[string, string]> {
  if (!value || typeof value !== 'object') return [];
  return Object.entries(value as Record<string, unknown>)
    .filter(([k, v]) => !HIDDEN_KEYS.has(k) && v !== undefined && v !== null && v !== '')
    .map(([k, v]) => [k, typeof v === 'string' ? v : JSON.stringify(v, null, 1)]);
}

/**
 * Side-by-side comparison of a stored version snapshot and the current
 * entity. Labeled "Previous" / "Current" in text — never color alone.
 */
export function VersionCompareModal({
  version,
  current,
  onClose,
}: {
  version: VersionRecord;
  current: unknown;
  onClose: () => void;
}) {
  const prev = entries(version.snapshot);
  const curr = entries(current);
  const currentMap = new Map(curr);
  const prevMap = new Map(prev);
  const keys = [...new Set([...prevMap.keys(), ...currentMap.keys()])];

  return (
    <Modal
      title="Version comparison"
      subtitle={`Snapshot v${version.entityVersion} · ${version.reason} · ${version.author} · ${fmtDateTime(version.at)}`}
      onClose={onClose}
    >
      <div className="stack-sm">
        {keys.map((key) => {
          const before = prevMap.get(key);
          const after = currentMap.get(key);
          const changed = before !== after;
          return (
            <div key={key} className="stack-sm" style={{ gap: 4 }}>
              <span className="field__label">
                {key}
                {changed && (
                  <span className="badge badge--amber" style={{ marginLeft: 8 }}>Changed</span>
                )}
              </span>
              {changed ? (
                <div className="form-grid" style={{ gap: 8 }}>
                  <div className="notice notice--danger" style={{ display: 'block' }}>
                    <strong className="small">Previous:</strong>
                    <span className="prewrap small" style={{ display: 'block' }}>{before ?? '—'}</span>
                  </div>
                  <div className="notice notice--info" style={{ display: 'block', background: 'var(--green-soft)', color: 'var(--green)' }}>
                    <strong className="small">Current:</strong>
                    <span className="prewrap small" style={{ display: 'block' }}>{after ?? '—'}</span>
                  </div>
                </div>
              ) : (
                <p className="muted small prewrap">{after ?? before}</p>
              )}
            </div>
          );
        })}
        <div className="modal__footer">
          <button className="btn btn--secondary" onClick={onClose}>Close</button>
        </div>
      </div>
    </Modal>
  );
}
