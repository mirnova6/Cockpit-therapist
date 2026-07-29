/**
 * Phase 9 local document text extraction.
 *
 * Runs ENTIRELY on-device with no external service and no added dependencies —
 * DOCX uses the platform ZIP/inflate primitives (DecompressionStream), PDF
 * decodes FlateDecode content streams and reads text operators.
 *
 * HONESTY RULES (§6):
 *  - The result always states HOW text was obtained: direct / ocr / manual /
 *    failed / partial. Extraction never claims success when no usable text was
 *    recovered.
 *  - Provenance (page, heading, paragraph, title, filename, method, date) is
 *    preserved so extracted text can be cited like any other evidence.
 *  - Extracted text is UNTRUSTED clinical data. It enters the normal extraction
 *    and clinician-review pipeline; it is never auto-approved, and instructions
 *    inside a document are inert (they are stored as text, never executed).
 */

export type ExtractionMethod = 'direct' | 'ocr' | 'manual' | 'failed' | 'partial';

export const EXTRACTION_METHOD_LABELS: Record<ExtractionMethod, string> = {
  direct: 'Directly extracted from the file',
  ocr: 'OCR extracted (review carefully)',
  manual: 'Manually pasted by the clinician',
  failed: 'Extraction failed — no usable text was obtained',
  partial: 'Partially extracted — some content could not be read',
};

export type DocumentFormat = 'txt' | 'md' | 'rtf' | 'docx' | 'pdf' | 'image' | 'unknown';

export interface ExtractedBlock {
  text: string;
  /** 1-based page number when the format carries pages (PDF). */
  page?: number;
  /** Nearest preceding heading, when the format carries structure (DOCX/MD). */
  heading?: string;
  /** 1-based paragraph index within the document. */
  paragraph: number;
}

export interface ExtractionResult {
  method: ExtractionMethod;
  format: DocumentFormat;
  fileName: string;
  /** Document title when the format provides one. */
  title?: string;
  blocks: ExtractedBlock[];
  /** Joined plain text, for storage and downstream extraction. */
  text: string;
  pageCount?: number;
  /** Human-readable explanation, always populated for failed/partial. */
  notes: string[];
  /** True when the file looks like a scanned/image PDF needing OCR. */
  needsOcr: boolean;
}

export function detectFormat(fileName: string, bytes?: Uint8Array): DocumentFormat {
  const ext = fileName.toLowerCase().split('.').pop() ?? '';
  if (ext === 'txt') return 'txt';
  if (ext === 'md' || ext === 'markdown') return 'md';
  if (ext === 'rtf') return 'rtf';
  if (ext === 'docx') return 'docx';
  if (ext === 'pdf') return 'pdf';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'tif', 'tiff'].includes(ext)) return 'image';
  // Fall back to magic bytes.
  if (bytes && bytes.length > 4) {
    if (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) return 'pdf'; // %PDF
    if (bytes[0] === 0x50 && bytes[1] === 0x4b) return 'docx'; // PK zip
    if (bytes[0] === 0x7b && bytes[1] === 0x5c) return 'rtf'; // {\
  }
  return 'unknown';
}

const decoder = new TextDecoder('utf-8', { fatal: false });
const latin1 = new TextDecoder('latin1');

function toBlocks(paragraphs: Array<{ text: string; heading?: string; page?: number }>): ExtractedBlock[] {
  return paragraphs
    .map((p, i) => ({ ...p, text: p.text.trim(), paragraph: i + 1 }))
    .filter((p) => p.text.length > 0);
}

function assemble(
  fileName: string,
  format: DocumentFormat,
  blocks: ExtractedBlock[],
  opts: { title?: string; pageCount?: number; notes?: string[]; needsOcr?: boolean; forceMethod?: ExtractionMethod } = {},
): ExtractionResult {
  const notes = opts.notes ?? [];
  const text = blocks.map((b) => b.text).join('\n\n');
  let method: ExtractionMethod;
  if (opts.forceMethod) method = opts.forceMethod;
  else if (blocks.length === 0 || text.trim().length === 0) method = 'failed';
  else if (notes.length > 0) method = 'partial';
  else method = 'direct';

  if (method === 'failed' && notes.length === 0) {
    notes.push('No readable text was found in this file.');
  }
  return {
    method,
    format,
    fileName,
    title: opts.title,
    blocks,
    text,
    pageCount: opts.pageCount,
    notes,
    needsOcr: opts.needsOcr ?? false,
  };
}

