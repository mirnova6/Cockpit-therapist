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

export const DEFAULT_DOCUMENT_PROVIDER_ID = templateProvider.id;
