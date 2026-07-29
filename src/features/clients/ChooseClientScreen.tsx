import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon } from '../../app/components/Icon';
import { ProcessingStatusBadge } from '../../app/components/ProcessingStatusBadge';
import { Badge, EmptyState, RiskBadge } from '../../app/components/ui';
import { useStructuredStore } from '../../state/structuredStore';
import {
  CLIENT_STATUSES,
  LEVELS_OF_CARE,
  RISK_LEVELS,
  type Client,
} from '../../core/db/schema';
import { fmtDate, initials, relTime } from '../../lib/format';
import { useAuthStore } from '../../state/authStore';
import { useDataStore } from '../../state/dataStore';
import {
  DEFAULT_FILTER,
  filterClients,
  SORT_OPTIONS,
  type ClientDerived,
  type ClientListFilter,
} from './clientFilters';
import { ClientFormModal } from './ClientFormModal';

function levelOfCareLabel(value: string): string {
  return LEVELS_OF_CARE.find((l) => l.value === value)?.label ?? value;
}

function statusLabel(value: string): string {
  return CLIENT_STATUSES.find((s) => s.value === value)?.label ?? value;
}

function ClientCard({
  client,
  derived,
  onOpen,
}: {
  client: Client;
  derived?: ClientDerived;
  onOpen: () => void;
}) {
  const mainDx = client.diagnoses[0];
  return (
    <button className="client-card" onClick={onOpen} aria-label={`Open ${client.displayName}`}>
      <div className="cluster" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div className="cluster" style={{ gap: 12 }}>
          <span className="avatar">{initials(client.displayName)}</span>
          <span>
            <strong style={{ display: 'block', fontSize: '1.02rem' }}>{client.displayName}</strong>
            <span className="muted">
              {[client.pronouns, client.preferredIdentifier].filter(Boolean).join(' · ') || ' '}
            </span>
          </span>
        </div>
        <RiskBadge level={client.risk.level} />
      </div>

      <div className="cluster" style={{ gap: 6 }}>
        <Badge tone="blue">{levelOfCareLabel(client.levelOfCare)}</Badge>
        <Badge tone={client.status === 'active' ? 'green' : 'neutral'}>{statusLabel(client.status)}</Badge>
        {derived && derived.riskReviewPending > 0 && (
          <Badge tone="red" icon="alert">
            {derived.riskReviewPending} risk {derived.riskReviewPending === 1 ? 'entry' : 'entries'} to review
          </Badge>
        )}
      </div>

      <dl className="stack-sm" style={{ gap: 3, margin: 0 }}>
        <div className="meta-row">
          <dt>Main diagnosis</dt>
          <dd>{mainDx ? `${mainDx.label}${mainDx.kind === 'impression' ? ' (impression)' : ''}` : 'Not yet documented'}</dd>
        </div>
        <div className="meta-row">
          <dt>Last session</dt>
          <dd>{derived?.lastSessionDate ? fmtDate(derived.lastSessionDate) : 'No sessions recorded'}</dd>
        </div>
        <div className="meta-row">
          <dt>Last updated</dt>
          <dd>{relTime(client.updatedAt)}</dd>
        </div>
        <div className="meta-row">
          <dt>Treatment plan</dt>
          <dd>No plan on file</dd>
        </div>
      </dl>
    </button>
  );
}

