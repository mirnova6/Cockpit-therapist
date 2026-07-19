/**
 * Document generation provider registry.
 *
 * Phase 3 ships the Deterministic Template Generator. Phase 4 registers a
 * "Local AI Generator" and/or "Secure Online AI Generator" here; they flow
 * through the same context → segments → clinician-review pipeline without
 * touching the document database, evidence system, or UI.
 */
import type { DocumentGenerationProvider } from './generationTypes';
import { templateProvider } from './templateProvider';

const providers: DocumentGenerationProvider[] = [templateProvider];

export function listDocumentProviders(): DocumentGenerationProvider[] {
  return [...providers];
}

export function getDocumentProvider(id: string): DocumentGenerationProvider | undefined {
  return providers.find((p) => p.id === id);
}

/** Registers or replaces a provider (used for the Phase 4 AI provider). */
export function registerDocumentProvider(provider: DocumentGenerationProvider): void {
  const index = providers.findIndex((p) => p.id === provider.id);
  if (index >= 0) providers[index] = provider;
  else providers.push(provider);
}

export function unregisterDocumentProvider(id: string): void {
  if (id === templateProvider.id) return; // the deterministic provider always exists
  const index = providers.findIndex((p) => p.id === id);
  if (index >= 0) providers.splice(index, 1);
}

export const DEFAULT_DOCUMENT_PROVIDER_ID = templateProvider.id;
