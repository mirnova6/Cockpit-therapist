/**
 * Phase 9 OCR seam (§7).
 *
 * OCR is OPTIONAL, LOCAL-ONLY, and DISABLED BY DEFAULT. No OCR engine is
 * bundled in this build, so the default provider honestly reports that OCR is
 * unavailable rather than pretending to read an image. A local engine (e.g. a
 * WASM Tesseract build shipped with the native app) implements `OcrProvider`;
 * nothing else in the pipeline changes.
 *
 * HARD RULES encoded here:
 *  - Images/PDFs are never sent to an external OCR service. An online provider
 *    would require a future approved provider entry AND an explicit outbound
 *    preview — the interface deliberately has no network default.
 *  - OCR output NEVER becomes an approved clinical fact. It returns as
 *    `method: 'ocr'` text that must pass through the same clinician extraction
 *    and review pipeline as any other document text.
 *  - Low-confidence regions are marked so the clinician can compare against the
 *    original, which remains stored and viewable.
 */
import type { ExtractedBlock, ExtractionResult } from './documentExtraction';

export interface OcrRegion {
  text: string;
  /** 0–1. Values below `lowConfidenceThreshold` are surfaced for review. */
  confidence: number;
  page?: number;
}

export interface OcrOutcome {
  regions: OcrRegion[];
  pageCount?: number;
  engine: string;
}

export interface OcrProvider {
  id: string;
  label: string;
  /** True only when a real local engine is present. */
  isAvailable(): Promise<boolean>;
  /** Local-only recognition. Implementations must not perform network calls. */
  recognize(bytes: Uint8Array, fileName: string): Promise<OcrOutcome>;
}

export class OcrUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OcrUnavailableError';
  }
}

/** Default provider: no engine bundled — says so instead of faking output. */
export const nullOcrProvider: OcrProvider = {
  id: 'none',
  label: 'No OCR engine installed',
  isAvailable: async () => false,
  recognize: async () => {
    throw new OcrUnavailableError(
      'No local OCR engine is installed in this build. Paste the text manually, or install a local OCR engine in the native app.',
    );
  },
};

export interface OcrSettings {
  /** OCR stays off unless the clinician explicitly enables it. */
  enabled: boolean;
  /** Regions at or below this confidence are flagged for careful review. */
  lowConfidenceThreshold: number;
}

export const DEFAULT_OCR_SETTINGS: OcrSettings = { enabled: false, lowConfidenceThreshold: 0.8 };

export const OCR_LIMITATIONS = [
  'OCR reads pixels, not meaning — misread characters, numbers and medication doses are common.',
  'Handwriting, low-resolution scans, skew, stamps and tables are frequently wrong.',
  'Every OCR result must be compared against the original document before use.',
  'OCR text is never saved as an approved clinical fact; it enters the normal review pipeline.',
];

export interface OcrExtractionResult extends ExtractionResult {
  /** Regions the engine was unsure about — shown highlighted for review. */
  lowConfidenceRegions: OcrRegion[];
  ocrEngine: string;
}

/**
 * Run OCR through the pipeline. Refuses when disabled or when no engine is
 * genuinely available — it never returns fabricated text.
 */
export async function runOcr(
  provider: OcrProvider,
  settings: OcrSettings,
  bytes: Uint8Array,
  fileName: string,
): Promise<OcrExtractionResult> {
  if (!settings.enabled) {
    throw new OcrUnavailableError('OCR is disabled. Enable it explicitly in settings to use it (local processing only).');
  }
  if (!(await provider.isAvailable())) {
    throw new OcrUnavailableError(
      `${provider.label}: OCR is not available on this device. Paste the text manually instead.`,
    );
  }
  const outcome = await provider.recognize(bytes, fileName);
  const blocks: ExtractedBlock[] = outcome.regions
    .map((r, i) => ({ text: r.text.trim(), page: r.page, paragraph: i + 1 }))
    .filter((b) => b.text.length > 0);
  const lowConfidenceRegions = outcome.regions.filter((r) => r.confidence <= settings.lowConfidenceThreshold);

  const notes = [...OCR_LIMITATIONS];
  if (lowConfidenceRegions.length > 0) {
    notes.unshift(`${lowConfidenceRegions.length} low-confidence region(s) are marked for review.`);
  }

  return {
    method: blocks.length > 0 ? 'ocr' : 'failed',
    format: 'image',
    fileName,
    blocks,
    text: blocks.map((b) => b.text).join('\n\n'),
    pageCount: outcome.pageCount,
    notes: blocks.length > 0 ? notes : ['OCR produced no readable text.', ...OCR_LIMITATIONS],
    needsOcr: false,
    lowConfidenceRegions,
    ocrEngine: outcome.engine,
  };
}
