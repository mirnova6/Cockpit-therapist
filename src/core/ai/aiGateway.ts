/**
 * aiGateway — the single chokepoint every AI operation passes through.
 *
 * Responsibilities (§3, §21, §22, §26):
 *  - Consent verification: online mode must be enabled, the provider
 *    relationship attested as approved for PHI, and EVERY source input must
 *    carry AI-analysis consent and not be marked local-only. Refusals are
 *    logged as refused operations.
 *  - Cross-client isolation: every evidence block is checked against the
 *    active client before any provider call, and attempted violations are
 *    audited without storing clinical plaintext.
 *  - Send preview: for online operations the gateway produces the exact
 *    text (optionally redacted) that would leave the device, so the UI can
 *    show it and require explicit confirmation BEFORE the call.
 *  - Operation logging: one AiOperationRecord per run, including refusals,
 *    failures, and cancellations.
 *  - Cancellation: every in-flight run holds an AbortController registered
 *    here; cancelAllAiOperations() is invoked on workspace lock.
 */
import type { ClinicalDatabase } from '../db/database';
import {
  AI_OUTPUT_SCHEMA_VERSION,
  type AiCapability,
  type AiConsentStatus,
  type AiSettings,
} from './aiSchema';
import { redactText, type RedactionResult } from './redaction';
import {
  AiProviderError,
  type AiTaskRequest,
  type AiTaskResponse,
  type ClinicalAIProvider,
  type EvidenceBlock,
  type KnowledgeBlock,
} from './types';

// ------------------------------------------------------ cancellation pool

const inFlight = new Map<string, AbortController>();
let tokenCounter = 0;

export function newOperationToken(): string {
  return `ai-op-${++tokenCounter}`;
}

export function cancelAiOperation(token: string): void {
  inFlight.get(token)?.abort();
  inFlight.delete(token);
}

/** Called on workspace lock: aborts every in-flight AI request. */
export function cancelAllAiOperations(): void {
  for (const controller of inFlight.values()) controller.abort();
  inFlight.clear();
}

export function inFlightAiOperationCount(): number {
  return inFlight.size;
}

// ---------------------------------------------------------- consent gate

export interface ConsentCheckResult {
  status: AiConsentStatus;
  ok: boolean;
  /** Human-readable explanation of a refusal. */
  reason?: string;
  /** Inputs that lack consent, for the UI to list and deselect. */
  blockedInputIds: string[];
}

export function evaluateConsent(
  settings: AiSettings,
  provider: ClinicalAIProvider,
  sourceInputs: Array<{ id: string; allowAiAnalysis: boolean; localOnly: boolean }>,
): ConsentCheckResult {
  if (provider.providerType === 'deterministic') {
    return { status: 'not-required-deterministic', ok: true, blockedInputIds: [] };
  }
  if (provider.providerType === 'local') {
    // Local processing keeps data on-device; the per-input AI consent flag
    // still applies because it covers AI analysis of any kind.
    const blocked = sourceInputs.filter((i) => !i.allowAiAnalysis).map((i) => i.id);
    if (blocked.length > 0) {
      return {
        status: 'refused-missing-consent',
        ok: false,
        reason: `${blocked.length} selected input${blocked.length > 1 ? 's are' : ' is'} not consented for AI analysis. Deselect ${blocked.length > 1 ? 'them' : 'it'} or update the consent flag on the input.`,
        blockedInputIds: blocked,
      };
    }
    return { status: 'not-required-local', ok: true, blockedInputIds: [] };
  }
  // Online provider
  if (settings.onlineKillSwitch) {
    return {
      status: 'refused-kill-switch',
      ok: false,
      reason:
        'The emergency disable switch for online AI is active. No content leaves this device until it is turned off in AI settings.',
      blockedInputIds: [],
    };
  }
  if (!settings.onlineEnabled) {
    return {
      status: 'refused-online-disabled',
      ok: false,
      reason: 'Online AI processing is disabled. Enable it in AI settings first.',
      blockedInputIds: [],
    };
  }
  if (!settings.onlinePhiApproved) {
    return {
      status: 'refused-provider-not-approved',
      ok: false,
      reason:
        'This provider is not attested as approved for protected health information. Protected information will not be sent. Record the provider approval (e.g. a signed BAA) in AI settings first.',
      blockedInputIds: [],
    };
  }
  const blocked = sourceInputs
    .filter((i) => !i.allowAiAnalysis || i.localOnly)
    .map((i) => i.id);
  if (blocked.length > 0) {
    return {
      status: 'refused-missing-consent',
      ok: false,
      reason: `${blocked.length} selected input${blocked.length > 1 ? 's' : ''} either lack${blocked.length > 1 ? '' : 's'} AI-analysis consent or ${blocked.length > 1 ? 'are' : 'is'} marked local-only and cannot leave this device.`,
      blockedInputIds: blocked,
    };
  }
  return { status: 'verified', ok: true, blockedInputIds: [] };
}

