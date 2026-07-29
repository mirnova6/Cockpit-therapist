/**
 * Phase 4 clinician-managed clinical knowledge base (§6).
 *
 * Knowledge sources are WORKSPACE-level (not client-scoped) reference
 * material the clinician supplies and approves: manuals, protocols,
 * scoring guides, articles, clinician-authored frameworks. Only
 * clinician-approved sources are ever retrievable for clinical
 * recommendations, and every retrieved passage preserves its source
 * identity, section/page, version, and approval status — citations are
 * never invented.
 */

export type KnowledgeSourceType =
  | 'pdf-document'
  | 'text-document'
  | 'article'
  | 'web-source-metadata'
  | 'clinical-protocol'
  | 'scoring-guide'
  | 'treatment-manual'
  | 'clinician-framework';

export const KNOWLEDGE_SOURCE_TYPES: Array<{ value: KnowledgeSourceType; label: string }> = [
  { value: 'pdf-document', label: 'PDF document' },
  { value: 'text-document', label: 'Text document' },
  { value: 'article', label: 'Article (manual entry)' },
  { value: 'web-source-metadata', label: 'Approved web-source metadata' },
  { value: 'clinical-protocol', label: 'Clinical protocol' },
  { value: 'scoring-guide', label: 'Assessment scoring guide' },
  { value: 'treatment-manual', label: 'Treatment manual' },
  { value: 'clinician-framework', label: 'Clinician-authored framework' },
];

export type KnowledgeStatus =
  | 'pending-review'
  | 'approved'
  | 'rejected'
  | 'outdated'
  | 'superseded'
  | 'archived';

export const KNOWLEDGE_STATUSES: Array<{ value: KnowledgeStatus; label: string }> = [
  { value: 'pending-review', label: 'Pending Review' },
  { value: 'approved', label: 'Clinician Approved' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'outdated', label: 'Outdated' },
  { value: 'superseded', label: 'Superseded' },
  { value: 'archived', label: 'Archived' },
];

export function knowledgeStatusLabel(status: KnowledgeStatus): string {
  return KNOWLEDGE_STATUSES.find((s) => s.value === status)?.label ?? status;
}

/** Uses a source can be approved for; anything not allowed is excluded. */
export type KnowledgeUse =
  | 'intervention-recommendations'
  | 'case-formulation'
  | 'document-generation'
  | 'assessment-interpretation'
  | 'safety-strategy'
  | 'assistant-answers';

export const KNOWLEDGE_USES: Array<{ value: KnowledgeUse; label: string }> = [
  { value: 'intervention-recommendations', label: 'Intervention recommendations' },
  { value: 'case-formulation', label: 'Case formulation' },
  { value: 'document-generation', label: 'Document generation' },
  { value: 'assessment-interpretation', label: 'Assessment interpretation' },
  { value: 'safety-strategy', label: 'Safety & trust strategy' },
  { value: 'assistant-answers', label: 'Clinical assistant answers' },
];

export interface KnowledgeSource {
  id: string;
  title: string;
  author?: string;
  organization?: string;
  publicationYear?: string;
  editionOrVersion?: string;
  topic: string;
  /** e.g. 'CBT', 'MI', 'DBT', 'EMDR', 'general'. Used for retrieval filters. */
  therapyModel?: string;
  population?: string;
  levelOfCare?: string;
  jurisdiction?: string;
  sourceType: KnowledgeSourceType;
  /** Full formal citation the clinician wants shown. */
  citationDetails: string;
  dateAdded: string;
  dateReviewed?: string;
  status: KnowledgeStatus;
  /** Optional re-review / expiration date; past-due sources are excluded. */
  reviewDueDate?: string;
  clinicianNotes?: string;
  allowedUses: KnowledgeUse[];
  excludedUses: KnowledgeUse[];
  /** Attachment blob id when a file (e.g. PDF) was uploaded. */
  fileBlobId?: string;
  fileName?: string;
  /** True when chunked text content is available for retrieval. */
  hasText: boolean;
  chunkCount: number;
  supersededBy?: string;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface KnowledgeChunk {
  id: string;
  sourceId: string;
  seq: number;
  /** Heading/section detected during chunking, when present. */
  section?: string;
  /** Page marker when the supplied text contained explicit page breaks. */
  page?: string;
  text: string;
}

/** A retrieved passage with full provenance (§6, §23). */
export interface KnowledgePassage {
  sourceId: string;
  chunkId: string;
  title: string;
  citation: string;
  editionOrVersion?: string;
  section?: string;
  page?: string;
  status: KnowledgeStatus;
  text: string;
  score: number;
  reasons: string[];
}

// --------------------------------------------------------------- chunking

export interface ChunkingResult {
  chunks: Array<Omit<KnowledgeChunk, 'id' | 'sourceId'>>;
}

const MAX_CHUNK_CHARS = 1600;
const PAGE_BREAK = /^\s*(?:\[page\s+(\d+)\]|page\s+(\d+)\s*[:.-])\s*$/i;
const HEADING = /^\s{0,3}(?:#{1,4}\s+(.{2,80})|([A-Z][A-Za-z0-9 ,&/-]{2,60}):?)\s*$/;

/**
 * Deterministic paragraph-based chunker. Detects markdown-ish headings and
 * explicit "[page N]" markers so retrieved passages can cite a section or
 * page; long paragraphs are split at sentence boundaries.
 */
export function chunkKnowledgeText(text: string): ChunkingResult {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const chunks: Array<Omit<KnowledgeChunk, 'id' | 'sourceId'>> = [];
  let section: string | undefined;
  let page: string | undefined;
  let buffer: string[] = [];
  let seq = 0;

  const flush = () => {
    const body = buffer.join('\n').trim();
    buffer = [];
    if (!body) return;
    // Split oversized bodies at sentence boundaries.
    let remaining = body;
    while (remaining.length > MAX_CHUNK_CHARS) {
      const window = remaining.slice(0, MAX_CHUNK_CHARS);
      const cut = Math.max(window.lastIndexOf('. '), window.lastIndexOf('.\n'));
      const at = cut > MAX_CHUNK_CHARS / 3 ? cut + 1 : MAX_CHUNK_CHARS;
      chunks.push({ seq: seq++, section, page, text: remaining.slice(0, at).trim() });
      remaining = remaining.slice(at).trim();
    }
    if (remaining) chunks.push({ seq: seq++, section, page, text: remaining });
  };

  for (const line of lines) {
    const pageMatch = line.match(PAGE_BREAK);
    if (pageMatch) {
      flush();
      page = pageMatch[1] ?? pageMatch[2];
      continue;
    }
    const headingMatch = line.match(HEADING);
    if (headingMatch && line.trim().length <= 80) {
      flush();
      section = (headingMatch[1] ?? headingMatch[2])?.trim();
      continue;
    }
    if (line.trim() === '') {
      flush();
      continue;
    }
    buffer.push(line);
  }
  flush();
  return { chunks };
}