// --------------------------------------------------------------- plain text

function extractTxt(fileName: string, bytes: Uint8Array): ExtractionResult {
  const raw = decoder.decode(bytes);
  const paragraphs = raw.replace(/\r\n/g, '\n').split(/\n\s*\n/).map((t) => ({ text: t }));
  return assemble(fileName, 'txt', toBlocks(paragraphs));
}

function extractMarkdown(fileName: string, bytes: Uint8Array): ExtractionResult {
  const raw = decoder.decode(bytes).replace(/\r\n/g, '\n');
  const lines = raw.split('\n');
  const paragraphs: Array<{ text: string; heading?: string }> = [];
  let heading: string | undefined;
  let title: string | undefined;
  let buffer: string[] = [];
  const flush = () => {
    if (buffer.length) {
      paragraphs.push({ text: buffer.join(' ').trim(), heading });
      buffer = [];
    }
  };
  for (const line of lines) {
    const h = /^(#{1,6})\s+(.*)$/.exec(line.trim());
    if (h) {
      flush();
      heading = h[2].trim();
      if (!title && h[1].length === 1) title = heading;
      paragraphs.push({ text: heading, heading });
      continue;
    }
    if (line.trim() === '') flush();
    else buffer.push(line.trim());
  }
  flush();
  return assemble(fileName, 'md', toBlocks(paragraphs), { title });
}

// ---------------------------------------------------------------------- RTF

function extractRtf(fileName: string, bytes: Uint8Array): ExtractionResult {
  const raw = latin1.decode(bytes);
  if (!raw.startsWith('{\\rtf')) {
    return assemble(fileName, 'rtf', [], { notes: ['File does not look like RTF.'] });
  }
  // Drop binary/embedded groups we cannot render as text, then unescape.
  let s = raw.replace(/\{\\\*?\\(?:fonttbl|colortbl|stylesheet|info|pict|object)[^{}]*(\{[^{}]*\}[^{}]*)*\}/g, '');
  const paragraphs: string[] = [];
  let current = '';
  const pushPara = () => {
    if (current.trim()) paragraphs.push(current.trim());
    current = '';
  };
  const tokens = s.match(/\\[a-zA-Z]+-?\d*|\\'[0-9a-fA-F]{2}|\\.|[{}]|[^\\{}]+/g) ?? [];
  for (const tok of tokens) {
    if (tok === '{' || tok === '}') continue;
    if (tok.startsWith("\\'")) {
      current += String.fromCharCode(parseInt(tok.slice(2), 16));
      continue;
    }
    if (tok.startsWith('\\')) {
      const word = /^\\([a-zA-Z]+)/.exec(tok)?.[1];
      if (word === 'par' || word === 'pard' || word === 'line') pushPara();
      else if (word === 'tab') current += '\t';
      else if (tok === '\\\\' || tok === '\\{' || tok === '\\}') current += tok[1];
      continue;
    }
    current += tok;
  }
  pushPara();
  return assemble(fileName, 'rtf', toBlocks(paragraphs.map((t) => ({ text: t }))));
}

// --------------------------------------------------------------------- ZIP

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream('deflate-raw');
  const stream = new Blob([data as unknown as BlobPart]).stream().pipeThrough(ds);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function readU16(b: Uint8Array, o: number): number {
  return b[o] | (b[o + 1] << 8);
}
function readU32(b: Uint8Array, o: number): number {
  return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
}

/** Minimal ZIP reader: returns the decompressed bytes of one entry by name. */
async function readZipEntry(zip: Uint8Array, wanted: string): Promise<Uint8Array | undefined> {
  // Walk local file headers (PK\x03\x04). Sufficient for DOCX written by Word
  // and by every mainstream generator.
  let offset = 0;
  while (offset + 30 <= zip.length) {
    if (!(zip[offset] === 0x50 && zip[offset + 1] === 0x4b && zip[offset + 2] === 0x03 && zip[offset + 3] === 0x04)) break;
    const method = readU16(zip, offset + 8);
    let compSize = readU32(zip, offset + 18);
    let uncompSize = readU32(zip, offset + 22);
    const nameLen = readU16(zip, offset + 26);
    const extraLen = readU16(zip, offset + 28);
    const nameStart = offset + 30;
    const name = latin1.decode(zip.subarray(nameStart, nameStart + nameLen));
    const dataStart = nameStart + nameLen + extraLen;
    const flags = readU16(zip, offset + 6);
    if ((flags & 0x08) !== 0 && compSize === 0) {
      // Sizes live in a trailing data descriptor — find the next header.
      let scan = dataStart;
      while (scan + 4 <= zip.length && !(zip[scan] === 0x50 && zip[scan + 1] === 0x4b && (zip[scan + 2] === 0x03 || zip[scan + 2] === 0x01 || zip[scan + 2] === 0x07))) scan++;
      compSize = Math.max(0, scan - dataStart - 16);
      uncompSize = 0;
    }
    const data = zip.subarray(dataStart, dataStart + compSize);
    if (name === wanted) {
      if (method === 0) return data.slice();
      if (method === 8) return inflateRaw(data);
      return undefined; // unsupported compression
    }
    offset = dataStart + compSize;
    if (uncompSize === 0 && compSize === 0) offset += 16; // skip data descriptor
  }
  return undefined;
}

// -------------------------------------------------------------------- DOCX

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&amp;/g, '&');
}

