/**
 * Secure Online AI Provider — Anthropic Messages API over HTTPS.
 *
 * This provider performs a REAL network call and therefore only ever runs
 * after the aiGateway has verified: online mode enabled, per-input AI
 * consent, provider-approval attestation, and the clinician's explicit
 * confirmation of exactly what leaves the device. The provider itself is a
 * pure transport: no database access, no retries that hide failures, no
 * telemetry.
 */
import type { AiSettings } from '../aiSchema';
import { assemblePrompt } from '../promptAssembly';
import {
  AiProviderError,
  extractJson,
  type AiTaskRequest,
  type AiTaskResponse,
  type ClinicalAIProvider,
  type ProviderReadiness,
} from '../types';

const API_URL = 'https://api.anthropic.com/v1/messages';
const API_VERSION = '2023-06-01';
export const ANTHROPIC_PROVIDER_VERSION = 'anthropic-messages/2023-06-01';

export const anthropicProvider: ClinicalAIProvider = {
  id: 'anthropic-online',
  label: 'Anthropic Claude (Secure Online)',
  providerType: 'online',
  capabilities: [
    'extraction',
    'document-generation',
    'clinical-synthesis',
    'case-formulation',
    'hypothesis-drafting',
    'intervention-recommendation',
    'safety-strategy',
    'question-answering',
    'knowledge-assistance',
    'claim-verification',
  ],

  async checkReadiness(settings: AiSettings): Promise<ProviderReadiness> {
    if (!settings.onlineEnabled) {
      return { ready: false, detail: 'Online AI processing is disabled (the default).' };
    }
    if (!settings.onlineApiKey?.trim()) {
      return { ready: false, detail: 'No API key configured.' };
    }
    if (!settings.onlineModel.trim()) {
      return { ready: false, detail: 'No model selected.' };
    }
    return {
      ready: true,
      detail: `Configured for ${settings.onlineModel}. Requests leave this device over HTTPS.`,
    };
  },

  async runTask(request: AiTaskRequest, settings: AiSettings): Promise<AiTaskResponse> {
    if (!settings.onlineEnabled) {
      throw new AiProviderError('not-configured', 'Online AI processing is disabled.');
    }
    const apiKey = settings.onlineApiKey?.trim();
    if (!apiKey) throw new AiProviderError('not-configured', 'No API key configured.');

    const prompt = assemblePrompt(request);
    let response: Response;
    try {
      response = await fetch(API_URL, {
        method: 'POST',
        signal: request.signal,
        headers: {
          'content-type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': API_VERSION,
          // Required for direct browser-origin calls to the Anthropic API.
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify({
          model: settings.onlineModel,
          max_tokens: request.maxOutputTokens ?? 4096,
          system: prompt.system,
          messages: [{ role: 'user', content: prompt.user }],
        }),
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw new AiProviderError('aborted', 'The request was cancelled.');
      }
      throw new AiProviderError('network', 'Could not reach the Anthropic API.');
    }

    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        throw new AiProviderError('auth', 'The API rejected the configured key.');
      }
      if (response.status === 429) {
        throw new AiProviderError('rate-limit', 'The API rate limit was reached. Try again shortly.');
      }
      throw new AiProviderError('server', `The API returned an error (HTTP ${response.status}).`);
    }

    const body = (await response.json()) as {
      content?: Array<{ type: string; text?: string }>;
      model?: string;
      usage?: { input_tokens?: number; output_tokens?: number };
    };
    const text = (body.content ?? [])
      .filter((block) => block.type === 'text' && typeof block.text === 'string')
      .map((block) => block.text)
      .join('\n')
      .trim();
    if (!text) throw new AiProviderError('invalid-response', 'The model returned no text.');

    return {
      text,
      json: request.expectJson ? extractJson(text) : undefined,
      modelId: body.model ?? settings.onlineModel,
      providerVersion: ANTHROPIC_PROVIDER_VERSION,
      inputTokens: body.usage?.input_tokens,
      outputTokens: body.usage?.output_tokens,
    };
  },
};
