/**
 * Phase 9 performance-optimization tests.
 *
 * These are correctness tests for the two optimizations, not benchmarks. A
 * faster path that returns different results is a bug, so each optimization is
 * pinned on behaviour first and on work-avoided second. Work avoided is
 * measured by counting real AES-GCM calls, not by timing, so the assertions do
 * not flake on a loaded machine.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthService } from '../auth/authService';
import { countTerms, rankByLexicalRelevance, stripSuffix, tokenize } from '../rag/lexical';

let counter = 0;
const services: AuthService[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  while (services.length) await services.pop()?.close();
});

async function workspace(name: string) {
  const auth = new AuthService({ dbName: `${name}-${Date.now()}-${counter++}`, iterations: 1000 });
  services.push(auth);
  const db = await auth.setup({ name: 'Dr. Perf', passphrase: 'perf-passphrase-value' }); // secret-scan-allow: fixture value, not a real secret
  return { auth, db };
}

async function seedClient(db: Awaited<ReturnType<typeof workspace>>['db'], label: string, inputs: number) {
  const client = await db.createClient(
    {
      displayName: `[FICTIONAL] ${label}`,
      contactEnabled: false,
      levelOfCare: 'outpatient',
      status: 'active',
      diagnoses: [],
      medications: [],
      risk: { level: 'low' },
    },
    'Dr. Perf',
  );
  for (let i = 0; i < inputs; i++) {
    await db.createInput(
      {
        clientId: client.id,
        inputType: 'session-transcript',
        dateOfInformation: '2026-06-01',
        rawText: `FICTIONAL note ${i} about mood, sleep and coping.`,
        authorSource: 'Dr. Perf',
        reportedBy: 'therapist-entered',
        containsRisk: false,
        allowAiAnalysis: true,
        localOnly: false,
      },
      [],
      'Dr. Perf',
    );
  }
  return client;
}

/** Counts real AES-GCM decrypt operations performed inside `fn`. */
async function countDecrypts(fn: () => Promise<unknown>): Promise<number> {
  const original = crypto.subtle.decrypt.bind(crypto.subtle);
  let calls = 0;
  const spy = vi.spyOn(crypto.subtle, 'decrypt').mockImplementation((...args: Parameters<typeof original>) => {
    calls++;
    return original(...args);
  });
  try {
    await fn();
  } finally {
    spy.mockRestore();
  }
  return calls;
}

describe('session plaintext cache: results are identical to always decrypting', () => {
  it('returns the same data on a warm read as on a cold read', async () => {
    const { db } = await workspace('perf-same');
    const client = await seedClient(db, 'Same', 4);

    db.store.clearCache();
    const cold = await db.listInputsForClient(client.id);
    const warm = await db.listInputsForClient(client.id);
    expect(warm).toEqual(cold);
    expect(warm.map((i) => i.rawText)).toEqual(cold.map((i) => i.rawText));
  });

  it('hands every caller an independent object, so mutation cannot corrupt the cache', async () => {
    const { db } = await workspace('perf-alias');
    const client = await seedClient(db, 'Alias', 2);

    const first = await db.listInputsForClient(client.id);
    first[0].rawText = 'MUTATED IN CALLER';
    const second = await db.listInputsForClient(client.id);

    expect(second[0]).not.toBe(first[0]);
    expect(second[0].rawText).not.toBe('MUTATED IN CALLER');
    expect(second[0].rawText).toContain('FICTIONAL note');
  });

  it('reflects a write immediately', async () => {
    const { db } = await workspace('perf-write');
    const client = await seedClient(db, 'Write', 1);
    const [input] = await db.listInputsForClient(client.id);

    await db.updateInput(input.id, { rawText: 'FICTIONAL revised text.' }, 'Dr. Perf', 'perf test edit');
    const after = await db.listInputsForClient(client.id);
    expect(after[0].rawText).toBe('FICTIONAL revised text.');
  });

  it('reflects a delete immediately', async () => {
    const { db } = await workspace('perf-delete');
    const client = await seedClient(db, 'Delete', 2);
    const before = await db.listInputsForClient(client.id);
    expect(before).toHaveLength(2);

    await db.store.remove('inputs', before[0].id);
    const after = await db.listInputsForClient(client.id);
    expect(after).toHaveLength(1);
    expect(after[0].id).toBe(before[1].id);
  });

  it('detects a record rewritten by another session (e.g. a second tab) via the IV', async () => {
    const dbName = `perf-foreign-${Date.now()}-${counter++}`;
    const authA = new AuthService({ dbName, iterations: 1000 });
    services.push(authA);
    const dbA = await authA.setup({ name: 'Dr. Perf', passphrase: 'perf-passphrase-value' }); // secret-scan-allow: fixture value, not a real secret
    const client = await seedClient(dbA, 'Foreign', 1);
    const [input] = await dbA.listInputsForClient(client.id);
    await dbA.listInputsForClient(client.id); // warm session A's cache

    // A second session over the same workspace writes the record. Session A's
    // cache knows nothing about that write — only the changed IV reveals it.
    const authB = new AuthService({ dbName, iterations: 1000 });
    services.push(authB);
    const dbB = await authB.unlockWithPassphrase('perf-passphrase-value'); // secret-scan-allow: fixture value, not a real secret
    await dbB.updateInput(input.id, { rawText: 'FICTIONAL written by another tab.' }, 'Dr. Perf', 'second session edit');

    const after = await dbA.listInputsForClient(client.id);
    expect(after[0].rawText).toBe('FICTIONAL written by another tab.');
  });

  it('never returns another client’s records', async () => {
    const { db } = await workspace('perf-isolation');
    const a = await seedClient(db, 'Alpha', 3);
    const b = await seedClient(db, 'Beta', 3);

    for (let round = 0; round < 3; round++) {
      const forA = await db.listInputsForClient(a.id);
      const forB = await db.listInputsForClient(b.id);
      expect(forA.every((i) => i.clientId === a.id)).toBe(true);
      expect(forB.every((i) => i.clientId === b.id)).toBe(true);
      expect(forA.map((i) => i.id).some((id) => forB.map((x) => x.id).includes(id))).toBe(false);
    }
  });
});

