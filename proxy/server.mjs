/**
 * Cockpit secure online AI proxy — reference server (Phase 9 §10).
 *
 * Dependency-free Node HTTP server. It is a REFERENCE implementation: run it
 * for development against fictional data only. It is not deployed by this
 * repository and is not approved for real PHI — see proxy/README.md for the
 * exact blockers.
 *
 * Design guarantees:
 *  - The provider API key lives ONLY in this process's environment. Clients
 *    authenticate with a workspace session token and never hold a provider key.
 *  - Every request is re-validated here; client-side gates are not trusted.
 *  - Prompts and outputs are never logged and (by default) never stored.
 */
import { createServer } from 'node:http';
import {
  buildOperationLog,
  createRateLimiter,
  DEFAULT_CONFIG,
  evaluateRequest,
  REFUSAL,
  sanitizeProviderError,
} from './policy.mjs';

const PORT = Number(process.env.PORT ?? 8787);

// Workspace session tokens: {"workspaceId":"token"}. A production deployment
// replaces this with real identity (SSO/OIDC), rotation and revocation.
const TOKENS = JSON.parse(process.env.COCKPIT_PROXY_TOKENS ?? '{}');
const PROVIDER_KEY = process.env.COCKPIT_PROVIDER_KEY ?? '';

const CONFIG = {
  ...DEFAULT_CONFIG,
  killSwitch: process.env.COCKPIT_KILL_SWITCH === '1',
  allowedProviders: (process.env.COCKPIT_ALLOWED_PROVIDERS ?? 'anthropic-online').split(',').filter(Boolean),
  allowedModels: (process.env.COCKPIT_ALLOWED_MODELS ?? 'claude-sonnet-5').split(',').filter(Boolean),
  allowedEndpoints: (process.env.COCKPIT_ALLOWED_ENDPOINTS ?? 'api.anthropic.com').split(',').filter(Boolean),
  allowedPurposes: JSON.parse(process.env.COCKPIT_ALLOWED_PURPOSES ?? '{"anthropic-online":["question-answering"]}'),
  baaSignedProviders: (process.env.COCKPIT_BAA_PROVIDERS ?? '').split(',').filter(Boolean),
  retainClinicalContent: false, // never enabled by default
};

const limiter = createRateLimiter(CONFIG.rateLimit);
/** Operation log: metadata only, in memory for the reference server. */
const operations = [];

function sessionFor(req) {
  const auth = req.headers.authorization ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token) return undefined;
  const workspaceId = Object.keys(TOKENS).find((ws) => TOKENS[ws] === token);
  if (!workspaceId) return undefined;
  return {
    workspaceId,
    organizationId: process.env.COCKPIT_ORG_ID ?? 'org-local',
    localOnly: process.env.COCKPIT_WORKSPACE_LOCAL_ONLY === '1',
  };
}

function send(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(payload);
}

async function readBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > maxBytes) {
        reject(Object.assign(new Error('too large'), { tooLarge: true }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

const server = createServer(async (req, res) => {
  // Health/readiness reveal status only — never configuration or secrets.
  if (req.url === '/health') return send(res, 200, { status: 'ok' });
  if (req.url === '/ready') {
    return send(res, PROVIDER_KEY ? 200 : 503, {
      ready: Boolean(PROVIDER_KEY),
      killSwitch: CONFIG.killSwitch,
      // Presence only; never the key or the allowlist contents.
      providerConfigured: Boolean(PROVIDER_KEY),
    });
  }
  if (req.method !== 'POST' || req.url !== '/v1/ai') {
    return send(res, 404, { error: 'not-found' });
  }

  const started = Date.now();
  const session = sessionFor(req);
  if (!session) {
    return send(res, 401, { refusal: REFUSAL.UNAUTHENTICATED, message: 'Valid session required.' });
  }
  if (!limiter.take(session.workspaceId)) {
    operations.push(
      buildOperationLog({ ...session, status: 'refused', refusal: REFUSAL.RATE_LIMITED, durationMs: 0 }),
    );
    return send(res, 429, { refusal: REFUSAL.RATE_LIMITED, message: 'Too many requests.' });
  }

  let raw;
  try {
    raw = await readBody(req, CONFIG.maxRequestBytes);
  } catch (err) {
    const refusal = err?.tooLarge ? REFUSAL.TOO_LARGE : 'bad-request';
    return send(res, err?.tooLarge ? 413 : 400, { refusal, message: 'Request rejected.' });
  }

  let body;
  try {
    body = JSON.parse(raw.toString('utf8'));
  } catch {
    return send(res, 400, { refusal: 'bad-request', message: 'Malformed request.' });
  }

  const decision = evaluateRequest(CONFIG, session, { ...body, byteLength: raw.length });
  if (!decision.ok) {
    operations.push(
      buildOperationLog({
        ...session,
        providerId: body.providerId,
        modelId: body.modelId,
        purpose: body.purpose,
        status: 'refused',
        refusal: decision.refusal,
        requestBytes: raw.length,
        durationMs: Date.now() - started,
        clientRef: body.clientRef,
      }),
    );
    return send(res, 403, { refusal: decision.refusal, message: decision.message });
  }

  // Upstream call with timeout + cancellation.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CONFIG.requestTimeoutMs);
  req.on('aborted', () => controller.abort());

  try {
    const upstream = await fetch(body.endpoint, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'content-type': 'application/json',
        'x-api-key': PROVIDER_KEY, // key never leaves the server
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body.providerPayload),
    });
    clearTimeout(timer);

    if (!upstream.ok) {
      const sanitized = sanitizeProviderError(upstream.status, undefined);
      operations.push(
        buildOperationLog({
          ...session,
          providerId: body.providerId,
          modelId: body.modelId,
          purpose: body.purpose,
          status: 'failed',
          errorCategory: sanitized.category,
          requestBytes: raw.length,
          durationMs: Date.now() - started,
          clientRef: body.clientRef,
        }),
      );
      // Upstream body is intentionally NOT forwarded.
      return send(res, 502, sanitized);
    }

    const json = await upstream.json();
    operations.push(
      buildOperationLog({
        ...session,
        providerId: body.providerId,
        modelId: body.modelId,
        purpose: body.purpose,
        status: 'completed',
        requestBytes: raw.length,
        durationMs: Date.now() - started,
        clientRef: body.clientRef,
      }),
    );
    // Response passes through to the client; nothing clinical is retained here.
    return send(res, 200, json);
  } catch (err) {
    clearTimeout(timer);
    const sanitized = sanitizeProviderError(undefined, err);
    operations.push(
      buildOperationLog({
        ...session,
        providerId: body.providerId,
        modelId: body.modelId,
        purpose: body.purpose,
        status: 'failed',
        errorCategory: sanitized.category,
        requestBytes: raw.length,
        durationMs: Date.now() - started,
        clientRef: body.clientRef,
      }),
    );
    return send(res, 504, sanitized);
  }
});

if (process.env.NODE_ENV !== 'test') {
  server.listen(PORT, () => {
    // Startup log contains no secrets and no clinical content.
    console.log(`Cockpit AI proxy (reference) listening on :${PORT}`);
    console.log('Fictional/de-identified development use only — not approved for real PHI.');
  });
}

export { server, CONFIG, operations };