async function extractDocx(fileName: string, bytes: Uint8Array): Promise<ExtractionResult> {
  let xmlBytes: Uint8Array | undefined;
  try {
    xmlBytes = await readZipEntry(bytes, 'word/document.xml');
  } catch {
    return assemble(fileName, 'docx', [], { notes: ['The DOCX archive could not be decompressed.'] });
  }
  if (!xmlBytes) {
    return assemble(fileName, 'docx', [], { notes: ['word/document.xml was not found in the DOCX archive.'] });
  }
  const xml = decoder.decode(xmlBytes);
  const paragraphs: Array<{ text: string; heading?: string }> = [];
  let heading: string | undefined;
  let title: string | undefined;

  const paraMatches = xml.match(/<w:p\b[^>]*>[\s\S]*?<\/w:p>/g) ?? [];
  for (const p of paraMatches) {
    const styleMatch = /<w:pStyle\s+w:val="([^"]+)"/.exec(p);
    const style = styleMatch?.[1] ?? '';
    const runs = [...p.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)].map((m) => decodeXmlEntities(m[1]));
    const text = runs.join('').replace(/\s+/g, ' ').trim();
    if (!text) continue;
    if (/^Heading|^Title$/i.test(style)) {
      heading = text;
      if (!title && /^Title$/i.test(style)) title = text;
      paragraphs.push({ text, heading });
    } else {
      paragraphs.push({ text, heading });
    }
  }
  if (paragraphs.length === 0) {
    return assemble(fileName, 'docx', [], {
      notes: ['No paragraph text was found — the document may contain only images or unsupported content.'],
      needsOcr: true,
    });
  }
  return assemble(fileName, 'docx', toBlocks(paragraphs), { title });
}

// --------------------------------------------------------------------- PDF

function pdfUnescape(s: string): string {
  return s
    .replace(/\\(\d{1,3})/g, (_, o) => String.fromCharCode(parseInt(o, 8)))
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t')
    .replace(/\\([()\\])/g, '$1');
}

/** Pull visible strings out of a PDF content stream's text operators. */
function textFromContentStream(content: string): string {
  const out: string[] = [];
  // ( ... ) Tj   and   [ (..) -250 (..) ] TJ
  const re = /\((?:[^()\\]|\\.)*\)/g;
  const tjBlocks = content.match(/(?:\[[^\]]*\]\s*TJ)|(?:\((?:[^()\\]|\\.)*\)\s*Tj)/g) ?? [];
  for (const block of tjBlocks) {
    const parts = block.match(re) ?? [];
    const joined = parts.map((p) => pdfUnescape(p.slice(1, -1))).join('');
    if (joined.trim()) out.push(joined);
  }
  return out.join(' ').replace(/\s+/g, ' ').trim();
}

