/**
 * Extraction provider registry.
 *
 * Phase 2 ships one deterministic provider. A future local or cloud AI
 * provider registers here (Phase 4) and immediately flows through the same
 * proposal → clinician review → approval pipeline; the database schema and
 * review workflow do not change.
 */
import { ruleBasedProvider } from './ruleBasedProvider';
import type { ExtractionProvider } from './types';

const providers: ExtractionProvider[] = [ruleBasedProvider];

export function listProviders(): ExtractionProvider[] {
  return [...providers];
}

export function getProvider(id: string): ExtractionProvider | undefined {
  return providers.find((p) => p.id === id);
}

export const DEFAULT_PROVIDER_ID = ruleBasedProvider.id;
