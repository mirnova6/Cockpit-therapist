import { useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate, useParams } from 'react-router-dom';
import { Icon } from '../../app/components/Icon';
import { Badge, EmptyState, RiskBadge } from '../../app/components/ui';
import { LEVELS_OF_CARE, type Client } from '../../core/db/schema';
import { initials } from '../../lib/format';
import { useAiStore } from '../../state/aiStore';
import { useAuthStore } from '../../state/authStore';
import { useDataStore } from '../../state/dataStore';

export interface ClientContext {
  client: Client;
}

interface NavItem {
  to: string;
  label: string;
  icon: string;
  end: boolean;
}

interface NavGroup {
  key: string;
  label: string;
  icon: string;
  items: NavItem[];
}

/**
 * All client sections, grouped. The desktop sidebar shows every link under
 * a group header; the mobile bottom nav shows exactly these FIVE groups
 * (never 14 items) and opens a sheet listing the group's destinations.
 */
const NAV_GROUPS: NavGroup[] = [
  {
    key: 'overview',
    label: 'Overview',
    icon: 'home',
    items: [
      { to: '', label: 'Overview', icon: 'home', end: true },
      { to: 'timeline', label: 'Timeline', icon: 'clock', end: false },
    ],
  },
  {
    key: 'documentation',
    label: 'Documentation',
    icon: 'file',
    items: [
      { to: 'add', label: 'Add information', icon: 'plus', end: false },
      { to: 'inputs', label: 'Clinical inputs', icon: 'list', end: false },
      { to: 'dap', label: 'DAP notes', icon: 'file', end: false },
      { to: 'plan', label: 'Treatment plan', icon: 'clipboard', end: false },
      { to: 'goals', label: 'Goals & objectives', icon: 'check', end: false },
      { to: 'documents', label: 'Documents', icon: 'download', end: false },
    ],
  },
  {
    key: 'understanding',
    label: 'Clinical Understanding',
    icon: 'compass',
    items: [
      { to: 'profile', label: 'Structured profile', icon: 'clipboard', end: false },
      { to: 'hypotheses', label: 'Hypotheses', icon: 'search', end: false },
      { to: 'evidence', label: 'Evidence', icon: 'eye', end: false },
      { to: 'formulation', label: 'Case formulation', icon: 'compass', end: false },
      { to: 'interventions', label: 'Best interventions', icon: 'heart', end: false },
      { to: 'safety-trust', label: 'Safety & trust', icon: 'shield', end: false },
      { to: 'assistant', label: 'Clinical assistant', icon: 'search', end: false },
      { to: 'analyze', label: 'Analyze & update', icon: 'activity', end: false },
    ],
  },
  {
    key: 'assessments-risk',
    label: 'Assessments and Risk',
    icon: 'activity',
    items: [
      { to: 'assessments', label: 'Assessments', icon: 'activity', end: false },
      { to: 'review', label: 'Review queue', icon: 'check', end: false },
    ],
  },
  {
    key: 'more',
    label: 'More',
    icon: 'settings',
    items: [{ to: 'settings', label: 'Client settings', icon: 'settings', end: false }],
  },
];

function groupIsActive(group: NavGroup, pathname: string, basePath: string): boolean {
  return group.items.some((item) => {
    const full = item.to ? `${basePath}/${item.to}` : basePath;
    return item.end || item.to === ''
      ? pathname === full
      : pathname === full || pathname.startsWith(`${full}/`);
  });
}

export function ClientDashboardLayout() {
  const { clientId } = useParams<{ clientId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const client = useDataStore((s) => s.clients.find((c) => c.id === clientId));
  const derived = useDataStore((s) => (clientId ? s.derived[clientId] : undefined));
  const lock = useAuthStore((s) => s.lock);
  const aiSettings = useAiStore((s) => s.settings);
  const activeReady = useAiStore((s) => s.activeReady);
  const [openGroup, setOpenGroup] = useState<string>();

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
  const basePath = `/clients/${client.id}`;
  const aiOnline = aiSettings.activeProviderType === 'online' && activeReady;
  const aiLocal = aiSettings.activeProviderType === 'local' && activeReady;

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

        <nav className="stack-sm" style={{ gap: 2, overflowY: 'auto' }} aria-label="Client sections">
          {NAV_GROUPS.map((group) => (
            <div key={group.key}>
              <div className="sidenav-group">{group.label}</div>
              {group.items.map((tab) => (
                <NavLink key={tab.to} to={tab.to} end={tab.end} className={({ isActive }) => `sidenav-link ${isActive ? 'active' : ''}`}>
                  <Icon name={tab.icon} size={17} />
                  {tab.label}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>

        <div style={{ flex: 1 }} />
        <div className="stack-sm" style={{ gap: 6, padding: '0 4px' }}>
          {aiOnline ? (
            <Badge tone="amber" icon="upload">Online AI enabled</Badge>
          ) : aiLocal ? (
            <Badge tone="blue" icon="shield">Local AI mode</Badge>
          ) : (
            <Badge tone="green" icon="shield">Local-only mode</Badge>
          )}
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

      {/* Mobile: five grouped destinations, never 14 items. */}
      {openGroup && <div className="bottom-sheet__backdrop mobile-only" onClick={() => setOpenGroup(undefined)} />}
      {openGroup && (
        <div className="bottom-sheet mobile-only" role="menu" aria-label={NAV_GROUPS.find((g) => g.key === openGroup)?.label}>
          {NAV_GROUPS.find((g) => g.key === openGroup)?.items.map((tab) => (
            <NavLink
              key={tab.to}
              to={tab.to}
              end={tab.end}
              className={({ isActive }) => `sidenav-link ${isActive ? 'active' : ''}`}
              onClick={() => setOpenGroup(undefined)}
            >
              <Icon name={tab.icon} size={17} />
              {tab.label}
            </NavLink>
          ))}
        </div>
      )}
      <nav className="bottom-nav" aria-label="Client sections">
        {NAV_GROUPS.map((group) => {
          const active = groupIsActive(group, location.pathname, basePath);
          return (
            <button
              key={group.key}
              type="button"
              className={`bottom-nav__item ${active ? 'active' : ''}`}
              style={{ background: 'none', border: 'none', cursor: 'pointer' }}
              aria-expanded={openGroup === group.key}
              onClick={() => setOpenGroup((prev) => (prev === group.key ? undefined : group.key))}
            >
              <Icon name={group.icon} size={20} />
              {group.label.split(' ')[0]}
            </button>
          );
        })}
      </nav>
    </div>
  );
}
