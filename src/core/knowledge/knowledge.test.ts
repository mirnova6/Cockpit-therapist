import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AuthService } from '../auth/authService';
import type { ClinicalDatabase } from '../db/database';
import { makeTestDb } from '../ai/phase4TestUtils';
import { retrieveKnowledge, passageSupportsClaim } from './knowledgeRetrieval';
import { chunkKnowledgeText } from './knowledgeSchema';

let auth: AuthService;
let db: ClinicalDatabase;

beforeEach(async () => {
  ({ auth, db } = await makeTestDb('test-knowledge'));
});

afterEach(async () => {
  await auth.close();
});

const MI_TEXT = `Overview:
Motivational interviewing is a collaborative conversation style for strengthening a person's own motivation and commitment to change. Working with ambivalence is central: the clinician evokes the client's own arguments for change rather than supplying them.

[page 12]
Developing discrepancy:
Discrepancy between present behavior and broader goals or values can motivate change when the client, not the clinician, voices it. Rolling with resistance avoids argumentation.`;

async function addSource(overrides: object = {}, text = MI_TEXT) {
  return db.knowledge.createSource(
    {
      title: 'Motivational Interviewing: Helping People Change',
      author: 'Miller & Rollnick',
      publicationYear: '2013',
      editionOrVersion: '3rd ed.',
      topic: 'motivational interviewing',
      therapyModel: 'MI',
      sourceType: 'treatment-manual',
      citationDetails: 'Miller, W. R., & Rollnick, S. (2013). Motivational Interviewing (3rd ed.). Guilford.',
      allowedUses: [],
      excludedUses: [],
      ...overrides,
    },
    text,
    'Dr. Kim',
  );
}

describe('chunking', () => {
  it('detects headings and page markers and keeps them on chunks', () => {
    const { chunks } = chunkKnowledgeText(MI_TEXT);
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    expect(chunks[0].section).toBe('Overview');
    const paged = chunks.find((c) => c.page === '12');
    expect(paged).toBeDefined();
    expect(paged!.section).toBe('Developing discrepancy');
    expect(paged!.text).toContain('Rolling with resistance');
  });
});

describe('approval workflow and retrieval eligibility', () => {
  it('new sources are pending and NOT retrievable until clinician-approved', async () => {
    const source = await addSource();
    expect(source.status).toBe('pending-review');
    expect(source.chunkCount).toBeGreaterThan(0);
    let passages = await retrieveKnowledge(db.knowledge, 'intervention-recommendations', 'motivational interviewing ambivalence');
    expect(passages).toHaveLength(0);

    await db.knowledge.setStatus(source.id, 'approved', 'Dr. Kim');
    passages = await retrieveKnowledge(db.knowledge, 'intervention-recommendations', 'motivational interviewing ambivalence');
    expect(passages.length).toBeGreaterThan(0);
  });

  it('rejected, outdated, superseded, archived, and past-due sources are never retrieved', async () => {
    for (const status of ['rejected', 'outdated', 'superseded', 'archived'] as const) {
      const source = await addSource({ title: `Manual (${status})` });
      await db.knowledge.setStatus(source.id, 'approved', 'Dr. Kim');
      await db.knowledge.setStatus(source.id, status, 'Dr. Kim');
    }
    const pastDue = await addSource({ title: 'Manual (past due)', reviewDueDate: '2020-01-01' });
    await db.knowledge.setStatus(pastDue.id, 'approved', 'Dr. Kim');

    const passages = await retrieveKnowledge(db.knowledge, 'intervention-recommendations', 'motivational interviewing ambivalence');
    expect(passages).toHaveLength(0);
  });

  it('excluded uses are enforced per purpose', async () => {
    const source = await addSource({
      title: 'MI for interventions only',
      allowedUses: ['intervention-recommendations'],
      excludedUses: ['assistant-answers'],
    });
    await db.knowledge.setStatus(source.id, 'approved', 'Dr. Kim');
    const forInterventions = await retrieveKnowledge(db.knowledge, 'intervention-recommendations', 'ambivalence discrepancy');
    expect(forInterventions.length).toBeGreaterThan(0);
    const forAssistant = await retrieveKnowledge(db.knowledge, 'assistant-answers', 'ambivalence discrepancy');
    expect(forAssistant).toHaveLength(0);
  });

  it('retrieved passages preserve source identity, citation, section/page, and status', async () => {
    const source = await addSource();
    await db.knowledge.setStatus(source.id, 'approved', 'Dr. Kim');
    const passages = await retrieveKnowledge(db.knowledge, 'case-formulation', 'discrepancy values change');
    const paged = passages.find((p) => p.page === '12');
    expect(paged).toBeDefined();
    expect(paged!.sourceId).toBe(source.id);
    expect(paged!.title).toContain('Motivational Interviewing');
    expect(paged!.citation).toContain('Miller');
    expect(paged!.editionOrVersion).toBe('3rd ed.');
    expect(paged!.status).toBe('approved');
    expect(paged!.section).toBe('Developing discrepancy');
  });

  it('proprietary frameworks are unavailable unless the clinician supplied and approved material', async () => {
    // Nothing about NCI / Behavior Operations exists unless added here.
    const passages = await retrieveKnowledge(
      db.knowledge,
      'intervention-recommendations',
      'NCI Behavior Operations Manual noncompliance intervention',
    );
    expect(passages).toHaveLength(0);
  });
});

describe('citation guard', () => {
  it('rejects citations whose passage does not support the claim', () => {
    const passage = 'Motivational interviewing evokes the client\'s own arguments for change and works with ambivalence.';
    expect(passageSupportsClaim(passage, 'Use motivational interviewing to explore ambivalence about change')).toBe(true);
    expect(passageSupportsClaim(passage, 'EMDR bilateral stimulation protocol reduces nightmares')).toBe(false);
  });
});