export function ChooseClientScreen() {
  const navigate = useNavigate();
  const { clients, derived, prefs, createClient, noteClientViewed } = useDataStore();
  const lock = useAuthStore((s) => s.lock);
  const globalQueue = useStructuredStore((s) => s.globalQueue);
  const loadGlobalQueue = useStructuredStore((s) => s.loadGlobalQueue);
  const [filter, setFilter] = useState<ClientListFilter>(DEFAULT_FILTER);
  const [showAdd, setShowAdd] = useState(false);

  useEffect(() => {
    void loadGlobalQueue();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const visible = useMemo(
    () => filterClients(clients, derived, filter),
    [clients, derived, filter],
  );

  const recent = useMemo(() => {
    return prefs.recentlyViewed
      .map((r) => clients.find((c) => c.id === r.clientId && !c.archived))
      .filter((c): c is Client => Boolean(c))
      .slice(0, 6);
  }, [prefs.recentlyViewed, clients]);

  const archivedCount = clients.filter((c) => c.archived).length;
  const pendingRiskTotal = clients
    .filter((c) => !c.archived)
    .reduce((sum, c) => sum + (derived[c.id]?.riskReviewPending ?? 0), 0);

  const openClient = (id: string) => {
    void noteClientViewed(id);
    navigate(`/clients/${id}`);
  };

  const set = (patch: Partial<ClientListFilter>) => setFilter((f) => ({ ...f, ...patch }));

  return (
    <>
      <header className="topbar">
        <div className="topbar__brand">
          <span className="topbar__logo"><Icon name="compass" size={17} /></span>
          Cockpit
        </div>
        <ProcessingStatusBadge />
        <div className="topbar__spacer" />
        <button className="icon-btn" aria-label="Workspace settings" title="Workspace settings" onClick={() => navigate('/settings')}>
          <Icon name="settings" />
        </button>
        <button className="icon-btn" aria-label="Lock workspace" title="Lock workspace" onClick={() => void lock()}>
          <Icon name="lock" />
        </button>
      </header>

      <main id="main-content" tabIndex={-1} className="page stack" style={{ gap: 20 }}>
        <div className="spread">
          <div>
            <h1>Choose client</h1>
            <p className="muted">
              {clients.filter((c) => !c.archived).length} active {clients.filter((c) => !c.archived).length === 1 ? 'client' : 'clients'}
              {pendingRiskTotal > 0 && (
                <> · <span style={{ color: 'var(--red)', fontWeight: 600 }}>{pendingRiskTotal} risk {pendingRiskTotal === 1 ? 'entry' : 'entries'} awaiting review</span></>
              )}
            </p>
          </div>
          <div className="cluster">
            {globalQueue.length > 0 && (
              <button className="btn btn--secondary" onClick={() => navigate('/review')}>
                <Icon name="check" size={15} />
                Review queue ({globalQueue.length})
              </button>
            )}
            <button className="btn btn--primary" onClick={() => setShowAdd(true)}>
              <Icon name="plus" size={16} />
              Add client
            </button>
          </div>
        </div>

        <div className="card card--pad stack" style={{ gap: 12 }}>
          <div className="cluster">
            <div style={{ position: 'relative', flex: '1 1 240px' }}>
              <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--ink-faint)', display: 'inline-flex' }}>
                <Icon name="search" size={16} />
              </span>
              <input
                className="input"
                style={{ paddingLeft: 36 }}
                placeholder="Search by name, identifier, or diagnosis…"
                value={filter.search}
                onChange={(e) => set({ search: e.target.value })}
                aria-label="Search clients"
              />
            </div>
            <select className="select" style={{ width: 'auto' }} value={filter.sort} onChange={(e) => set({ sort: e.target.value as ClientListFilter['sort'] })} aria-label="Sort clients">
              {SORT_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>Sort: {o.label}</option>
              ))}
            </select>
          </div>
          <div className="cluster">
            <select className="select" style={{ width: 'auto' }} value={filter.risk} onChange={(e) => set({ risk: e.target.value as ClientListFilter['risk'] })} aria-label="Filter by risk level">
              <option value="all">Risk: all</option>
              {RISK_LEVELS.map((r) => (
                <option key={r.value} value={r.value}>Risk: {r.label}</option>
              ))}
            </select>
            <select className="select" style={{ width: 'auto' }} value={filter.levelOfCare} onChange={(e) => set({ levelOfCare: e.target.value as ClientListFilter['levelOfCare'] })} aria-label="Filter by level of care">
              <option value="all">Level of care: all</option>
              {LEVELS_OF_CARE.map((l) => (
                <option key={l.value} value={l.value}>{l.label}</option>
              ))}
            </select>
            <select className="select" style={{ width: 'auto' }} value={filter.status} onChange={(e) => set({ status: e.target.value as ClientListFilter['status'] })} aria-label="Filter by treatment status">
              <option value="all">Status: all</option>
              {CLIENT_STATUSES.map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>
            {archivedCount > 0 && (
              <label className="chip" style={{ userSelect: 'none' }}>
                <input
                  type="checkbox"
                  checked={filter.showArchived}
                  onChange={(e) => set({ showArchived: e.target.checked })}
                  style={{ accentColor: 'var(--brand)' }}
                />
                Archived ({archivedCount})
              </label>
            )}
          </div>
        </div>

        {recent.length > 0 && !filter.showArchived && (
          <div className="stack-sm">
            <span className="card__title"><Icon name="clock" size={14} /> Recently viewed</span>
            <div className="chips">
              {recent.map((c) => (
                <button key={c.id} className="chip" onClick={() => openClient(c.id)}>
                  <span className="avatar" style={{ width: 22, height: 22, fontSize: '0.65rem', borderRadius: 7 }}>
                    {initials(c.displayName)}
                  </span>
                  {c.displayName}
                </button>
              ))}
            </div>
          </div>
        )}

        {visible.length === 0 ? (
          <div className="card">
            <EmptyState icon="users" title={filter.showArchived ? 'No archived clients match' : clients.length === 0 ? 'No clients yet' : 'No clients match your filters'}>
              {clients.length === 0 ? (
                <p>Add your first client to begin building their clinical record.</p>
              ) : (
                <p>Try adjusting the search or filters above.</p>
              )}
            </EmptyState>
          </div>
        ) : (
          <div className="grid-cards">
            {visible.map((c) => (
              <ClientCard key={c.id} client={c} derived={derived[c.id]} onOpen={() => openClient(c.id)} />
            ))}
          </div>
        )}
      </main>

      {showAdd && (
        <ClientFormModal
          onClose={() => setShowAdd(false)}
          onSave={async (draft) => {
            const client = await createClient(draft);
            openClient(client.id);
          }}
        />
      )}
    </>
  );
}
