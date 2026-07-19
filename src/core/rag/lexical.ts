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

function stem(token: string): string {
  const canon = CANONICAL.get(token);
  if (canon) return canon;
  // very light suffix stripping
  return token.replace(/(?:ing|ed|es|s)$/, (m) => (token.length - m.length >= 4 ? '' : m));
}

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9']+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t))
    .map(stem)
    .filter(Boolean);
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
  const tokenized = docs.map((doc) => tokenize(textOf(doc)));
  const n = docs.length || 1;
  const avgLen = tokenized.reduce((sum, t) => sum + t.length, 0) / n || 1;

  const docFreq = new Map<string, number>();
  for (const term of queryTerms) {
    let df = 0;
    for (const tokens of tokenized) if (tokens.includes(term)) df++;
    docFreq.set(term, df);
  }

  const k1 = 1.4;
  const b = 0.6;
  const results: Array<ScoredDoc<T>> = [];
  for (let i = 0; i < docs.length; i++) {
    const tokens = tokenized[i];
    if (tokens.length === 0) continue;
    const counts = new Map<string, number>();
    for (const token of tokens) counts.set(token, (counts.get(token) ?? 0) + 1);
    let score = 0;
    const matched: string[] = [];
    for (const term of queryTerms) {
      const tf = counts.get(term) ?? 0;
      if (tf === 0) continue;
      matched.push(term);
      const df = docFreq.get(term) ?? 0;
      const idf = Math.log(1 + (n - df + 0.5) / (df + 0.5));
      score += idf * ((tf * (k1 + 1)) / (tf + k1 * (1 - b + b * (tokens.length / avgLen))));
    }
    if (matched.length > 0) results.push({ doc: docs[i], score, matchedTerms: matched });
  }
  return results.sort((a, b2) => b2.score - a.score);
}
