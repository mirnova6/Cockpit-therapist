/**
 * Deterministic Provider — the honest no-model mode.
 *
 * It exists in the registry so every feature has a provider identity to log
 * and display, but it does NOT do text completion: features running in
 * deterministic mode are computed by the application's own engines
 * (retrieval, rule-based synthesis, template generation) and are labeled in
 * the UI as working without an AI model. Calling runTask is a programming
 * error and throws.
 */
import type { AiSettings } from '../aiSchema';
import {
  AiProviderError,
  type AiTaskRequest,
  type AiTaskResponse,
  type ClinicalAIProvider,
  type ProviderReadiness,
} from '../types';

export const DETERMINISTIC_PROVIDER_VERSION = 'cockpit-deterministic/p4.1';

export const DETERMINISTIC_NOTE =
  'No AI model is connected. This result was assembled deterministically from the client record by rule-based retrieval and templates.';

export const deterministicProvider: ClinicalAIProvider = {
  id: 'deterministic',
  label: 'Deterministic (no AI model)',
  providerType: 'deterministic',
  capabilities: [
    'extraction',
    'document-generation',
    'clinical-synthesis',
    'case-formulation',
    'intervention-recommendation',
    'safety-strategy',
    'question-answering',
    'claim-verification',
  ],

  async checkReadiness(_settings: AiSettings): Promise<ProviderReadiness> {
    return {
      ready: true,
      detail: 'Always available. Results are rule-based; no model output is simulated.',
    };
  },

  async runTask(_request: AiTaskRequest, _settings: AiSettings): Promise<AiTaskResponse> {
    throw new AiProviderError(
      'unsupported-capability',
      'The deterministic provider does not run model tasks; deterministic features are computed by application engines.',
    );
  },
};
