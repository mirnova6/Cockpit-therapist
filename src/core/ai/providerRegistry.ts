/**
 * ClinicalAIProvider registry. Vendor-neutral: features ask for the ACTIVE
 * provider (from settings) or a provider by id; nothing outside the
 * providers directory imports a vendor module directly.
 *
 * Test builds may register additional providers (e.g. a scripted fake) via
 * registerAiProvider — production registration is fixed at these three.
 */
import type { AiProviderType, AiSettings } from './aiSchema';
import { anthropicProvider } from './providers/anthropicProvider';
import { deterministicProvider } from './providers/deterministicProvider';
import { localProvider } from './providers/localProvider';
import type { ClinicalAIProvider } from './types';

const providers = new Map<string, ClinicalAIProvider>([
  [deterministicProvider.id, deterministicProvider],
  [localProvider.id, localProvider],
  [anthropicProvider.id, anthropicProvider],
]);

export function listAiProviders(): ClinicalAIProvider[] {
  return [...providers.values()];
}

export function getAiProvider(id: string): ClinicalAIProvider | undefined {
  return providers.get(id);
}

export function getProviderByType(type: AiProviderType): ClinicalAIProvider {
  const match = [...providers.values()].find((p) => p.providerType === type);
  return match ?? deterministicProvider;
}

/** The provider selected by settings. */
export function activeAiProvider(settings: AiSettings): ClinicalAIProvider {
  return getProviderByType(settings.activeProviderType);
}

/** For tests: register/replace a provider (e.g. a scripted fake). */
export function registerAiProvider(provider: ClinicalAIProvider): void {
  providers.set(provider.id, provider);
}

export function unregisterAiProvider(id: string): void {
  if (id === deterministicProvider.id) return; // the honest fallback always exists
  providers.delete(id);
}
