/**
 * Local AI Provider — an OpenAI-compatible chat endpoint on this device or
 * local network (Ollama, LM Studio, llama.cpp server, vLLM, …).
 *
 * Readiness is a GENUINE connectivity check: the app never claims a local
 * model is connected unless the endpoint answers and lists the configured
 * model. Clinical text stays on the device/network the clinician pointed
 * the endpoint at; no external telemetry is ever sent.
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

export const LOCAL_PROVIDER_VERSION = 'openai-compatible-chat/v1';

/** Small models often lack the context window for full-record work (§3). */
export const LOCAL_CONTEXT_WARNING_THRESHOLD = 8192;

function normalizeBase(url: string): string {
  return url.trim().replace(/\/+$/, '');
}

async function fetchModels(base: string, signal?: AbortSignal): Promise<string[]> {
  const response = await fetch(`${base}/v1/models`, { signal });
  if (!response.ok) throw new AiProviderError('server', `Endpoint returned HTTP ${response.status}.`);
  const body = (await response.json()) as { data?: Array<{ id?: string }> };
  return (body.data ?? []).map((m) => m.id ?? '').filter(Boolean);
}

export const localProvider: ClinicalAIProvider = {
  id: 'local-endpoint',
  label: 'Local AI (OpenAI-compatible endpoint)',
  providerType: 'local',
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
    const base = normalizeBase(settings.localEndpointUrl);
    if (!base) return { ready: false, detail: 'No local endpoint URL configured.' };
    if (!settings.localModel.trim()) return { ready: false, detail: 'No local model selected.' };
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 4000);
      const models = await fetchModels(base, controller.signal);
      clearTimeout(timer);
      if (!models.includes(settings.localModel.trim())) {
        return {
          ready: false,
          detail: `Endpoint is reachable but does not list model "${settings.localModel}". Available: ${
            models.length ? models.slice(0, 8).join(', ') : 'none'
          }.`,
        };
      }
      const detail =
        settings.localContextWindow && settings.localContextWindow < LOCAL_CONTEXT_WARNING_THRESHOLD
          ? `Connected to ${settings.localModel}. Warning: the configured context window (${settings.localContextWindow} tokens) may be too small for full-record analysis; results may omit older material.`
          : `Connected to ${settings.localModel} at ${base}. Processing stays local.`;
      return { ready: true, detail };
    } catch {
      return {
        ready: false,
        detail: `No local model is connected — the endpoint at ${base} did not respond.`,
      };
    }
  },

  async runTask(request: AiTaskRequest, settings: AiSettings): Promise<AiTaskResponse> {
    const base = normalizeBase(settings.localEndpointUrl);
    if (!base || !settings.localModel.trim()) {
      throw new AiProviderError('not-configured', 'The local endpoint is not configured.');
    }
    const prompt = assemblePrompt(request);
    let response: Response;
    try {
      response = await fetch(`${base}/v1/chat/completions`, {
        method: 'POST',
        signal: request.signal,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model: settings.localModel.trim(),
          temperature: settings.localTemperature ?? 0.2,
          max_tokens: request.maxOutputTokens ?? 4096,
          messages: [
            { role: 'system', content: prompt.system },
            { role: 'user', content: prompt.user },
          ],
        }),
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw new AiProviderError('aborted', 'The request was cancelled.');
      }
      throw new AiProviderError('network', 'Could not reach the local endpoint.');
    }
    if (!response.ok) {
      throw new AiProviderError('server', `The local endpoint returned an error (HTTP ${response.status}).`);
    }
    const body = (await response.json()) as {
      model?: string;
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const text = body.choices?.[0]?.message?.content?.trim() ?? '';
    if (!text) throw new AiProviderError('invalid-response', 'The local model returned no text.');
    return {
      text,
      json: request.expectJson ? extractJson(text) : undefined,
      modelId: body.model ?? settings.localModel,
      providerVersion: LOCAL_PROVIDER_VERSION,
      inputTokens: body.usage?.prompt_tokens,
      outputTokens: body.usage?.completion_tokens,
    };
  },
};
