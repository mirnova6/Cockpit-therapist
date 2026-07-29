/**
 * Deterministic lexical relevance scoring shared by client-record retrieval
 * and knowledge retrieval: tokenization with a clinical synonym lexicon,
 * IDF weighting over the searched corpus, and length normalization
 * (a BM25-style formula with fixed parameters). No embeddings, no network —
 * ranking is fully explainable in the retrieval-debug panel.
 */

const STOPWORDS = new Set(
  // "client(s)" is a stopword because virtually every clinical record
  // mentions it — matching on it would rank noise, not relevance.
  'a an and are as at be but by client clients for from has have how i in is it its of on or that the their there they this to was what when where which who will with would you your'.split(
    ' ',
  ),
);

/** Small clinical synonym/stem groups so "drinking" matches "alcohol use". */
const SYNONYMS: Record<string, string[]> = {
  alcohol: ['drinking', 'drink', 'drinks', 'drank', 'sober', 'sobriety', 'abstinence', 'abstinent', 'etoh'],
  substance: ['drug', 'drugs', 'use', 'using', 'used'],
  relationship: ['relationships', 'relational', 'partner', 'marriage', 'marital', 'family', 'friend', 'friends', 'interpersonal'],
  sleep: ['insomnia', 'sleeping', 'sleeps', 'nightmares', 'nightmare'],
  anxiety: ['anxious', 'worry', 'worried', 'worrying', 'panic'],
  depression: ['depressed', 'depressive', 'mood', 'anhedonia'],
  trauma: ['traumatic', 'ptsd', 'abuse', 'abused', 'assault'],
  anger: ['angry', 'irritable', 'irritability', 'rage'],
  avoid: ['avoids', 'avoidance', 'avoiding', 'avoided', 'withdrawn', 'withdraws', 'isolating', 'isolation'],
  shame: ['ashamed', 'embarrassed', 'embarrassment', 'guilt', 'guilty'],
  suicide: ['suicidal', 'ideation', 'si'],
  medication: ['medications', 'med', 'meds', 'dose', 'prescribed', 'prescription'],
  work: ['job', 'employment', 'workplace', 'career'],
  goal: ['goals', 'objective', 'objectives', 'progress'],
  pattern: ['patterns', 'theme', 'themes', 'recurring', 'repeated'],
};

const CANONICAL = new Map<string, string>();
for (const [canon, alts] of Object.entries(SYNONYMS)) {
  CANONICAL.set(canon, canon);
  for (const alt of alts) CANONICAL.set(alt, canon);
}

/**
 * Very light suffix stripping. Behaviourally identical to the original
 * `/(?:ing|ed|es|s)$/` replace — the longest matching suffix is considered, and
 * if stripping it would leave a stem shorter than 4 characters the token is
 * left alone rather than falling through to a shorter suffix. Written with
 * `endsWith` instead of a regex-with-callback because stemming runs on every
 * token of every document on every query and was the dominant retrieval cost.
 * Exported so the equivalence can be fuzz-tested against the original regex.
 */
export function stripSuffix(token: string): string {
  const len = token.length;
  if (token.endsWith('ing')) return len >= 7 ? token.slice(0, len - 3) : token;
  if (token.endsWith('ed') || token.endsWith('es')) return len >= 6 ? token.slice(0, len - 2) : token;
  if (token.endsWith('s')) return len >= 5 ? token.slice(0, len - 1) : token;
  return token;
}

function stem(token: string): string {
  return CANONICAL.get(token) ?? stripSuffix(token);
}

const TOKEN_SPLIT = /[^a-z0-9']+/;

export function tokenize(text: string): string[] {
  const out: string[] = [];
  // Single pass: split once, then filter/stem inline. The previous
  // filter().map().filter() chain allocated three intermediate arrays per
  // document, which is measurable when every query re-tokenizes the corpus.
  for (const raw of text.toLowerCase().split(TOKEN_SPLIT)) {
    if (raw.length < 2 || STOPWORDS.has(raw)) continue;
    const token = stem(raw);
    if (token) out.push(token);
  }
  return out;
}

/**
 * Term frequencies for one document. Built in the same pass as tokenization so
 * scoring never walks a document's tokens more than once.
 */
export interface DocTerms {
  counts: Map<string, number>;
  length: number;
}

export function countTerms(text: string): DocTerms {
  const counts = new Map<string, number>();
  let length = 0;
  for (const raw of text.toLowerCase().split(TOKEN_SPLIT)) {
    if (raw.length < 2 || STOPWORDS.has(raw)) continue;
    const token = stem(raw);
    if (!token) continue;
    counts.set(token, (counts.get(token) ?? 0) + 1);
    length++;
  }
  return { counts, length };
}

export interface ScoredDoc<T> {
  doc: T;
  score: number;
  matchedTerms: string[];
}

/**
 * Scores docs against the query. k1/b fixed (1.4 / 0.6). Returns only docs
 * with at least one matching term, sorted descending.
 */
export function rankByLexicalRelevance<T>(
  query: string,
  docs: T[],
  textOf: (doc: T) => string,
): Array<ScoredDoc<T>> {
  const queryTerms = [...new Set(tokenize(query))];
  if (queryTerms.length === 0) return [];

  // Term counts are built once per document. Document frequency is then a Map
  // lookup per (term, document) instead of a linear scan of that document's
  // token array — the scoring pass never re-walks a document's tokens.
  const terms = docs.map((doc) => countTerms(textOf(doc)));
  const n = docs.length || 1;
  let totalLen = 0;
  for (const t of terms) totalLen += t.length;
  const avgLen = totalLen / n || 1;

  const docFreq = new Map<string, number>();
  for (const term of queryTerms) {
    let df = 0;
    for (const t of terms) if (t.counts.has(term)) df++;
    docFreq.set(term, df);
  }

  const k1 = 1.4;
  const b = 0.6;
  const results: Array<ScoredDoc<T>> = [];
  for (let i = 0; i < docs.length; i++) {
    const { counts, length } = terms[i];
    if (length === 0) continue;
    let score = 0;
    const matched: string[] = [];
    for (const term of queryTerms) {
      const tf = counts.get(term) ?? 0;
      if (tf === 0) continue;
      matched.push(term);
      const df = docFreq.get(term) ?? 0;
      const idf = Math.log(1 + (n - df + 0.5) / (df + 0.5));
      score += idf * ((tf * (k1 + 1)) / (tf + k1 * (1 - b + b * (length / avgLen))));
    }
    if (matched.length > 0) results.push({ doc: docs[i], score, matchedTerms: matched });
  }
  return results.sort((a, b2) => b2.score - a.score);
}
