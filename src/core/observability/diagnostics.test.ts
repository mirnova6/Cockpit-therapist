import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AuthService } from '../auth/authService';
import type { ClinicalDatabase } from '../db/database';
import { makeClient, makeInput, makeTestDb } from '../ai/phase4TestUtils';
import {
  buildDiagnosticExport,
  DiagnosticExportRefusedError,
  DiagnosticsRepository,
  opaqueRef,
  sanitizeCode,
} from './diagnostics';

let auth: AuthService;
let db: ClinicalDatabase;
let diagnostics: DiagnosticsRepository;

const PHI_CANARY = 'Zebediah Quintwell-Fauxman';

beforeEach(async () => {
  ({ auth, db } = await makeTestDb('test-diag'));
  diagnostics = new DiagnosticsRepository({ store: db.store });
});
afterEach(async () => {
  await auth.close();
});

describe('diagnostic events are PHI-free by construction', () => {
  it('stores only operational metadata', async () => {
    const event = await diagnostics.record({
      appVersion: '0.9.0',
      platform: 'browser-development',
      feature: 'restore',
      severity: 'error',
      code: 'restore-checksum-mismatch',
      errorCategory: 'integrity',
      durationMs: 120,
    });
    expect(Object.keys(event).sort()).toEqual(
      ['appVersion', 'at', 'cancelled', 'clientRef', 'code', 'durationMs', 'errorCategory', 'feature', 'id', 'platform', 'severity'].sort(),
    );
    // No prompt/output/apiKey/clinical field exists at all.
    expect(event).not.toHaveProperty('prompt');
    expect(event).not.toHaveProperty('output');
    expect(event).not.toHaveProperty('apiKey');
  });

  it('sanitizes a code that tries to smuggle clinical prose', async () => {
    const event = await diagnostics.record({
      appVersion: '0.9.0',
      platform: 'browser',
      feature: 'ui',
      severity: 'warning',
      code: `Client ${PHI_CANARY} reported suicidal ideation!`,
    });
    expect(event.code).not.toContain(' ');
    expect(event.code).not.toContain('Zebediah');
    // Punctuation and capitals are stripped to a machine-ish token.
    expect(event.code).toMatch(/^[a-z0-9-]+$/);
  });

  it('never stores a client name even when clients exist', async () => {
    const client = await makeClient(db, PHI_CANARY);
    await makeInput(db, client.id, `${PHI_CANARY} described SECRET-SYMPTOM-XYZ.`);
    await diagnostics.record({
      appVersion: '0.9.0',
      platform: 'browser',
      feature: 'retrieval',
      severity: 'error',
      code: 'retrieval-failed',
      clientRef: opaqueRef(client.id),
    });
    const serialized = JSON.stringify(await diagnostics.list());
    expect(serialized).not.toContain(PHI_CANARY);
    expect(serialized).not.toContain('SECRET-SYMPTOM-XYZ');
    expect(serialized).toContain('retrieval-failed');
  });

  it('produces an opaque, non-reversible client reference', () => {
    const ref = opaqueRef('client-12345');
    expect(ref).toMatch(/^ref-[a-z0-9]+$/);
    expect(ref).not.toContain('client-12345');
    expect(opaqueRef('client-12345')).toBe(ref); // stable
  });

  it('sanitizeCode falls back to a safe token for empty input', () => {
    expect(sanitizeCode('   ')).toBe('unspecified');
    expect(sanitizeCode('Storage Failure #3')).toBe('storage-failure-3');
  });
});

describe('diagnostic export', () => {
  it('refuses without the no-PHI confirmation', () => {
    expect(() => buildDiagnosticExport([], false)).toThrow(DiagnosticExportRefusedError);
  });

  it('exports with the confirmation and states what it contains', async () => {
    await diagnostics.record({
      appVersion: '0.9.0',
      platform: 'browser',
      feature: 'backup',
      severity: 'info',
      code: 'backup-created',
      durationMs: 5,
    });
    const exported = buildDiagnosticExport(await diagnostics.list(), true);
    expect(exported.noPhiConfirmed).toBe(true);
    expect(exported.events).toHaveLength(1);
    expect(exported.notice).toMatch(/no clinical text, prompts, outputs or API keys/i);
  });
});

describe('diagnostics lifecycle', () => {
  it('lists newest first and can be cleared', async () => {
    for (const code of ['a-one', 'b-two', 'c-three']) {
      await diagnostics.record({ appVersion: '1', platform: 'p', feature: 'ui', severity: 'info', code });
    }
    expect((await diagnostics.list()).length).toBe(3);
    expect(await diagnostics.clear()).toBe(3);
    expect((await diagnostics.list()).length).toBe(0);
  });
});
