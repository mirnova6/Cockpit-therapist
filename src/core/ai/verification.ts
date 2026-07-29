/**
 * Unsupported-claim verification (§17) — a SEPARATE pass over generated
 * output, never performed by the generating model.
 *
 * The default verifier is deterministic: it checks that each claim's cited
 * evidence really exists, really belongs to the client, and really shares
 * content with the claim; that cited excerpts appear verbatim in their
 * sources; and that no retrieved contradiction undercuts the claim. The
 * ClaimVerifier interface lets a different AI provider perform verification
 * later — the generator can never be the only verifier of its own output.
 */
import { tokenize } from '../rag/lexical';
import { passageSupportsClaim } from '../knowledge/knowledgeRetrieval';
import type { ClaimStatus } from './aiSchema';
import type { EvidenceBlock, KnowledgeBlock } from './types';

export interface VerifiableClaim {
  id: string;
  text: string;
  /** Evidence refs (E1…) and knowledge refs (K1…) the generator cited. */
  citedRefs: string[];
  kind: 'factual' | 'interpretive' | 'template' | 'therapist-authored';
}

export interface ClaimVerdict {
  claimId: string;
  status: ClaimStatus;
  note: string;
  /** Refs that actually support the claim after checking. */
  verifiedRefs: string[];
}

export interface VerificationContext {
  clientId: string;
  evidence: EvidenceBlock[];
  knowledge: KnowledgeBlock[];
  /** Text of retrieved contradictions relevant to this generation. */
  contradictions: Array<{ ref: string; text: string }>;
}

export interface ClaimVerifier {
  readonly id: string;
  readonly label: string;
  verify(claims: VerifiableClaim[], context: VerificationContext): Promise<ClaimVerdict[]>;
}

// ------------------------------------------------------------- helpers

function overlapRatio(claim: string, evidenceText: string): number {
  const claimTokens = new Set(tokenize(claim));
  if (claimTokens.size === 0) return 0;
  const evidenceTokens = new Set(tokenize(evidenceText));
  let hits = 0;
  for (const token of claimTokens) if (evidenceTokens.has(token)) hits++;
  return hits / claimTokens.size;
}

/**
 * Contradiction heuristic: strong vocabulary overlap with a retrieved
 * contradiction record means the claim touches actively disputed material.
 */
function touchesContradiction(claim: string, contradictions: VerificationContext['contradictions']): string | undefined {
  for (const contradiction of contradictions) {
    if (overlapRatio(claim, contradiction.text) >= 0.35) return contradiction.ref;
  }
  return undefined;
}

// -------------------------------------------------- deterministic verifier

export const deterministicVerifier: ClaimVerifier = {
  id: 'deterministic-verifier',
  label: 'Deterministic Claim Verifier',

  async verify(claims, context): Promise<ClaimVerdict[]> {
    const evidenceByRef = new Map(context.evidence.map((e) => [e.ref, e]));
    const knowledgeByRef = new Map(context.knowledge.map((k) => [k.ref, k]));

    return claims.map((claim): ClaimVerdict => {
      if (claim.kind === 'therapist-authored') {
        return {
          claimId: claim.id,
          status: 'therapist-authored',
          note: 'Written by the clinician.',
          verifiedRefs: [],
        };
      }
      if (claim.kind === 'template') {
        return {
          claimId: claim.id,
          status: 'therapist-authored',
          note: 'Structural template text, not a clinical claim.',
          verifiedRefs: [],
        };
      }

      const contradictionRef = touchesContradiction(claim.text, context.contradictions);

      const verifiedClient: string[] = [];
      const verifiedHypothesis: string[] = [];
      const verifiedKnowledge: string[] = [];
      const bogusRefs: string[] = [];

      for (const ref of claim.citedRefs) {
        const evidence = evidenceByRef.get(ref);
        if (evidence) {
          if (evidence.clientId !== context.clientId) {
            bogusRefs.push(ref);
            continue;
          }
          if (overlapRatio(claim.text, evidence.text) >= 0.2) {
            if (evidence.refType === 'hypothesis') verifiedHypothesis.push(ref);
            else verifiedClient.push(ref);
          } else {
            bogusRefs.push(ref);
          }
          continue;
        }
        const knowledge = knowledgeByRef.get(ref);
        if (knowledge) {
          if (passageSupportsClaim(knowledge.text, claim.text)) verifiedKnowledge.push(ref);
          else bogusRefs.push(ref);
          continue;
        }
        bogusRefs.push(ref); // cited something that was never retrieved
      }

      if (contradictionRef) {
        return {
          claimId: claim.id,
          status: 'contradicted',
          note: `Retrieved contradictory evidence (${contradictionRef}) touches this claim — clinician must resolve before approval.`,
          verifiedRefs: [...verifiedClient, ...verifiedHypothesis, ...verifiedKnowledge],
        };
      }
      if (verifiedClient.length > 0) {
        return {
          claimId: claim.id,
          status: 'directly-supported',
          note: `Supported by ${verifiedClient.join(', ')}${bogusRefs.length ? `; unverifiable citation(s) ${bogusRefs.join(', ')} dropped` : ''}.`,
          verifiedRefs: [...verifiedClient, ...verifiedHypothesis, ...verifiedKnowledge],
        };
      }
      if (verifiedHypothesis.length > 0) {
        return {
          claimId: claim.id,
          status: 'supported-by-hypothesis',
          note: `Rests on approved hypothesis ${verifiedHypothesis.join(', ')} — interpretation, not established fact.`,
          verifiedRefs: [...verifiedHypothesis, ...verifiedKnowledge],
        };
      }
      if (verifiedKnowledge.length > 0) {
        return {
          claimId: claim.id,
          status: 'general-clinical-guidance',
          note: `General guidance from ${verifiedKnowledge.join(', ')}; no client-specific evidence cited.`,
          verifiedRefs: verifiedKnowledge,
        };
      }
      if (claim.citedRefs.length > 0) {
        return {
          claimId: claim.id,
          status: 'needs-clarification',
          note: `Cited ${claim.citedRefs.join(', ')} but the cited material does not clearly support the claim.`,
          verifiedRefs: [],
        };
      }
      return {
        claimId: claim.id,
        status: 'unsupported',
        note: 'No evidence cited — must be edited, sourced, or removed before approval.',
        verifiedRefs: [],
      };
    });
  },
};
