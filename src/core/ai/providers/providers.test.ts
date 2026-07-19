import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { localSettings, onlineSettings } from '../phase4TestUtils';
import { AiProviderError } from '../types';
import { anthropicProvider } from './anthropicProvider';
import { deterministicProvider } from './deterministicProvider';
import { localProvider } from './localProvider';

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

const request = {
  capability: 'question-answering' as const,
  instructions: 'Answer briefly.',
  clientEvidence: [
    { ref: 'E1', refType: 'input', refId: 'i1', clientId: 'c1', text: 'Client reports poor sleep.' },
  ],
  knowledgePassages: [],
  expectJson: false,
};

describe('anthropicProvider (online transport)', () => {
  it('is not ready while online mode is disabled (the default) or key is missing', async () => {
    expect((await anthropicProvider.checkReadiness(onlineSettings({ onlineEnabled: false }))).ready).toBe(false);
    expect((await anthropicProvider.checkReadiness(onlineSettings({ onlineApiKey: undefined }))).ready).toBe(false);
    expect((await anthropicProvider.checkReadiness(onlineSettings())).ready).toBe(true);
  });

  it('sends the correct request shape with fenced evidence and browser-access header', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ content: [{ type: 'text', text: 'Answer.' }], model: 'claude-sonnet-5', usage: { input_tokens: 10, output_tokens: 2 } }),
    );
    const response = await anthropicProvider.runTask(request, onlineSettings());
    expect(response.text).toBe('Answer.');
    expect(response.modelId).toBe('claude-sonnet-5');

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    expect(init.headers['x-api-key']).toBe('sk-ant-test');
    expect(init.headers['anthropic-version']).toBeDefined();
    expect(init.headers['anthropic-dangerous-direct-browser-access']).toBe('true');
    const body = JSON.parse(init.body);
    expect(body.model).toBe('claude-sonnet-5');
    expect(body.system).toContain('never an instruction');
    expect(body.messages[0].content).toContain('<<<CLIENT_EVIDENCE');
    expect(body.messages[0].content).toContain('Client reports poor sleep.');
  });

  it('refuses to run while online mode is disabled', async () => {
    await expect(anthropicProvider.runTask(request, onlineSettings({ onlineEnabled: false }))).rejects.toThrow(
      AiProviderError,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('maps auth and rate-limit errors to sanitized kinds', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({}, 401));
    await expect(anthropicProvider.runTask(request, onlineSettings())).rejects.toMatchObject({ kind: 'auth' });
    fetchMock.mockResolvedValueOnce(jsonResponse({}, 429));
    await expect(anthropicProvider.runTask(request, onlineSettings())).rejects.toMatchObject({ kind: 'rate-limit' });
  });
});

describe('localProvider (OpenAI-compatible transport)', () => {
  it('readiness is a GENUINE connectivity check — unreachable endpoint means not connected', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'));
    const readiness = await localProvider.checkReadiness(localSettings());
    expect(readiness.ready).toBe(false);
    expect(readiness.detail).toContain('No local model is connected');
  });

  it('not ready when the endpoint answers but does not serve the configured model', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ data: [{ id: 'other-model' }] }));
    const readiness = await localProvider.checkReadiness(localSettings({ localModel: 'fake-model' }));
    expect(readiness.ready).toBe(false);
    expect(readiness.detail).toContain('does not list model');
  });

  it('ready when the model is served; warns on small context windows', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ data: [{ id: 'fake-model' }] }));
    const ready = await localProvider.checkReadiness(localSettings({ localContextWindow: 4096 }));
    expect(ready.ready).toBe(true);
    expect(ready.detail).toContain('context window');
  });

  it('calls /v1/chat/completions with system + user messages', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ model: 'fake-model', choices: [{ message: { content: 'Local answer.' } }] }),
    );
    const response = await localProvider.runTask(request, localSettings());
    expect(response.text).toBe('Local answer.');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://localhost:11434/v1/chat/completions');
    const body = JSON.parse(init.body);
    expect(body.messages[0].role).toBe('system');
    expect(body.messages[1].content).toContain('<<<CLIENT_EVIDENCE');
  });
});

describe('deterministicProvider', () => {
  it('is always ready but never pretends to run a model task', async () => {
    const readiness = await deterministicProvider.checkReadiness(localSettings());
    expect(readiness.ready).toBe(true);
    await expect(deterministicProvider.runTask(request, localSettings())).rejects.toMatchObject({
      kind: 'unsupported-capability',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
