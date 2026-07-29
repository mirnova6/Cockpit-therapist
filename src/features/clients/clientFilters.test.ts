import { describe, expect, it } from 'vitest';
import type { Client } from '../../core/db/schema';
import { DEFAULT_FILTER, filterClients, matchesSearch, sortClients, type ClientDerived } from './clientFilters';

function makeClient(overrides: Partial<Client>): Client {
  return {
    id: overrides.id ?? crypto.randomUUID(),
    displayName: 'Client',
    contactEnabled: false,
    levelOfCare: 'outpatient',
    status: 'active',
    diagnoses: [],
    medications: [],
    risk: { level: 'not-assessed' },
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    archived: false,
    ...overrides,
  };
}

const noDerived: Record<string, ClientDerived | undefined> = {};

describe('clientFilters', () => {
  it('searches name, identifier, and diagnosis labels', () => {
    const client = makeClient({
      displayName: 'J. Torres',
      preferredIdentifier: 'CH-1042',
      diagnoses: [{ id: 'd', label: 'PTSD', code: 'F43.10', kind: 'diagnosis' }],
    });
    expect(matchesSearch(client, 'torres')).toBe(true);
    expect(matchesSearch(client, 'ch-1042')).toBe(true);
    expect(matchesSearch(client, 'ptsd')).toBe(true);
    expect(matchesSearch(client, 'f43')).toBe(true);
    expect(matchesSearch(client, 'zzz')).toBe(false);
    expect(matchesSearch(client, '  ')).toBe(true);
  });

  it('filters by risk, level of care, status, and archived', () => {
    const clients = [
      makeClient({ id: 'a', risk: { level: 'high' }, levelOfCare: 'residential' }),
      makeClient({ id: 'b', risk: { level: 'low' }, status: 'discharged' }),
      makeClient({ id: 'c', archived: true }),
    ];
    expect(filterClients(clients, noDerived, { ...DEFAULT_FILTER, risk: 'high' }).map((c) => c.id)).toEqual(['a']);
    expect(
      filterClients(clients, noDerived, { ...DEFAULT_FILTER, levelOfCare: 'residential' }).map((c) => c.id),
    ).toEqual(['a']);
    expect(filterClients(clients, noDerived, { ...DEFAULT_FILTER, status: 'discharged' }).map((c) => c.id)).toEqual(['b']);
    expect(filterClients(clients, noDerived, { ...DEFAULT_FILTER, showArchived: true }).map((c) => c.id)).toEqual(['c']);
  });

  it('sorts by risk severity with acute first', () => {
    const clients = [
      makeClient({ id: 'low', risk: { level: 'low' } }),
      makeClient({ id: 'acute', risk: { level: 'acute' } }),
      makeClient({ id: 'mod', risk: { level: 'moderate' } }),
    ];
    expect(sortClients(clients, noDerived, 'risk').map((c) => c.id)).toEqual(['acute', 'mod', 'low']);
  });

  it('sorts by last session using derived data', () => {
    const clients = [makeClient({ id: 'a' }), makeClient({ id: 'b' })];
    const derived = {
      a: { lastSessionDate: '2026-06-01', riskReviewPending: 0, inputCount: 1 },
      b: { lastSessionDate: '2026-07-01', riskReviewPending: 0, inputCount: 1 },
    };
    expect(sortClients(clients, derived, 'last-session').map((c) => c.id)).toEqual(['b', 'a']);
  });

  it('sorts by name and by last updated', () => {
    const clients = [
      makeClient({ id: 'z', displayName: 'Zoe', updatedAt: '2026-03-01T00:00:00Z' }),
      makeClient({ id: 'a', displayName: 'Ana', updatedAt: '2026-05-01T00:00:00Z' }),
    ];
    expect(sortClients(clients, noDerived, 'name').map((c) => c.id)).toEqual(['a', 'z']);
    expect(sortClients(clients, noDerived, 'last-updated').map((c) => c.id)).toEqual(['a', 'z']);
  });
});