describe('session plaintext cache: work actually avoided', () => {
  it('skips AES-GCM on a warm read and repeats it after invalidation', async () => {
    const { db } = await workspace('perf-work');
    const client = await seedClient(db, 'Work', 12);

    db.store.clearCache();
    const cold = await countDecrypts(() => db.listInputsForClient(client.id));
    const warm = await countDecrypts(() => db.listInputsForClient(client.id));
    expect(cold).toBeGreaterThanOrEqual(12);
    expect(warm).toBe(0);

    db.store.clearCache();
    const afterClear = await countDecrypts(() => db.listInputsForClient(client.id));
    expect(afterClear).toBe(cold);
  });

  it('re-decrypts only the record that changed', async () => {
    const { db } = await workspace('perf-partial');
    const client = await seedClient(db, 'Partial', 10);
    const inputs = await db.listInputsForClient(client.id);

    await db.updateInput(inputs[0].id, { rawText: 'FICTIONAL edited.' }, 'Dr. Perf', 'perf test edit');
    const decrypts = await countDecrypts(() => db.listInputsForClient(client.id));
    expect(decrypts).toBe(1);
  });
});

describe('session plaintext cache: lifetime is the unlocked session', () => {
  it('is empty before any read and populated after', async () => {
    const { db } = await workspace('perf-stats');
    expect(db.store.cacheStats().entries).toBeGreaterThanOrEqual(0);
    db.store.clearCache();
    expect(db.store.cacheStats()).toMatchObject({ entries: 0, chars: 0 });

    const client = await seedClient(db, 'Stats', 3);
    await db.listInputsForClient(client.id);
    expect(db.store.cacheStats().entries).toBeGreaterThan(0);
    expect(db.store.cacheStats().chars).toBeGreaterThan(0);
  });

  it('locking clears the cached plaintext', async () => {
    const { auth, db } = await workspace('perf-lock');
    const client = await seedClient(db, 'Lock', 3);
    await db.listInputsForClient(client.id);
    expect(db.store.cacheStats().entries).toBeGreaterThan(0);

    await auth.lock();
    expect(db.store.cacheStats()).toMatchObject({ entries: 0, chars: 0 });
    expect(await auth.getStatus()).toBe('locked');
  });

  it('a fresh unlock starts with a cold cache', async () => {
    const { auth, db } = await workspace('perf-relock');
    const client = await seedClient(db, 'Relock', 5);
    await db.listInputsForClient(client.id);
    await auth.lock();

    const reopened = await auth.unlockWithPassphrase('perf-passphrase-value'); // secret-scan-allow: fixture value, not a real secret
    expect(reopened.store.cacheStats()).toMatchObject({ entries: 0, chars: 0 });
    const decrypts = await countDecrypts(() => reopened.listInputsForClient(client.id));
    expect(decrypts).toBeGreaterThanOrEqual(5);
  });
});

