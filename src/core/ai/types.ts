/**
 * ClinicalAIProvider — the vendor-neutral seam for every AI capability.
 *
 * The rest of the application NEVER talks to a model vendor directly and a
 * provider NEVER touches the database: a provider receives an assembled
 * task (instructions + clearly-delimited untrusted evidence blocks) and
 * returns text/JSON. Everything the app does with that output — parsing,
 * validation, verification, persistence — happens in application services,
 * so no provider ever has database write authority (§21).
 */
import type { AiCapability, AiProviderType, AiSettings } from './aiSchema';

/** A block of untrusted client evidence supplied to the provider as DATA. */
export interface EvidenceBlock {
  /** Stable reference the model must cite, e.g. "E1", "E2". */
  ref: string;
  /** 'input' | 'fact' | 'assessment' | 'hypothesis' | 'goal' | … */
  refType: string;
  refId: string;
  clientId: string;
  date?: string;
  label?: string;
  approvalStatus?: string;
  text: string;
}

/** A retrieved passage from an approved knowledge source (untrusted data). */
export interface KnowledgeBlock {
  /** Stable reference the model must cite, e.g. "K1". */
  ref: string;
  sourceId: string;
  chunkId: string;
  title: string;
  citation: string;
  section?: string;
  page?: string;
  text: string;
}

export interface AiTaskRequest {
  capability: AiCapability;
  /** Application-authored task rules. Never contains client text. */
  instructions: string;
  /** The clinician's own command/question, kept separate from data. */
  clinicianCommand?: string;
  clientEvidence: EvidenceBlock[];
  knowledgePassages: KnowledgeBlock[];
  /** When set, the provider must return parseable JSON. */
  expectJson: boolean;
  maxOutputTokens?: number;
  signal?: AbortSignal;
}

export interface AiTaskResponse {
  text: string;
  /** Parsed JSON when expectJson was set and parsing succeeded. */
  json?: unknown;
  modelId: string;
  providerVersion: string;
  inputTokens?: number;
  outputTokens?: number;
}

export type ProviderReadiness =
  | { ready: true; detail: string }
  | { ready: false; detail: string };

export interface ClinicalAIProvider {
  readonly id: string;
  readonly label: string;
  readonly providerType: AiProviderType;
  readonly capabilities: AiCapability[];
  /**
   * TRUE only when the provider is genuinely usable right now — a real key
   * for online, a real reachable endpoint for local. Never claims a model
   * is connected when it is not (§3).
   */
  checkReadiness(settings: AiSettings): Promise<ProviderReadiness>;
  /**
   * Runs one task. Only local/online providers implement text completion;
   * the deterministic provider throws, because deterministic features are
   * computed by application engines, not by prompting.
   */
  runTask(request: AiTaskRequest, settings: AiSettings): Promise<AiTaskResponse>;
}

export class AiProviderError extends Error {
  constructor(
    /** Sanitized machine label, safe for the operations log. */
    readonly kind:
      | 'not-configured'
      | 'network'
      | 'auth'
      | 'rate-limit'
      | 'server'
      | 'invalid-response'
      | 'aborted'
      | 'unsupported-capability',
    message: string,
  ) {
    super(message);
    this.name = 'AiProviderError';
  }
}

/**
 * Extracts the first JSON object/array from model text output. Models
 * sometimes wrap JSON in code fences or prose; this stays tolerant without
 * ever evaluating anything.
 */
export function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidates = [fenced?.[1], text];
  for (const candidate of candidates) {
    if (!candidate) continue;
    const start = candidate.search(/[[{]/);
    if (start === -1) continue;
    for (let end = candidate.length; end > start; end--) {
      const slice = candidate.slice(start, end).trim();
      if (!slice) continue;
      try {
        return JSON.parse(slice);
      } catch {
        // keep shrinking
      }
    }
  }
  throw new AiProviderError('invalid-response', 'The model did not return parseable JSON.');
}
