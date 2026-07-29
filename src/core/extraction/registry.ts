/**
 * Extraction provider registry.
 *
 * Phase 2 ships the deterministic rule-based provider. Phase 4 registers
 * the AI extraction provider here at unlock (when an AI provider is
 * genuinely configured); both flow through the same proposal → clinician
 * review → approval pipeline — the database schema and review workflow do
 * not change.
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

/** Registers or replaces a provider (used for the Phase 4 AI provider). */
export function registerExtractionProvider(provider: ExtractionProvider): void {
  const index = providers.findIndex((p) => p.id === provider.id);
  if (index >= 0) providers[index] = provider;
  else providers.push(provider);
}

export function unregisterExtractionProvider(id: string): void {
  if (id === ruleBasedProvider.id) return; // the deterministic provider always exists
  const index = providers.findIndex((p) => p.id === id);
  if (index >= 0) providers.splice(index, 1);
}

export const DEFAULT_PROVIDER_ID = ruleBasedProvider.id;
export const AI_EXTRACTION_PROVIDER_ID = 'ai-extraction';
