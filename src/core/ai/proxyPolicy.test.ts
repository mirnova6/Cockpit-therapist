/**
 * Tests for the secure online AI proxy reference implementation's policy engine
 * (proxy/policy.mjs). The decision logic is pure, so every enforcement rule is
 * verifiable here without opening a socket.
 */
import { describe, expect, it } from 'vitest';
import {
  buildOperationLog,
  createRateLimiter,
  DEFAULT_CONFIG,
  evaluateRequest,
  REFUSAL,
  sanitizeProviderError,
} from '../../../proxy/policy.mjs';


/** Narrows a decision to its refusal code (undefined when the request passed). */
function refusalOf(d: ReturnType<typeof evaluateRequest>): string | undefined {
  return d.ok ? undefined : d.refusal;
}

const config = {
  ...DEFAULT_CONFIG,
  allowedProviders: ['anthropic-online'],
  allowedModels: ['claude-sonnet-5'],
  allowedEndpoints: ['api.anthropic.com'],
  allowedPurposes: { 'anthropic-online': ['question-answering'] },
  baaSignedProviders: ['anthropic-online'],
};

const session = { workspaceId: 'ws-1', organizationId: 'org-A', localOnly: false };

const goodReq = {
  providerId: 'anthropic-online',
  modelId: 'claude-sonnet-5',
  endpoint: 'https://api.anthropic.com/v1/messages',
  purpose: 'question-answering',
  providerApproved: true,
  consentConfirmed: true,
  outboundConfirmed: true,
  containsPhi: true,
  byteLength: 1000,
};

describe('proxy authentication and kill switches', () => {
  it('refuses without a session (client needs no API key, but must authenticate)', () => {
    const r = evaluateRequest(config, undefined, goodReq);
    expect(r.ok).toBe(false);
    expect(refusalOf(r)).toBe(REFUSAL.UNAUTHENTICATED);
  });

  it('organization kill switch refuses everything, before any other check', () => {
    const r = evaluateRequest({ ...config, killSwitch: true }, session, goodReq);
    expect(r.ok).toBe(false);
    expect(refusalOf(r)).toBe(REFUSAL.KILL_SWITCH);
  });

  it('workspace local-only policy refuses online processing', () => {
    const r = evaluateRequest(config, { ...session, localOnly: true }, goodReq);
    expect(r.ok).toBe(false);
    expect(refusalOf(r)).toBe(REFUSAL.WORKSPACE_LOCAL_ONLY);
  });
});

describe('proxy approval, purpose and allowlist enforcement', () => {
  it('allows a fully-gated request', () => {
    expect(evaluateRequest(config, session, goodReq).ok).toBe(true);
  });

  it('refuses an unapproved provider', () => {
    const r = evaluateRequest(config, session, { ...goodReq, providerApproved: false });
    expect(refusalOf(r)).toBe(REFUSAL.PROVIDER_NOT_APPROVED);
  });

  it('refuses a provider that is not allowlisted', () => {
    const r = evaluateRequest(config, session, { ...goodReq, providerId: 'other' });
    expect(refusalOf(r)).toBe(REFUSAL.PROVIDER_NOT_ALLOWED);
  });

  it('refuses PHI when no signed BAA is recorded', () => {
    const r = evaluateRequest({ ...config, baaSignedProviders: [] }, session, goodReq);
    expect(refusalOf(r)).toBe(REFUSAL.BAA_MISSING);
  });

  it('refuses a model outside the allowlist', () => {
    const r = evaluateRequest(config, session, { ...goodReq, modelId: 'unknown-model' });
    expect(refusalOf(r)).toBe(REFUSAL.MODEL_NOT_ALLOWED);
  });

  it('refuses an endpoint outside the allowlist', () => {
    const r = evaluateRequest(config, session, { ...goodReq, endpoint: 'https://evil.example/v1' });
    expect(refusalOf(r)).toBe(REFUSAL.ENDPOINT_NOT_ALLOWED);
  });

  it('refuses a purpose not approved for the provider', () => {
    const r = evaluateRequest(config, session, { ...goodReq, purpose: 'document-generation' });
    expect(refusalOf(r)).toBe(REFUSAL.PURPOSE_NOT_ALLOWED);
  });

  it('refuses without per-source consent', () => {
    const r = evaluateRequest(config, session, { ...goodReq, consentConfirmed: false });
    expect(refusalOf(r)).toBe(REFUSAL.CONSENT_MISSING);
  });

  it('refuses without explicit outbound confirmation', () => {
    const r = evaluateRequest(config, session, { ...goodReq, outboundConfirmed: false });
    expect(refusalOf(r)).toBe(REFUSAL.NOT_CONFIRMED);
  });

  it('refuses oversized requests before any provider call', () => {
    const r = evaluateRequest(config, session, { ...goodReq, byteLength: 10_000_000 });
    expect(refusalOf(r)).toBe(REFUSAL.TOO_LARGE);
  });
});

describe('proxy rate limiting', () => {
  it('permits up to capacity then refuses', () => {
    const limiter = createRateLimiter({ capacity: 3, refillPerMinute: 0 });
    expect(limiter.take('ws-1')).toBe(true);
    expect(limiter.take('ws-1')).toBe(true);
    expect(limiter.take('ws-1')).toBe(true);
    expect(limiter.take('ws-1')).toBe(false);
  });

  it('limits per workspace independently', () => {
    const limiter = createRateLimiter({ capacity: 1, refillPerMinute: 0 });
    expect(limiter.take('ws-1')).toBe(true);
    expect(limiter.take('ws-1')).toBe(false);
    expect(limiter.take('ws-2')).toBe(true);
  });
});

describe('proxy logging contains no clinical content', () => {
  it('operation log carries metadata only', () => {
    const log = buildOperationLog({
      workspaceId: 'ws-1',
      organizationId: 'org-A',
      providerId: 'anthropic-online',
      modelId: 'claude-sonnet-5',
      purpose: 'question-answering',
      status: 'completed',
      requestBytes: 1234,
      durationMs: 42,
      clientRef: 'opaque-ref',
      // Anything clinical passed in is simply not part of the output shape.
      prompt: 'Client reported suicidal ideation',
      output: 'DRAFT NOTE',
    });
    const serialized = JSON.stringify(log);
    expect(serialized).not.toContain('suicidal');
    expect(serialized).not.toContain('DRAFT NOTE');
    expect(Object.keys(log)).not.toContain('prompt');
    expect(Object.keys(log)).not.toContain('output');
    expect(log.providerId).toBe('anthropic-online');
  });

  it('retention of clinical content is off by default', () => {
    expect(DEFAULT_CONFIG.retainClinicalContent).toBe(false);
  });
});

describe('proxy error sanitization', () => {
  it('maps provider failures to categories without echoing bodies', () => {
    expect(sanitizeProviderError(401).category).toBe('provider-auth');
    expect(sanitizeProviderError(429).category).toBe('provider-rate-limit');
    expect(sanitizeProviderError(503).category).toBe('provider-unavailable');
    expect(sanitizeProviderError(400).category).toBe('provider-request-rejected');
  });

  it('reports cancellation/timeout distinctly', () => {
    const err = new Error('aborted');
    err.name = 'AbortError';
    expect(sanitizeProviderError(undefined, err).category).toBe('cancelled');
  });

  it('never includes upstream detail in the sanitized message', () => {
    const msg = sanitizeProviderError(400).message;
    expect(msg).not.toMatch(/sk-|api[_-]?key|token/i);
  });
});
