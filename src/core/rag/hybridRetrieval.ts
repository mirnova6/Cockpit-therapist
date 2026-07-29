/**
 * Phase 9 hybrid retrieval configuration and score combination.
 *
 * Pure module: no database, no embedding provider, no React. It defines the
 * retrieval modes, the weighting system, and how lexical + semantic + metadata
 * components combine into a final score. `clientRetrieval` consumes this;
 * the embedding layer supplies semantic scores from above, which keeps the
 * dependency direction acyclic (embeddings → rag, never the reverse).
 *
 * SAFETY RULES encoded here:
 *  - Lexical retrieval is NEVER removed. Hybrid *adds* a semantic signal.
 *  - The default mode is Lexical Only. Semantic/hybrid require a genuinely
 *    configured provider AND a clinician activation gate.
 *  - If a semantic score is unavailable for a candidate, its semantic
 *    contribution is 0 — it is never imputed, and lexical still ranks it.
 */

export type RetrievalMode = 'lexical' | 'semantic-test' | 'hybrid';

export const RETRIEVAL_MODES: Array<{ value: RetrievalMode; label: string; detail: string }> = [
  {
    value: 'lexical',
    label: 'Lexical only',
    detail: 'Deterministic keyword/BM25-style ranking. Always available; the safe default.',
  },
  {
    value: 'semantic-test',
    label: 'Semantic only (testing)',
    detail: 'Vector similarity alone. For evaluation and comparison — not recommended for clinical use.',
  },
  {
    value: 'hybrid',
    label: 'Hybrid (recommended once evaluated)',
    detail: 'Lexical + semantic + metadata. Keeps exact wording, dates, medications and quotes discoverable.',
  },
];

export interface HybridWeights {
  /** Weight applied to the normalized lexical score. */
  lexical: number;
  /** Weight applied to the normalized semantic similarity. */
  semantic: number;
  /** Weight applied to the metadata boost bundle (approval, recency, risk…). */
  metadata: number;
}

/**
 * Safe defaults: lexical stays dominant so exact clinical wording, assessment
 * names, medications and quotations remain discoverable when hybrid is on.
 */
export const DEFAULT_HYBRID_WEIGHTS: HybridWeights = { lexical: 1, semantic: 0.6, metadata: 1 };

export function normalizeWeights(w?: Partial<HybridWeights>): HybridWeights {
  const merged = { ...DEFAULT_HYBRID_WEIGHTS, ...(w ?? {}) };
  // Guard against negative or non-finite configuration.
  const clamp = (n: number) => (Number.isFinite(n) && n >= 0 ? n : 0);
  return { lexical: clamp(merged.lexical), semantic: clamp(merged.semantic), metadata: clamp(merged.metadata) };
}

/** Stable key for joining a semantic score to a retrieval candidate. */
export function semanticKey(refType: string, refId: string): string {
  return `${refType}:${refId}`;
}

export interface ScoreComponents {
  lexical: number;
  semantic: number;
  metadata: number;
  final: number;
}

/**
 * Combine the three signals for a given mode.
 *
 * - `lexical`: metadata still applies (this is the Phase 4 behavior), semantic ignored.
 * - `semantic-test`: semantic + metadata only, for A/B comparison in evaluation.
 * - `hybrid`: all three, weighted.
 */
export function combineScores(
  mode: RetrievalMode,
  parts: { lexical: number; semantic: number; metadata: number },
  weights: HybridWeights = DEFAULT_HYBRID_WEIGHTS,
): ScoreComponents {
  const w = normalizeWeights(weights);
  let final: number;
  switch (mode) {
    case 'semantic-test':
      final = parts.semantic * w.semantic + parts.metadata * w.metadata;
      break;
    case 'hybrid':
      final = parts.lexical * w.lexical + parts.semantic * w.semantic + parts.metadata * w.metadata;
      break;
    case 'lexical':
    default:
      final = parts.lexical * w.lexical + parts.metadata * w.metadata;
      break;
  }
  return {
    lexical: round(parts.lexical),
    semantic: round(parts.semantic),
    metadata: round(parts.metadata),
    final: round(final),
  };
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/**
 * Resolve the mode that will ACTUALLY be used. Semantic and hybrid silently
 * degrading to lexical would be dishonest, so this returns both the effective
 * mode and the reason when it differs from what was requested — the caller
 * surfaces that in the debug panel and UI.
 */
export function resolveEffectiveMode(
  requested: RetrievalMode,
  ctx: { semanticAvailable: boolean; activated: boolean },
): { mode: RetrievalMode; downgradedReason?: string } {
  if (requested === 'lexical') return { mode: 'lexical' };
  if (!ctx.semanticAvailable) {
    return {
      mode: 'lexical',
      downgradedReason:
        'No embedding provider is configured or no vectors are stored — semantic ranking is NOT active; lexical ranking was used.',
    };
  }
  if (!ctx.activated) {
    return {
      mode: 'lexical',
      downgradedReason:
        'Hybrid/semantic retrieval has not been activated by a clinician after evaluation — lexical ranking was used.',
    };
  }
  return { mode: requested };
}
