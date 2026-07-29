import { describe, expect, it } from 'vitest';
import {
  DEFAULT_OCR_SETTINGS,
  nullOcrProvider,
  OcrUnavailableError,
  runOcr,
  type OcrProvider,
} from './ocr';

const bytes = new Uint8Array([1, 2, 3]);

/** A stand-in LOCAL engine used only to exercise the pipeline contract. */
const fakeLocalEngine: OcrProvider = {
  id: 'test-local',
  label: 'Test local engine',
  isAvailable: async () => true,
  recognize: async () => ({
    engine: 'test-local/1',
    pageCount: 1,
    regions: [
      { text: 'Client denied SI', confidence: 0.95, page: 1 },
      { text: 'Sertrallne 5Omg', confidence: 0.42, page: 1 }, // deliberately misread
    ],
  }),
};

describe('OCR defaults', () => {
  it('is disabled by default', () => {
    expect(DEFAULT_OCR_SETTINGS.enabled).toBe(false);
  });

  it('refuses to run while disabled', async () => {
    await expect(runOcr(fakeLocalEngine, DEFAULT_OCR_SETTINGS, bytes, 'scan.png')).rejects.toBeInstanceOf(
      OcrUnavailableError,
    );
  });

  it('reports honestly that no engine is bundled instead of faking text', async () => {
    expect(await nullOcrProvider.isAvailable()).toBe(false);
    await expect(
      runOcr(nullOcrProvider, { ...DEFAULT_OCR_SETTINGS, enabled: true }, bytes, 'scan.png'),
    ).rejects.toThrow(/not available|no local ocr engine/i);
  });
});

describe('OCR output is review-gated', () => {
  const enabled = { ...DEFAULT_OCR_SETTINGS, enabled: true };

  it('labels output as ocr, never as directly extracted or approved', async () => {
    const r = await runOcr(fakeLocalEngine, enabled, bytes, 'scan.png');
    expect(r.method).toBe('ocr');
    expect(r).not.toHaveProperty('approved');
    expect(r.notes.join(' ')).toMatch(/never saved as an approved clinical fact/i);
  });

  it('marks low-confidence regions for clinician review', async () => {
    const r = await runOcr(fakeLocalEngine, enabled, bytes, 'scan.png');
    expect(r.lowConfidenceRegions).toHaveLength(1);
    expect(r.lowConfidenceRegions[0].text).toContain('Sertrallne');
    expect(r.notes[0]).toMatch(/low-confidence region/i);
  });

  it('states OCR limitations with the result', async () => {
    const r = await runOcr(fakeLocalEngine, enabled, bytes, 'scan.png');
    expect(r.notes.join(' ')).toMatch(/compared against the original/i);
    expect(r.ocrEngine).toBe('test-local/1');
  });

  it('preserves page references when the engine supplies them', async () => {
    const r = await runOcr(fakeLocalEngine, enabled, bytes, 'scan.png');
    expect(r.blocks.every((b) => b.page === 1)).toBe(true);
    expect(r.pageCount).toBe(1);
  });

  it('reports failure rather than success when the engine returns nothing', async () => {
    const empty: OcrProvider = { ...fakeLocalEngine, recognize: async () => ({ engine: 'e', regions: [] }) };
    const r = await runOcr(empty, enabled, bytes, 'scan.png');
    expect(r.method).toBe('failed');
    expect(r.text).toBe('');
  });
});
