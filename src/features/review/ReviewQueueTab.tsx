import { useEffect, useMemo, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { authService } from '../../core/auth/authService';
import type { QueueItem } from '../../core/db/structuredRepository';
import { useStructuredStore } from '../../state/structuredStore';
import type { ClientContext } from '../dashboard/ClientDashboardLayout';
import { ReviewQueueList } from './ReviewQueue';

export function ReviewQueueTab() {
  const { client } = useOutletContext<ClientContext>();
  const loadClient = useStructuredStore((s) => s.loadClient);
  const [items, setItems] = useState<QueueItem[]>([]);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    const db = authService.current();
    if (!db) return;
    void loadClient(client.id);
    void db.structured.listQueue(client.id).then(setItems);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client.id, refreshKey]);

  const riskCount = useMemo(() => items.filter((i) => i.riskRelated).length, [items]);

  return (
    <div className="stack">
      <div>
        <h2>Review queue</h2>
        <p className="muted small">
          {items.length} pending item{items.length === 1 ? '' : 's'} for {client.displayName}
          {riskCount > 0 && (
            <span style={{ color: 'var(--red)', fontWeight: 600 }}> · {riskCount} risk item{riskCount === 1 ? '' : 's'} require individual review</span>
          )}
        </p>
      </div>
      <ReviewQueueList items={items} showClient={false} onChanged={() => setRefreshKey((k) => k + 1)} />
    </div>
  );
}
