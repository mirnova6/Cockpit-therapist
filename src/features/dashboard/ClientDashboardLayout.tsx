import { NavLink, Outlet, useNavigate, useParams } from 'react-router-dom';
import { Icon } from '../../app/components/Icon';
import { Badge, EmptyState, RiskBadge } from '../../app/components/ui';
import { LEVELS_OF_CARE, type Client } from '../../core/db/schema';
import { initials } from '../../lib/format';
import { useAuthStore } from '../../state/authStore';
import { useDataStore } from '../../state/dataStore';

export interface ClientContext {
  client: Client;
}

const TABS = [
  { to: '', label: 'Overview', icon: 'home', end: true },
  { to: 'add', label: 'Add information', icon: 'plus', end: false },
  { to: 'inputs', label: 'Clinical inputs', icon: 'list', end: false },
  { to: 'profile', label: 'Structured profile', icon: 'clipboard', end: false },
  { to: 'assessments', label: 'Assessments', icon: 'activity', end: false },
  { to: 'hypotheses', label: 'Hypotheses', icon: 'search', end: false },
  { to: 'evidence', label: 'Evidence', icon: 'eye', end: false },
  { to: 'review', label: 'Review queue', icon: 'check', end: false },
  { to: 'timeline', label: 'Timeline', icon: 'clock', end: false },
  { to: 'settings', label: 'Client settings', icon: 'settings', end: false },
];

export function ClientDashboardLayout() {
  const { clientId } = useParams<{ clientId: string }>();
  const navigate = useNavigate();
  const client = useDataStore((s) => s.clients.find((c) => c.id === clientId));
  const derived = useDataStore((s) => (clientId ? s.derived[clientId] : undefined));
  const lock = useAuthStore((s) => s.lock);

  if (!client) {
    return (
      <main className="page">
        <div className="card">
          <EmptyState icon="user" title="Client not found">
            <button className="btn btn--secondary" onClick={() => navigate('/')}>
              <Icon name="chevron-left" size={15} /> Back to Choose Client
            </button>
          </EmptyState>
        </div>
      </main>
    );
  }

  const locLabel = LEVELS_OF_CARE.find((l) => l.value === client.levelOfCare)?.label ?? client.levelOfCare;

  return (
    <div className="dash">
      <aside className="dash__sidebar">
        <button className="btn btn--ghost btn--sm" style={{ justifyContent: 'flex-start' }} onClick={() => navigate('/')}>
          <Icon name="chevron-left" size={15} />
          All clients
        </button>

        <div className="stack-sm" style={{ padding: '12px 12px 16px', gap: 10 }}>
          <div className="cluster" style={{ gap: 10 }}>
            <span className="avatar">{initials(client.displayName)}</span>
            <div style={{ minWidth: 0 }}>
              <strong style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {client.displayName}
              </strong>
              <span className="muted">{client.pronouns ?? locLabel}</span>
            </div>
          </div>
          <RiskBadge level={client.risk.level} />
          {client.archived && <Badge tone="neutral" icon="archive">Archived</Badge>}
          {derived && derived.riskReviewPending > 0 && (
            <Badge tone="red" icon="alert">{derived.riskReviewPending} risk review{derived.riskReviewPending > 1 ? 's' : ''} pending</Badge>
          )}
        </div>

        <nav className="stack-sm" style={{ gap: 2 }} aria-label="Client sections">
          {TABS.map((tab) => (
            <NavLink key={tab.to} to={tab.to} end={tab.end} className={({ isActive }) => `sidenav-link ${isActive ? 'active' : ''}`}>
              <Icon name={tab.icon} size={17} />
              {tab.label}
            </NavLink>
          ))}
        </nav>

        <div style={{ flex: 1 }} />
        <div className="stack-sm" style={{ gap: 6, padding: '0 4px' }}>
          <Badge tone="green" icon="shield">Local-only mode</Badge>
          <button className="btn btn--ghost btn--sm" style={{ justifyContent: 'flex-start' }} onClick={() => void lock()}>
            <Icon name="lock" size={15} />
            Lock workspace
          </button>
        </div>
      </aside>

      <div className="dash__main">
        {/* Mobile header */}
        <div className="spread" style={{ marginBottom: 16 }}>
          <div className="cluster" style={{ gap: 10 }}>
            <button className="icon-btn mobile-only" aria-label="Back to Choose Client" onClick={() => navigate('/')}>
              <Icon name="chevron-left" />
            </button>
            <div>
              <h1 style={{ fontSize: '1.25rem' }}>{client.displayName}</h1>
              <span className="muted">
                {[client.pronouns, locLabel].filter(Boolean).join(' · ')}
              </span>
            </div>
          </div>
          <div className="cluster">
            <RiskBadge level={client.risk.level} />
          </div>
        </div>

        <Outlet context={{ client } satisfies ClientContext} />
      </div>

      <nav className="bottom-nav" aria-label="Client sections">
        {TABS.map((tab) => (
          <NavLink key={tab.to} to={tab.to} end={tab.end} className={({ isActive }) => `bottom-nav__item ${isActive ? 'active' : ''}`}>
            <Icon name={tab.icon} size={20} />
            {tab.label.split(' ')[0]}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
