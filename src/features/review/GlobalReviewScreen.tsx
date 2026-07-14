import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon } from '../../app/components/Icon';
import { Badge } from '../../app/components/ui';
import { useStructuredStore } from '../../state/structuredStore';
import { ReviewQueueList } from './ReviewQueue';

export function GlobalReviewScreen() {
  const navigate = useNavigate();
  const globalQueue = useStructuredStore((s) => s.globalQueue);
  const loadGlobalQueue = useStructuredStore((s) => s.loadGlobalQueue);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    void loadGlobalQueue();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  const riskCount = globalQueue.filter((i) => i.riskRelated).length;

  return (
    <>
      <header className="topbar">
        <button className="icon-btn" aria-label="Back to Choose Client" onClick={() => navigate('/')}>
          <Icon name="chevron-left" />
        </button>
        <div className="topbar__brand">Review queue — all clients</div>
        <div className="topbar__spacer" />
        <Badge tone="green" icon="shield">Local-only</Badge>
      </header>
      <main className="page stack" style={{ maxWidth: 860 }}>
        <p className="muted small">
          {globalQueue.length} pending item{globalQueue.length === 1 ? '' : 's'} across clients
          {riskCount > 0 && (
            <span style={{ color: 'var(--red)', fontWeight: 600 }}> · {riskCount} risk item{riskCount === 1 ? '' : 's'} require individual review</span>
          )}
        </p>
        <ReviewQueueList items={globalQueue} showClient onChanged={() => setRefreshKey((k) => k + 1)} />
      </main>
    </>
  );
}
