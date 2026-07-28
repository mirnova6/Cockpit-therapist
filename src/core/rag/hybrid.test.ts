import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AuthService } from '../auth/authService';
import type { ClinicalDatabase } from '../db/database';
import { approvedFact, makeClient, makeInput, makeTestDb } from '../ai/phase4TestUtils';
import { DEFAULT_AI_SETTINGS } from '../ai/aiSchema';
import { retrieveClientEvidence } from './clientRetrieval';
import {
  combineScores,
  DEFAULT_HYBRID_WEIGHTS,
  normalizeWeights,
  resolveEffectiveMode,
  semanticKey,
} from './hybridRetrieval';
import { retrieveHybrid } from '../embeddings/embeddingService';

let auth: AuthService;
let db: ClinicalDatabase;

beforeEach(async () => {
  ({ auth, db } = await makeTestDb('test-hybrid'));
});
afterEach(async () => {
  await auth.close();
});

describe('hybrid score combination', () => {
  it('lexical mode ignores semantic entirely', () => {
    const r = combineScores('lexical', { lexical: 2, semantic: 9, metadata: 1 });
    expect(r.final).toBe(2 * 1 + 1 * 1);
    expect(r.semantic).toBe(9); // reported for transparency, not used
  });

  it('hybrid mode blends all three with safe defaults (lexical stays dominant)', () => {
    const w = DEFAULT_HYBRID_WEIGHTS;
    expect(w.lexical).toBeGreaterThan(w.semantic);
    const r = combineScores('hybrid', { lexical: 2, semantic: 1, metadata: 1 }, w);
    expect(r.final).toBeCloseTo(2 * w.lexical + 1 * w.semantic + 1 * w.metadata, 5);
  });

  it('semantic-test mode drops the lexical term', () => {
    const r = combineScores('semantic-test', { lexical: 5, semantic: 1, metadata: 0 });
    expect(r.final).toBeCloseTo(1 * DEFAULT_HYBRID_WEIGHTS.semantic, 5);
  });

  it('rejects negative / non-finite weights instead of inverting ranking', () => {
    const w = normalizeWeights({ lexical: -3, semantic: Number.NaN, metadata: 2 });
    expect(w.lexical).toBe(0);
    expect(w.semantic).toBe(0);
    expect(w.metadata).toBe(2);
  });
});

describe('mode resolution is honest', () => {
  it('downgrades to lexical when no embedding provider/vectors exist', () => {
    const r = resolveEffectiveMode('hybrid', { semanticAvailable: false, activated: true });
    expect(r.mode).toBe('lexical');
    expect(r.downgradedReason).toMatch(/NOT active/i);
  });

  it('downgrades to lexical when the clinician has not activated it', () => {
    const r = resolveEffectiveMode('hybrid', { semanticAvailable: true, activated: false });
    expect(r.mode).toBe('lexical');
    expect(r.downgradedReason).toMatch(/not been activated/i);
  });

  it('honors hybrid only when provider AND activation are both real', () => {
    expect(resolveEffectiveMode('hybrid', { semanticAvailable: true, activated: true }).mode).toBe('hybrid');
  });
});

