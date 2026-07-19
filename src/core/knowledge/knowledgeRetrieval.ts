/**
 * Knowledge retrieval — lexical search over chunks of clinician-APPROVED
 * sources only (the repository enforces eligibility). Every passage keeps
 * full provenance; a citation can never point at text that was not
 * actually retrieved.
 */
import { rankByLexicalRelevance } from '../rag/lexical';
import type { KnowledgeRepository } from './knowledgeRepository';
import type { KnowledgePassage, KnowledgeUse } from './knowledgeSchema';

export interface KnowledgeRetrievalOptions {
  /** Prefer sources tagged with this therapy model. */
  therapyModel?: string;
  limit?: number;
}

export async function retrieveKnowledge(
  knowledge: KnowledgeRepository,
  use: KnowledgeUse,
  query: string,
  options: KnowledgeRetrievalOptions = {},
): Promise<KnowledgePassage[]> {
  const candidates = await knowledge.listRetrievableChunks(use);
  const ranked = rankByLexicalRelevance(query, candidates, (c) =>
    [c.source.title, c.source.topic, c.source.therapyModel ?? '', c.chunk.section ?? '', c.chunk.text].join('\n'),
  );
  const limit = options.limit ?? 6;
  return ranked
    .map(({ doc, score, matchedTerms }) => {
      const reasons = [`Matched: ${matchedTerms.join(', ')}`, 'Clinician-approved source'];
      let boosted = score;
      if (
        options.therapyModel &&
        doc.source.therapyModel &&
        doc.source.therapyModel.toLowerCase() === options.therapyModel.toLowerCase()
      ) {
        boosted += 1.5;
        reasons.push(`Therapy model matches (${doc.source.therapyModel})`);
      }
      return {
        passage: {
          sourceId: doc.source.id,
          chunkId: doc.chunk.id,
          title: doc.source.title,
          citation: doc.source.citationDetails,
          editionOrVersion: doc.source.editionOrVersion,
          section: doc.chunk.section,
          page: doc.chunk.page,
          status: doc.source.status,
          text: doc.chunk.text,
          score: boosted,
          reasons,
        } satisfies KnowledgePassage,
        boosted,
      };
    })
    .sort((a, b) => b.boosted - a.boosted)
    .slice(0, limit)
    .map((r) => r.passage);
}

/**
 * Citation guard: a claim may cite a knowledge passage only if the passage
 * was actually retrieved AND shares vocabulary with the claim. Prevents
 * invented references (§6) — used by the verification pass.
 */
export function passageSupportsClaim(passageText: string, claim: string): boolean {
  const ranked = rankByLexicalRelevance(claim, [passageText], (t) => t);
  return ranked.length > 0 && ranked[0].matchedTerms.length >= 2;
}