// ------------------------------------------------------ isolation checks

export class IsolationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IsolationError';
  }
}

/**
 * Verifies every evidence block belongs to the active client. Throws and
 * audits (ids only, no clinical text) on violation.
 */
export async function assertClientScope(
  db: ClinicalDatabase,
  clientId: string,
  evidence: EvidenceBlock[],
): Promise<void> {
  const foreign = evidence.filter((block) => block.clientId !== clientId);
  if (foreign.length > 0) {
    await db.audit(
      'security',
      'ai.isolation-violation',
      `blocked ${foreign.length} foreign source(s) for client ${clientId}: ${foreign
        .map((f) => `${f.refType}:${f.refId}`)
        .slice(0, 10)
        .join(', ')}`,
    );
    throw new IsolationError(
      'Cross-client isolation check failed: a selected source belongs to another client. The operation was blocked.',
    );
  }
}

// --------------------------------------------------------- send preview

export interface SendPreview {
  provider: { id: string; label: string; type: string; model: string };
  /** Exactly what would leave the device, per block, after any redaction. */
  blocks: Array<{
    ref: string;
    label: string;
    date?: string;
    text: string;
    redaction?: RedactionResult['replacements'];
  }>;
  clinicianCommand?: string;
  redactionApplied: boolean;
  baaConfirmed: boolean;
}

/**
 * Builds the exact outbound view for clinician confirmation before an
 * ONLINE call. Applies redaction when enabled and returns the transformed
 * text so the UI never implies redaction is invisible or perfect.
 */
export function buildSendPreview(
  settings: AiSettings,
  provider: ClinicalAIProvider,
  evidence: EvidenceBlock[],
  knownNames: string[],
  clinicianCommand?: string,
): { preview: SendPreview; evidence: EvidenceBlock[] } {
  const redacted = evidence.map((block) => {
    if (!settings.redactBeforeSend) return { block, result: undefined };
    const result = redactText(block.text, { knownNames });
    return { block: { ...block, text: result.text }, result };
  });
  return {
    preview: {
      provider: {
        id: provider.id,
        label: provider.label,
        type: provider.providerType,
        model: settings.onlineModel,
      },
      blocks: redacted.map(({ block, result }) => ({
        ref: block.ref,
        label: block.label ?? block.refType,
        date: block.date,
        text: block.text,
        redaction: result?.replacements,
      })),
      clinicianCommand,
      redactionApplied: settings.redactBeforeSend,
      baaConfirmed: settings.baaConfirmed,
    },
    evidence: redacted.map(({ block }) => block),
  };
}

// ------------------------------------------------------------- execution

export interface GatewayRunArgs {
  db: ClinicalDatabase;
  settings: AiSettings;
  provider: ClinicalAIProvider;
  clientId?: string;
  capability: AiCapability;
  instructions: string;
  clinicianCommand?: string;
  clientEvidence: EvidenceBlock[];
  knowledgePassages: KnowledgeBlock[];
  expectJson: boolean;
  maxOutputTokens?: number;
  /** Consent for the inputs backing the evidence, evaluated by the caller. */
  sourceInputs: Array<{ id: string; allowAiAnalysis: boolean; localOnly: boolean }>;
  /** Set once the clinician has confirmed the send preview (online only). */
  onlineSendConfirmed?: boolean;
  operationToken?: string;
}

/**
 * Registry + per-client checks for ONLINE runs (§17). When a provider
 * approval entry exists for the active provider, it is enforced strictly:
 * status must be 'approved', the approval must not be past its review
 * date, and the capability must be allowed. A per-client local-only flag
 * always wins over everything else.
 */
async function onlineGovernanceRefusal(
  db: ClinicalDatabase,
  clientId: string | undefined,
  capability: AiCapability,
  providerId: string,
): Promise<{ status: AiConsentStatus; reason: string } | null> {
  if (clientId) {
    const client = await db.getClient(clientId);
    if (client?.aiLocalOnly) {
      return {
        status: 'refused-client-local-only',
        reason:
          'This client is marked local-only. Nothing about this client may be sent to an online provider, regardless of other settings.',
      };
    }
  }
  const approval = await db.governance.approvalFor(providerId);
  if (!approval) return null; // no registry entry — Phase 4 attestations still gate PHI
  if (approval.approvalStatus !== 'approved') {
    return {
      status: 'refused-provider-not-approved',
      reason: `Provider "${approval.providerName}" is ${approval.approvalStatus} in the approval registry. Protected information will not be sent.`,
    };
  }
  const today = new Date().toISOString().slice(0, 10);
  if (approval.reviewDueDate && approval.reviewDueDate < today) {
    return {
      status: 'refused-approval-expired',
      reason: `The approval for "${approval.providerName}" expired on ${approval.reviewDueDate}. Re-review it in the provider registry before sending.`,
    };
  }
  if (approval.disallowedPurposes.includes(capability)) {
    return {
      status: 'refused-purpose-not-approved',
      reason: `"${capability}" is a disallowed use for provider "${approval.providerName}".`,
    };
  }
  if (approval.approvedPurposes.length > 0 && !approval.approvedPurposes.includes(capability)) {
    return {
      status: 'refused-purpose-not-approved',
      reason: `"${capability}" is not among the approved uses for provider "${approval.providerName}".`,
    };
  }
  return null;
}