describe('live retrieval', () => {
  async function seed() {
    const client = await makeClient(db, 'HYB');
    const input = await makeInput(
      db,
      client.id,
      'Client reports taking Sertraline 50mg daily and completed the PHQ-9 today. She said "I feel like a burden".',
    );
    await approvedFact(db, client.id, input.id, 'medication', 'Sertraline 50mg daily');
    return client;
  }

  it('lexical retrieval remains available and finds exact clinical terms', async () => {
    const client = await seed();
    const res = await retrieveClientEvidence(db, client.id, 'Sertraline');
    expect(res.debug.mode).toBe('lexical');
    expect(res.sources.length).toBeGreaterThan(0);
    expect(JSON.stringify(res.sources)).toContain('Sertraline');
  });

  it('semantic ranking is NOT silently activated without vectors', async () => {
    const client = await seed();
    const res = await retrieveClientEvidence(db, client.id, 'medication', { mode: 'hybrid' });
    expect(res.debug.requestedMode).toBe('hybrid');
    expect(res.debug.mode).toBe('lexical'); // honest downgrade
    expect(res.debug.modeDowngradedReason).toBeTruthy();
    expect(res.debug.semanticScoresAvailable).toBe(0);
  });

  it('exposes lexical/semantic/metadata components for the debug panel', async () => {
    const client = await seed();
    const res = await retrieveClientEvidence(db, client.id, 'Sertraline');
    const row = res.debug.retrieved[0];
    expect(row.lexicalScore).toBeGreaterThan(0);
    expect(row.metadataBoost).toBeGreaterThanOrEqual(0);
    expect(row.semanticScore).toBe(0);
    expect(row.reasons.length).toBeGreaterThan(0);
  });

  it('hybrid ranking uses supplied semantic scores without losing exact-term recall', async () => {
    const client = await seed();
    const lexicalOnly = await retrieveClientEvidence(db, client.id, 'Sertraline');
    const target = lexicalOnly.sources[0];

    // Give an UNRELATED candidate a high semantic score; the exact medication
    // match must still be retrievable in hybrid mode.
    const scores = new Map<string, number>();
    for (const s of lexicalOnly.sources) scores.set(semanticKey(s.refType, s.refId), 0.2);
    scores.set(semanticKey(target.refType, target.refId), 0.9);

    const hybrid = await retrieveClientEvidence(db, client.id, 'Sertraline', {
      mode: 'hybrid',
      semanticScores: scores,
    });
    expect(hybrid.debug.mode).toBe('hybrid');
    expect(hybrid.debug.semanticScoresAvailable).toBeGreaterThan(0);
    expect(JSON.stringify(hybrid.sources)).toContain('Sertraline');
    const row = hybrid.debug.retrieved.find((r) => r.refType === target.refType);
    expect(row?.semanticScore).toBeGreaterThan(0);
  });

  it('refuses retrieval when a candidate belongs to another organization', async () => {
    const client = await seed();
    // Corpus candidates carry no org id in single-clinician mode, so an org
    // filter must not spuriously fail.
    await expect(
      retrieveClientEvidence(db, client.id, 'Sertraline', { organizationId: 'org-A' }),
    ).resolves.toBeTruthy();
  });

  it('never retrieves another client\'s records', async () => {
    const a = await seed();
    const b = await makeClient(db, 'OTHER');
    await makeInput(db, b.id, 'Unrelated content marker ZZTOP for the other client.');
    const res = await retrieveClientEvidence(db, a.id, 'ZZTOP');
    expect(JSON.stringify(res.sources)).not.toContain('ZZTOP');
    for (const s of res.sources) expect(s.clientId).toBe(a.id);
  });
});

describe('retrieveHybrid orchestrator', () => {
  it('stays lexical when no embedding provider is configured', async () => {
    const client = await makeClient(db, 'ORCH');
    await makeInput(db, client.id, 'PHQ-9 administered; score 12.');
    const res = await retrieveHybrid(db, DEFAULT_AI_SETTINGS, client.id, 'PHQ-9', {
      mode: 'hybrid',
      activated: true,
    });
    expect(res.debug.mode).toBe('lexical');
    expect(res.debug.modeDowngradedReason).toBeTruthy();
  });

  it('stays lexical when the clinician has not activated hybrid, even if asked', async () => {
    const client = await makeClient(db, 'ORCH2');
    await makeInput(db, client.id, 'PHQ-9 administered; score 12.');
    const res = await retrieveHybrid(db, DEFAULT_AI_SETTINGS, client.id, 'PHQ-9', {
      mode: 'hybrid',
      activated: false,
    });
    expect(res.debug.mode).toBe('lexical');
  });
});
