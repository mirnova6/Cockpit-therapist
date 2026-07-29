/**
 * Pure search / filter / sort logic for the Choose Client screen.
 * Kept free of React so it is directly unit-testable.
 */
import {
  riskWeight,
  type Client,
  type ClientStatus,
  type LevelOfCare,
  type RiskLevel,
} from '../../core/db/schema';

export interface ClientDerived {
  /** Most recent session date across the client's inputs, if any. */
  lastSessionDate?: string;
  /** Most recent input entry date, if any. */
  lastInputAt?: string;
  /** Count of risk-flagged inputs awaiting clinician review. */
  riskReviewPending: number;
  inputCount: number;
}

export type SortKey =
  | 'name'
  | 'risk'
  | 'last-session'
  | 'last-updated'
  | 'level-of-care'
  | 'status';

export const SORT_OPTIONS: Array<{ value: SortKey; label: string }> = [
  { value: 'last-updated', label: 'Last updated' },
  { value: 'name', label: 'Name' },
  { value: 'risk', label: 'Risk level' },
  { value: 'last-session', label: 'Last session' },
  { value: 'level-of-care', label: 'Level of care' },
  { value: 'status', label: 'Treatment status' },
];

export interface ClientListFilter {
  search: string;
  risk: RiskLevel | 'all';
  levelOfCare: LevelOfCare | 'all';
  status: ClientStatus | 'all';
  showArchived: boolean;
  sort: SortKey;
}

export const DEFAULT_FILTER: ClientListFilter = {
  search: '',
  risk: 'all',
  levelOfCare: 'all',
  status: 'all',
  showArchived: false,
  sort: 'last-updated',
};

export function matchesSearch(client: Client, term: string): boolean {
  if (!term.trim()) return true;
  const needle = term.trim().toLowerCase();
  const haystacks = [
    client.displayName,
    client.preferredIdentifier ?? '',
    client.pronouns ?? '',
    ...client.diagnoses.map((d) => `${d.label} ${d.code ?? ''}`),
  ];
  return haystacks.some((h) => h.toLowerCase().includes(needle));
}

export function filterClients(
  clients: Client[],
  derived: Record<string, ClientDerived | undefined>,
  filter: ClientListFilter,
): Client[] {
  const visible = clients.filter((client) => {
    if (client.archived !== filter.showArchived) return false;
    if (!matchesSearch(client, filter.search)) return false;
    if (filter.risk !== 'all' && client.risk.level !== filter.risk) return false;
    if (filter.levelOfCare !== 'all' && client.levelOfCare !== filter.levelOfCare) return false;
    if (filter.status !== 'all' && client.status !== filter.status) return false;
    return true;
  });
  return sortClients(visible, derived, filter.sort);
}

export function sortClients(
  clients: Client[],
  derived: Record<string, ClientDerived | undefined>,
  sort: SortKey,
): Client[] {
  const copy = [...clients];
  switch (sort) {
    case 'name':
      return copy.sort((a, b) => a.displayName.localeCompare(b.displayName));
    case 'risk':
      return copy.sort(
        (a, b) => riskWeight(b.risk.level) - riskWeight(a.risk.level) ||
          a.displayName.localeCompare(b.displayName),
      );
    case 'last-session':
      return copy.sort((a, b) =>
        (derived[b.id]?.lastSessionDate ?? '').localeCompare(derived[a.id]?.lastSessionDate ?? ''),
      );
    case 'level-of-care':
      return copy.sort((a, b) => a.levelOfCare.localeCompare(b.levelOfCare));
    case 'status':
      return copy.sort((a, b) => a.status.localeCompare(b.status));
    case 'last-updated':
    default:
      return copy.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
}