async function extractPdf(fileName: string, bytes: Uint8Array): Promise<ExtractionResult> {
  const raw = latin1.decode(bytes);
  if (!raw.startsWith('%PDF')) {
    return assemble(fileName, 'pdf', [], { notes: ['File does not look like a PDF.'] });
  }
  const notes: string[] = [];
  // Page count from /Type /Page occurrences (good enough for provenance).
  const pageCount = (raw.match(/\/Type\s*\/Page[^s]/g) ?? []).length || undefined;

  const blocks: ExtractedBlock[] = [];
  let paragraphIndex = 0;
  let encounteredCompressed = 0;
  let decodedStreams = 0;

  const streamRe = /stream\r?\n?([\s\S]*?)endstream/g;
  let m: RegExpExecArray | null;
  let streamOrdinal = 0;
  while ((m = streamRe.exec(raw)) !== null) {
    streamOrdinal++;
    const header = raw.slice(Math.max(0, m.index - 400), m.index);
    const isFlate = /\/Filter\s*(?:\[\s*)?\/FlateDecode/.test(header);
    const isText = !/\/Subtype\s*\/Image/.test(header) && !/\/Image/.test(header);
    if (!isText) continue;

    let content: string | undefined;
    if (isFlate) {
      encounteredCompressed++;
      try {
        let s = m.index + 'stream'.length;
        if (raw[s] === '\r') s++;
        if (raw[s] === '\n') s++;
        let end = m.index + m[0].lastIndexOf('endstream');
        // Prefer the declared /Length; otherwise trim the EOL that precedes
        // "endstream" — an extra byte makes the inflater reject the stream.
        const declared = /\/Length\s+(\d+)/.exec(header);
        if (declared) {
          end = Math.min(end, s + Number(declared[1]));
        } else {
          while (end > s && (raw[end - 1] === '\n' || raw[end - 1] === '\r')) end--;
        }
        const slice = bytes.subarray(s, end);
        const ds = new DecompressionStream('deflate');
        const stream = new Blob([slice as unknown as BlobPart]).stream().pipeThrough(ds);
        content = latin1.decode(new Uint8Array(await new Response(stream).arrayBuffer()));
        decodedStreams++;
      } catch {
        content = undefined;
      }
    } else {
      content = m[1];
    }
    if (!content) continue;
    const text = textFromContentStream(content);
    if (text) {
      paragraphIndex++;
      blocks.push({ text, page: pageCount ? Math.min(streamOrdinal, pageCount) : undefined, paragraph: paragraphIndex });
    }
  }

  if (blocks.length === 0) {
    const looksScanned = /\/Subtype\s*\/Image/.test(raw);
    return assemble(fileName, 'pdf', [], {
      pageCount,
      needsOcr: looksScanned,
      notes: [
        looksScanned
          ? 'No text layer found — this looks like a scanned/image PDF. OCR (optional, local) or manual paste is required.'
          : 'No readable text layer could be extracted from this PDF.',
      ],
    });
  }
  if (encounteredCompressed > 0 && decodedStreams < encounteredCompressed) {
    notes.push(
      `${encounteredCompressed - decodedStreams} compressed stream(s) could not be decoded — extraction is incomplete.`,
    );
  }
  return assemble(fileName, 'pdf', blocks, { pageCount, notes });
}

// ------------------------------------------------------------------ facade

/**
 * Extract text from a supported document. Never throws for content problems —
 * it returns a result whose `method` states honestly what happened.
 */
export async function extractDocumentText(fileName: string, bytes: Uint8Array): Promise<ExtractionResult> {
  const format = detectFormat(fileName, bytes);
  try {
    switch (format) {
      case 'txt':
        return extractTxt(fileName, bytes);
      case 'md':
        return extractMarkdown(fileName, bytes);
      case 'rtf':
        return extractRtf(fileName, bytes);
      case 'docx':
        return await extractDocx(fileName, bytes);
      case 'pdf':
        return await extractPdf(fileName, bytes);
      case 'image':
        return assemble(fileName, 'image', [], {
          needsOcr: true,
          notes: ['Images contain no text layer. Optional local OCR or manual paste is required.'],
        });
      default:
        return assemble(fileName, 'unknown', [], {
          notes: ['Unsupported file type — paste the text manually to bring it into the record.'],
        });
    }
  } catch (err) {
    return assemble(fileName, format, [], {
      notes: [`Extraction failed: ${err instanceof Error ? err.message : 'unknown error'}`],
    });
  }
}

/** Manual paste path — recorded honestly as clinician-provided text. */
export function manualExtraction(fileName: string, text: string): ExtractionResult {
  const paragraphs = text.replace(/\r\n/g, '\n').split(/\n\s*\n/).map((t) => ({ text: t }));
  const blocks = toBlocks(paragraphs);
  return assemble(fileName, detectFormat(fileName), blocks, { forceMethod: blocks.length ? 'manual' : 'failed' });
}
