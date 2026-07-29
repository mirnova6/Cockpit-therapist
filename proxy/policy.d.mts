/**
 * Type declarations for the proxy reference implementation's policy engine, so
 * the app's test suite can exercise the enforcement rules with type safety.
 */
export interface ProxyConfig {
  killSwitch: boolean;
  allowedProviders: string[];
  allowedModels: string[];
  allowedEndpoints: string[];
  allowedPurposes: Record<string, string[]>;
  baaSignedProviders: string[];
  maxRequestBytes: number;
  rateLimit: { capacity: number; refillPerMinute: number };
  retainClinicalContent: boolean;
  requestTimeoutMs: number;
}

export interface ProxySession {
  workspaceId: string;
  organizationId?: string;
  localOnly?: boolean;
}

export interface ProxyRequest {
  providerId: string;
  modelId: string;
  endpoint?: string;
  purpose: string;
  providerApproved: boolean;
  consentConfirmed: boolean;
  outboundConfirmed: boolean;
  containsPhi?: boolean;
  byteLength?: number;
  clientRef?: string;
}

export type ProxyDecision = { ok: true } | { ok: false; refusal: string; message: string };

export interface ProxyOperationLog {
  at: string;
  workspaceId?: string;
  organizationId?: string;
  providerId?: string;
  modelId?: string;
  purpose?: string;
  status?: string;
  refusal?: string;
  errorCategory?: string;
  requestBytes?: number;
  durationMs?: number;
  clientRef?: string;
}

export declare const REFUSAL: {
  UNAUTHENTICATED: string;
  KILL_SWITCH: string;
  WORKSPACE_LOCAL_ONLY: string;
  PROVIDER_NOT_ALLOWED: string;
  PROVIDER_NOT_APPROVED: string;
  MODEL_NOT_ALLOWED: string;
  ENDPOINT_NOT_ALLOWED: string;
  PURPOSE_NOT_ALLOWED: string;
  BAA_MISSING: string;
  CONSENT_MISSING: string;
  NOT_CONFIRMED: string;
  TOO_LARGE: string;
  RATE_LIMITED: string;
};

export declare const DEFAULT_CONFIG: ProxyConfig;

export declare function evaluateRequest(
  config: Partial<ProxyConfig>,
  session: ProxySession | undefined,
  req: ProxyRequest,
): ProxyDecision;

export declare function createRateLimiter(cfg?: { capacity: number; refillPerMinute: number }): {
  take(key: string, now?: number): boolean;
};

export declare function buildOperationLog(entry: Record<string, unknown>): ProxyOperationLog;

export declare function sanitizeProviderError(
  status?: number,
  err?: unknown,
): { category: string; message: string };