export class ConsentRefusedError extends Error {
  constructor(
    readonly consent: ConsentCheckResult,
    message: string,
  ) {
    super(message);
    this.name = 'ConsentRefusedError';
  }
}

/**
 * Runs one AI task through the full gate sequence. Every outcome —
 * refusal, failure, cancellation, success — writes an operation record.
 */
export async function runAiTask(args: GatewayRunArgs): Promise<{
  response: AiTaskResponse;
  operationId: string;
}> {
  const { db, settings, provider } = args;
  const startedAt = Date.now();
  const sourceRefs = args.clientEvidence.map((e) => `${e.refType}:${e.refId}`);
  const knowledgeRefs = args.knowledgePassages.map((k) => `${k.sourceId}:${k.chunkId}`);
  const baseRecord = {
    clientId: args.clientId,
    capability: args.capability,
    providerType: provider.providerType,
    providerId: provider.id,
    modelId: provider.providerType === 'online' ? settings.onlineModel : settings.localModel || 'none',
    providerVersion: '',
    mode: provider.providerType,
    selectedSources: sourceRefs,
    knowledgeSources: knowledgeRefs,
    outputSchemaVersion: AI_OUTPUT_SCHEMA_VERSION,
    phiLeftDevice: provider.providerType === 'online',
    redactionApplied: provider.providerType === 'online' && settings.redactBeforeSend,
    reviewStatus: 'pending-review' as const,
  };

  // 1. Isolation before anything else.
  if (args.clientId) await assertClientScope(db, args.clientId, args.clientEvidence);

  // 2. Consent (kill switch, master switch, attestation, per-input flags).
  const consent = evaluateConsent(settings, provider, args.sourceInputs);
  if (!consent.ok) {
    await db.ai.logOperation({
      ...baseRecord,
      consentStatus: consent.status,
      status: 'refused',
      phiLeftDevice: false,
      errorKind: consent.status,
    });
    throw new ConsentRefusedError(consent, consent.reason ?? 'AI processing was refused.');
  }

  // 3. Online governance: per-client local-only override + approval registry.
  if (provider.providerType === 'online') {
    const refusal = await onlineGovernanceRefusal(db, args.clientId, args.capability, provider.id);
    if (refusal) {
      await db.ai.logOperation({
        ...baseRecord,
        consentStatus: refusal.status,
        status: 'refused',
        phiLeftDevice: false,
        errorKind: refusal.status,
      });
      throw new ConsentRefusedError(
        { status: refusal.status, ok: false, reason: refusal.reason, blockedInputIds: [] },
        refusal.reason,
      );
    }
  }

  // 4. Online sends require an explicit clinician confirmation of the preview.
  if (provider.providerType === 'online' && !args.onlineSendConfirmed) {
    await db.ai.logOperation({
      ...baseRecord,
      consentStatus: consent.status,
      status: 'refused',
      phiLeftDevice: false,
      errorKind: 'send-not-confirmed',
    });
    throw new ConsentRefusedError(
      consent,
      'The outbound preview has not been confirmed. Review what will leave the device first.',
    );
  }

  // 5. Run with cancellation support.
  const token = args.operationToken ?? newOperationToken();
  const controller = new AbortController();
  inFlight.set(token, controller);
  const request: AiTaskRequest = {
    capability: args.capability,
    instructions: args.instructions,
    clinicianCommand: args.clinicianCommand,
    clientEvidence: args.clientEvidence,
    knowledgePassages: args.knowledgePassages,
    expectJson: args.expectJson,
    maxOutputTokens: args.maxOutputTokens,
    signal: controller.signal,
  };
  try {
    const response = await provider.runTask(request, settings);
    const op = await db.ai.logOperation({
      ...baseRecord,
      providerVersion: response.providerVersion,
      modelId: response.modelId,
      consentStatus: consent.status,
      status: 'completed',
      durationMs: Date.now() - startedAt,
      inputTokens: response.inputTokens,
      outputTokens: response.outputTokens,
    });
    return { response, operationId: op.id };
  } catch (error) {
    const kind = error instanceof AiProviderError ? error.kind : 'unknown';
    await db.ai.logOperation({
      ...baseRecord,
      consentStatus: consent.status,
      status: kind === 'aborted' ? 'cancelled' : 'failed',
      phiLeftDevice: provider.providerType === 'online' && kind !== 'network',
      errorKind: kind,
      durationMs: Date.now() - startedAt,
    });
    throw error;
  } finally {
    inFlight.delete(token);
  }
}