describe('lexical ranking optimization preserves behaviour', () => {
  /** The regex-based stemmer this optimization replaced. */
  function legacyStem(token: string): string {
    return token.replace(/(?:ing|ed|es|s)$/, (m) => (token.length - m.length >= 4 ? '' : m));
  }

  it('matches the previous stemmer on a large generated token set', () => {
    const alphabet = 'abcdefghijklmnopqrstuvwxyz';
    const suffixes = ['', 'ing', 'ed', 'es', 's', 'ings', 'eds', 'ess'];
    const differences: string[] = [];
    let checked = 0;
    let seed = 12345;
    const rand = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;

    for (let i = 0; i < 20000; i++) {
      let word = '';
      const len = 2 + Math.floor(rand() * 8);
      for (let j = 0; j < len; j++) word += alphabet[Math.floor(rand() * alphabet.length)];
      word += suffixes[Math.floor(rand() * suffixes.length)];
      checked++;
      // The synonym lexicon is untouched by this optimization and is applied
      // before suffix stripping; the suffix step is what was rewritten.
      const current = stripSuffix(word);
      const legacy = legacyStem(word);
      if (current !== legacy) differences.push(`${word}: legacy=${legacy} current=${current}`);
    }
    expect(checked).toBe(20000);
    expect(differences.slice(0, 10)).toEqual([]);
  });

  it('keeps the documented edge cases', () => {
    // Stripping must leave at least 4 characters, and the longest suffix wins.
    expect(tokenize('buses')).toEqual(['buses']); // 'es' would leave 3 chars
    expect(tokenize('misses')).toEqual(['miss']);
    expect(tokenize('sing')).toEqual(['sing']); // 'ing' would leave 1 char
    expect(tokenize('sleeping')).toEqual(['sleep']);
    expect(tokenize('feelings')).toEqual(['feeling']);
    expect(tokenize('cats')).toEqual(['cats']); // 's' would leave 3 chars
    expect(tokenize('avoided')).toEqual(['avoid']); // synonym group wins
  });

  it('countTerms agrees with tokenize', () => {
    const text = 'The client reported worsening sleep, nightmares and avoidance of work meetings.';
    const tokens = tokenize(text);
    const { counts, length } = countTerms(text);
    expect(length).toBe(tokens.length);
    for (const token of new Set(tokens)) {
      expect(counts.get(token)).toBe(tokens.filter((t) => t === token).length);
    }
  });

  /**
   * The pre-optimization scorer: re-tokenizes per document, computes document
   * frequency with a linear `includes` scan, and rebuilds term counts in a
   * second pass. Kept here so equivalence is asserted against the real previous
   * implementation rather than against hand-written golden numbers.
   */
  function legacyRank<T>(query: string, docs: T[], textOf: (d: T) => string) {
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
    const results: Array<{ doc: T; score: number; matchedTerms: string[] }> = [];
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

  it('produces byte-identical rankings to the pre-optimization scorer', () => {
    const docs = [
      { id: 'a', text: 'The client reported worsening sleep and nightmares after the assault.' },
      { id: 'b', text: 'Discussed work stress and time management; no mood concerns raised.' },
      { id: 'c', text: 'Sleep improved slightly; still avoiding social contact and isolating.' },
      { id: 'd', text: 'Reviewed medication dose with prescriber; no side effects reported.' },
      { id: 'e', text: '' },
    ];
    const queries = [
      'sleep avoidance trauma',
      'mood',
      'work stress medication',
      'the and of',
      '',
      'nightmares isolating prescriber',
    ];
    for (const query of queries) {
      const now = rankByLexicalRelevance(query, docs, (d) => d.text);
      const before = legacyRank(query, docs, (d) => d.text);
      expect(now.map((r) => [r.doc.id, r.score, [...r.matchedTerms].sort()])).toEqual(
        before.map((r) => [r.doc.id, r.score, [...r.matchedTerms].sort()]),
      );
    }
  });

  it('stays identical on a larger, varied corpus', () => {
    const docs = Array.from({ length: 120 }, (_, i) => ({
      id: `d${i}`,
      text:
        `FICTIONAL note ${i}: ` +
        ['mood declining', 'sleep disrupted', 'avoiding meetings', 'medication reviewed', 'work stress high'][i % 5] +
        '. ' +
        'The client discussed coping strategies. '.repeat(i % 9),
    }));
    for (const query of ['sleep', 'mood avoidance', 'medication work coping', 'stress strategies']) {
      const now = rankByLexicalRelevance(query, docs, (d) => d.text);
      const before = legacyRank(query, docs, (d) => d.text);
      expect(now.map((r) => [r.doc.id, r.score])).toEqual(before.map((r) => [r.doc.id, r.score]));
    }
  });

  it('is deterministic across repeated runs', () => {
    const docs = Array.from({ length: 50 }, (_, i) => ({
      id: `d${i}`,
      text: `FICTIONAL note ${i} on mood, sleep, avoidance and work stress. ${'filler word '.repeat(i % 7)}`,
    }));
    const once = rankByLexicalRelevance('mood sleep avoidance', docs, (d) => d.text);
    const twice = rankByLexicalRelevance('mood sleep avoidance', docs, (d) => d.text);
    expect(twice.map((r) => [r.doc.id, r.score])).toEqual(once.map((r) => [r.doc.id, r.score]));
  });
});
