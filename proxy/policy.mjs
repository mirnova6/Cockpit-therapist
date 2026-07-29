/**
 * Proxy policy engine (Phase 9 §10–§11) — pure, dependency-free, and unit
 * tested from the app's vitest suite. Keeping the decision logic separate from
 * the HTTP server means the enforcement rules can be verified without a socket.
 *
 * Every refusal returns a CATEGORY, never an upstream provider body, so
 * provider errors cannot leak configuration or clinical content.
 */

export const REFUSAL = {
  UNAUTHENTICATED: 'unauthenticated',
  KILL_SWITCH: 'org-kill-switch',
  WORKSPACE_LOCAL_ONLY: 'workspace-local-only',
  PROVIDER_NOT_ALLOWED: 'provider-not-allowed',
  PROVIDER_NOT_APPROVED: 'provider-not-approved',
  MODEL_NOT_ALLOWED: 'model-not-allowed',
  ENDPOINT_NOT_ALLOWED: 'endpoint-not-allowed',
  PURPOSE_NOT_ALLOWED: 'purpose-not-allowed',
  BAA_MISSING: 'baa-missing',
  CONSENT_MISSING: 'consent-missing',
  NOT_CONFIRMED: 'outbound-not-confirmed',
  TOO_LARGE: 'request-too-large',
  RATE_LIMITED: 'rate-limited',
};

export const DEFAULT_CONFIG = {
  /** Hard organization-wide stop. */
  killSwitch: false,
  allowedProviders: [],
  allowedModels: [],
  allowedEndpoints: [],
  /** Purposes permitted per provider id. */
  allowedPurposes: {},
  /** Providers with a signed BAA/contract recorded. */
  baaSignedProviders: [],
  maxRequestBytes: 200_000,
  rateLimit: { capacity: 20, refillPerMinute: 20 },
  /** Off by default: the proxy stores NO prompts or outputs. */
  retainClinicalContent: false,
  requestTimeoutMs: 30_000,
};

/**
 * Decide whether a request may proceed.
 * @returns {{ok: true} | {ok: false, refusal: string, message: string}}
 */
export function evaluateRequest(config, session, req) {
  const cfg = { ...DEFAULT_CONFIG, ...config };

  if (!session || !session.workspaceId) {
    return deny(REFUSAL.UNAUTHENTICATED, 'Valid session required.');
  }
  // Kill switch precedes everything else.
  if (cfg.killSwitch) {
    return deny(REFUSAL.KILL_SWITCH, 'Online processing is disabled by the organization kill switch.');
  }
  if (session.localOnly) {
    return deny(REFUSAL.WORKSPACE_LOCAL_ONLY, 'This workspace is configured local-only.');
  }
  if (!cfg.allowedProviders.includes(req.providerId)) {
    return deny(REFUSAL.PROVIDER_NOT_ALLOWED, 'Provider is not on the allowlist.');
  }
  if (!req.providerApproved) {
    return deny(REFUSAL.PROVIDER_NOT_APPROVED, 'Provider is not approved for protected information.');
  }
  if (req.containsPhi && !cfg.baaSignedProviders.includes(req.providerId)) {
    return deny(REFUSAL.BAA_MISSING, 'No signed BAA/contract is recorded for this provider.');
  }
  if (!cfg.allowedModels.includes(req.modelId)) {
    return deny(REFUSAL.MODEL_NOT_ALLOWED, 'Model is not on the allowlist.');
  }
  if (req.endpoint && !cfg.allowedEndpoints.some((host) => hostMatches(req.endpoint, host))) {
    return deny(REFUSAL.ENDPOINT_NOT_ALLOWED, 'Endpoint host is not on the allowlist.');
  }
  const purposes = cfg.allowedPurposes[req.providerId] ?? [];
  if (!purposes.includes(req.purpose)) {
    return deny(REFUSAL.PURPOSE_NOT_ALLOWED, 'Purpose is not approved for this provider.');
  }
  if (!req.consentConfirmed) {
    return deny(REFUSAL.CONSENT_MISSING, 'Per-source AI consent was not confirmed.');
  }
  if (!req.outboundConfirmed) {
    return deny(REFUSAL.NOT_CONFIRMED, 'The clinician has not confirmed the outbound preview.');
  }
  if ((req.byteLength ?? 0) > cfg.maxRequestBytes) {
    return deny(REFUSAL.TOO_LARGE, `Request exceeds ${cfg.maxRequestBytes} bytes.`);
  }
  return { ok: true };
}

function deny(refusal, message) {
  return { ok: false, refusal, message };
}

function hostMatches(endpoint, allowedHost) {
  try {
    return new URL(endpoint).host === allowedHost;
  } catch {
    return false;
  }
}

/** Simple per-workspace token bucket. */
export function createRateLimiter(cfg = DEFAULT_CONFIG.rateLimit) {
  const buckets = new Map();
  return {
    take(key, now = Date.now()) {
      const b = buckets.get(key) ?? { tokens: cfg.capacity, last: now };
      const elapsedMin = (now - b.last) / 60_000;
      b.tokens = Math.min(cfg.capacity, b.tokens + elapsedMin * cfg.refillPerMinute);
      b.last = now;
      if (b.tokens < 1) {
        buckets.set(key, b);
        return false;
      }
      b.tokens -= 1;
      buckets.set(key, b);
      return true;
    },
  };
}

/**
 * Build the audit record for an operation. Deliberately accepts ONLY metadata —
 * there is no parameter through which prompt or output text could arrive.
 */
export function buildOperationLog(entry) {
  return {
    at: new Date().toISOString(),
    workspaceId: entry.workspaceId,
    organizationId: entry.organizationId,
    providerId: entry.providerId,
    modelId: entry.modelId,
    purpose: entry.purpose,
    status: entry.status,
    refusal: entry.refusal,
    errorCategory: entry.errorCategory,
    requestBytes: entry.requestBytes,
    durationMs: entry.durationMs,
    // No prompt, no output, no client identifiers beyond an opaque reference.
    clientRef: entry.clientRef,
  };
}

/** Map an upstream failure to a category; never echo the provider body. */
export function sanitizeProviderError(status, err) {
  if (err && err.name === 'AbortError') return { category: 'cancelled', message: 'Request cancelled or timed out.' };
  if (status === 401 || status === 403) return { category: 'provider-auth', message: 'Provider rejected credentials.' };
  if (status === 429) return { category: 'provider-rate-limit', message: 'Provider rate limit reached.' };
  if (status && status >= 500) return { category: 'provider-unavailable', message: 'Provider is unavailable.' };
  if (status && status >= 400) return { category: 'provider-request-rejected', message: 'Provider rejected the request.' };
  return { category: 'provider-error', message: 'Provider call failed.' };
}
