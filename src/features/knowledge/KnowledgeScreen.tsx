import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon } from '../../app/components/Icon';
import { Badge, Card, EmptyState, Field, Modal, type BadgeTone } from '../../app/components/ui';
import { authService } from '../../core/auth/authService';
import {
  KNOWLEDGE_SOURCE_TYPES,
  KNOWLEDGE_STATUSES,
  KNOWLEDGE_USES,
  knowledgeStatusLabel,
  type KnowledgeChunk,
  type KnowledgeSource,
  type KnowledgeSourceType,
  type KnowledgeUse,
} from '../../core/knowledge/knowledgeSchema';
import { fmtDate } from '../../lib/format';
import { useIntelligenceStore } from '../../state/intelligenceStore';

function statusTone(status: KnowledgeSource['status']): BadgeTone {
  if (status === 'approved') return 'green';
  if (status === 'pending-review') return 'amber';
  if (status === 'rejected') return 'red';
  return 'neutral';
}

const EMPTY_FORM = {
  title: '',
  author: '',
  organization: '',
  publicationYear: '',
  editionOrVersion: '',
  topic: '',
  therapyModel: '',
  population: '',
  levelOfCare: '',
  jurisdiction: '',
  sourceType: 'text-document' as KnowledgeSourceType,
  citationDetails: '',
  reviewDueDate: '',
  clinicianNotes: '',
  text: '',
};

export function KnowledgeScreen() {
  const navigate = useNavigate();
  const sources = useIntelligenceStore((s) => s.knowledgeSources);
  const loadKnowledge = useIntelligenceStore((s) => s.loadKnowledge);
  const addSource = useIntelligenceStore((s) => s.addKnowledgeSource);
  const setStatus = useIntelligenceStore((s) => s.setKnowledgeStatus);
  const replaceText = useIntelligenceStore((s) => s.replaceKnowledgeText);
  const deleteSource = useIntelligenceStore((s) => s.deleteKnowledgeSource);

  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [allowedUses, setAllowedUses] = useState<KnowledgeUse[]>(KNOWLEDGE_USES.map((u) => u.value));
  const [file, setFile] = useState<File>();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const [detail, setDetail] = useState<KnowledgeSource>();
  const [chunks, setChunks] = useState<KnowledgeChunk[]>([]);
  const [pasteText, setPasteText] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<KnowledgeSource>();

  useEffect(() => {
    void loadKnowledge();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!detail) return;
    void authService
      .require()
      .knowledge.listChunks(detail.id)
      .then((c) => setChunks(c));
  }, [detail]);

  const set = (key: keyof typeof EMPTY_FORM) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm((prev) => ({ ...prev, [key]: e.target.value }));

  const toggleUse = (use: KnowledgeUse) =>
    setAllowedUses((prev) => (prev.includes(use) ? prev.filter((u) => u !== use) : [...prev, use]));

  const submit = async () => {
    if (!form.title.trim() || !form.topic.trim() || !form.citationDetails.trim()) {
      setError('Title, topic, and citation details are required — citations are never invented later.');
      return;
    }
    setSaving(true);
    setError(undefined);
    try {
      let fileBytes: { name: string; mimeType: string; bytes: Uint8Array<ArrayBuffer> } | undefined;
      let text = form.text.trim() || undefined;
      if (file) {
        const buffer = await file.arrayBuffer();
        fileBytes = { name: file.name, mimeType: file.type || 'application/octet-stream', bytes: new Uint8Array(buffer) };
        const isText = /^text\/|markdown|json/.test(file.type) || /\.(txt|md|markdown)$/i.test(file.name);
        if (isText && !text) {
          text = new TextDecoder().decode(buffer);
        } else if (!isText && !text) {
          setError(
            'This build cannot extract text from that file type (including PDFs) — the file is stored encrypted for reference, but you must paste the passage text below for it to be retrievable. Nothing will be silently invented from the file.',
          );
          setSaving(false);
          return;
        }
      }
      await addSource(
        {
          title: form.title.trim(),
          author: form.author.trim() || undefined,
          organization: form.organization.trim() || undefined,
          publicationYear: form.publicationYear.trim() || undefined,
          editionOrVersion: form.editionOrVersion.trim() || undefined,
          topic: form.topic.trim(),
          therapyModel: form.therapyModel.trim() || undefined,
          population: form.population.trim() || undefined,
          levelOfCare: form.levelOfCare.trim() || undefined,
          jurisdiction: form.jurisdiction.trim() || undefined,
          sourceType: form.sourceType,
          citationDetails: form.citationDetails.trim(),
          reviewDueDate: form.reviewDueDate || undefined,
          clinicianNotes: form.clinicianNotes.trim() || undefined,
          allowedUses,
          excludedUses: KNOWLEDGE_USES.map((u) => u.value).filter((u) => !allowedUses.includes(u)),
        },
        text,
        fileBytes,
      );
      setForm(EMPTY_FORM);
      setFile(undefined);
      setShowAdd(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the source.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <main id="main-content" tabIndex={-1} className="page">
      <div className="stack" style={{ maxWidth: 980, margin: '0 auto' }}>
        <div className="spread">
          <button className="btn btn--ghost btn--sm" onClick={() => navigate(-1)}>
            <Icon name="chevron-left" size={15} /> Back
          </button>
          <button className="btn btn--primary" onClick={() => setShowAdd(true)}>
            <Icon name="plus" size={15} /> Add knowledge source
          </button>
        </div>

        <Card title="Clinical knowledge library" icon="file">
          <p className="muted small" style={{ margin: 0 }}>
            Your clinician-managed reference library, encrypted at rest. Only sources YOU approve are ever used
            for recommendations, formulations, or assistant answers — and every retrieved passage keeps its
            source, section/page, and citation. Rejected, outdated, superseded, and past-due sources are never
            retrieved. Proprietary frameworks are used only if you supply and approve the material here.
          </p>
        </Card>

        {sources.length === 0 ? (
          <Card>
            <EmptyState icon="file" title="No knowledge sources yet">
              <p className="small">Add treatment manuals, protocols, scoring guides, articles, or your own frameworks.</p>
            </EmptyState>
          </Card>
        ) : (
          sources.map((source) => (
            <Card key={source.id}>
              <div className="stack-sm">
                <div className="spread">
                  <div className="cluster">
                    <strong>{source.title}</strong>
                    <Badge tone={statusTone(source.status)} icon={source.status === 'approved' ? 'check' : source.status === 'pending-review' ? 'clock' : 'x'}>
                      {knowledgeStatusLabel(source.status)}
                    </Badge>
                    <Badge tone="neutral" icon="file">
                      {KNOWLEDGE_SOURCE_TYPES.find((t) => t.value === source.sourceType)?.label}
                    </Badge>
                    {source.hasText ? (
                      <span className="muted small">{source.chunkCount} passage(s) indexed</span>
                    ) : (
                      <Badge tone="amber" icon="alert">No retrievable text</Badge>
                    )}
                  </div>
                  <button className="btn btn--ghost btn--sm" onClick={() => setDetail(source)}>
                    <Icon name="eye" size={13} /> Details
                  </button>
                </div>
                <p className="muted small" style={{ margin: 0 }}>
                  {source.citationDetails} · topic: {source.topic}
                  {source.therapyModel ? ` · model: ${source.therapyModel}` : ''}
                  {source.reviewDueDate ? ` · re-review by ${fmtDate(source.reviewDueDate)}` : ''}
                </p>
                <div className="cluster" style={{ gap: 6 }}>
                  {source.status === 'pending-review' && (
                    <>
                      <button className="btn btn--primary btn--sm" onClick={() => void setStatus(source.id, 'approved')}>
                        <Icon name="check" size={13} /> Approve for clinical use
                      </button>
                      <button className="btn btn--danger btn--sm" onClick={() => void setStatus(source.id, 'rejected')}>
                        <Icon name="x" size={13} /> Reject
                      </button>
                    </>
                  )}
                  {source.status === 'approved' && (
                    <>
                      <button className="btn btn--secondary btn--sm" onClick={() => void setStatus(source.id, 'outdated')}>
                        Mark outdated
                      </button>
                      <button className="btn btn--secondary btn--sm" onClick={() => void setStatus(source.id, 'archived')}>
                        Archive
                      </button>
                    </>
                  )}
                  {(source.status === 'outdated' || source.status === 'archived' || source.status === 'rejected') && (
                    <button className="btn btn--secondary btn--sm" onClick={() => void setStatus(source.id, 'pending-review')}>
                      Reopen for review
                    </button>
                  )}
                  <button className="btn btn--ghost btn--sm" onClick={() => setConfirmDelete(source)}>
                    <Icon name="trash" size={13} /> Delete
                  </button>
                </div>
              </div>
            </Card>
          ))
        )}
      </div>

      {showAdd && (
        <Modal title="Add knowledge source" subtitle="New sources start as Pending Review and are unusable until you approve them." onClose={() => setShowAdd(false)}>
          <div className="stack-sm" style={{ maxHeight: '65vh', overflowY: 'auto', paddingRight: 4 }}>
            <Field label="Title *"><input className="input" value={form.title} onChange={set('title')} /></Field>
            <div className="cluster">
              <Field label="Author"><input className="input" value={form.author} onChange={set('author')} /></Field>
              <Field label="Organization"><input className="input" value={form.organization} onChange={set('organization')} /></Field>
            </div>
            <div className="cluster">
              <Field label="Publication year"><input className="input" value={form.publicationYear} onChange={set('publicationYear')} /></Field>
              <Field label="Edition / version"><input className="input" value={form.editionOrVersion} onChange={set('editionOrVersion')} /></Field>
            </div>
            <div className="cluster">
              <Field label="Topic *"><input className="input" value={form.topic} onChange={set('topic')} placeholder="e.g. motivational interviewing" /></Field>
              <Field label="Therapy model"><input className="input" value={form.therapyModel} onChange={set('therapyModel')} placeholder="e.g. MI, CBT, DBT" /></Field>
            </div>
            <div className="cluster">
              <Field label="Population"><input className="input" value={form.population} onChange={set('population')} /></Field>
              <Field label="Level of care"><input className="input" value={form.levelOfCare} onChange={set('levelOfCare')} /></Field>
              <Field label="Jurisdiction"><input className="input" value={form.jurisdiction} onChange={set('jurisdiction')} /></Field>
            </div>
            <Field label="Source type">
              <select className="select" value={form.sourceType} onChange={set('sourceType')}>
                {KNOWLEDGE_SOURCE_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </Field>
            <Field label="Citation details * (shown verbatim wherever this source is cited)">
              <input className="input" value={form.citationDetails} onChange={set('citationDetails')} placeholder="Author (Year). Title. Publisher/Journal." />
            </Field>
            <Field label="Re-review / expiration date (optional — source is excluded after this date)">
              <input className="input" type="date" value={form.reviewDueDate} onChange={set('reviewDueDate')} />
            </Field>
            <Field label="Clinician notes">
              <input className="input" value={form.clinicianNotes} onChange={set('clinicianNotes')} />
            </Field>
            <Field label="Allowed uses">
              <div className="stack-sm" style={{ gap: 4 }}>
                {KNOWLEDGE_USES.map((use) => (
                  <label key={use.value} className="cluster small" style={{ gap: 8 }}>
                    <input type="checkbox" checked={allowedUses.includes(use.value)} onChange={() => toggleUse(use.value)} />
                    {use.label}
                  </label>
                ))}
              </div>
            </Field>
            <Field label="Content text (pasted — chunked for retrieval with section/page markers like '[page 12]')">
              <textarea className="textarea" style={{ minHeight: 140 }} value={form.text} onChange={set('text')} placeholder={'Overview:\nMotivational interviewing works with ambivalence…\n[page 12]\nRolling with resistance…'} />
            </Field>
            <Field label="Or upload a file (.txt/.md are indexed; PDFs are stored encrypted but need pasted text to be searchable)">
              <input className="input" type="file" onChange={(e) => setFile(e.target.files?.[0])} />
            </Field>
            {error && (
              <div className="notice notice--danger" role="alert">
                <Icon name="alert" size={15} />
                <span className="small">{error}</span>
              </div>
            )}
            <div className="cluster">
              <button className="btn btn--primary" disabled={saving} onClick={() => void submit()}>
                <Icon name="plus" size={14} /> {saving ? 'Saving…' : 'Add source (pending review)'}
              </button>
              <button className="btn btn--secondary" onClick={() => setShowAdd(false)}>Cancel</button>
            </div>
          </div>
        </Modal>
      )}

      {detail && (
        <Modal title={detail.title} subtitle={detail.citationDetails} onClose={() => setDetail(undefined)}>
          <div className="stack-sm" style={{ maxHeight: '60vh', overflowY: 'auto' }}>
            <div className="cluster" style={{ gap: 6, flexWrap: 'wrap' }}>
              <Badge tone={statusTone(detail.status)}>{knowledgeStatusLabel(detail.status)}</Badge>
              {detail.author && <span className="small muted">Author: {detail.author}</span>}
              {detail.organization && <span className="small muted">Org: {detail.organization}</span>}
              {detail.publicationYear && <span className="small muted">Year: {detail.publicationYear}</span>}
              {detail.editionOrVersion && <span className="small muted">Version: {detail.editionOrVersion}</span>}
              <span className="small muted">Added {fmtDate(detail.dateAdded)}</span>
              {detail.dateReviewed && <span className="small muted">Reviewed {fmtDate(detail.dateReviewed)}</span>}
            </div>
            <p className="small muted" style={{ margin: 0 }}>
              Allowed uses: {detail.allowedUses.length ? detail.allowedUses.map((u) => KNOWLEDGE_USES.find((x) => x.value === u)?.label).join(', ') : 'all'}
              {detail.excludedUses.length > 0 && ` · Excluded: ${detail.excludedUses.map((u) => KNOWLEDGE_USES.find((x) => x.value === u)?.label).join(', ')}`}
            </p>
            {KNOWLEDGE_STATUSES.length > 0 && detail.clinicianNotes && (
              <p className="small">Notes: {detail.clinicianNotes}</p>
            )}

            <strong className="small">Indexed passages ({chunks.length})</strong>
            {chunks.length === 0 && (
              <div className="stack-sm">
                <p className="muted small" style={{ margin: 0 }}>
                  No retrievable text yet. Paste the relevant content below — it will be chunked with its
                  section/page markers.
                </p>
                <textarea className="textarea" style={{ minHeight: 120 }} value={pasteText} onChange={(e) => setPasteText(e.target.value)} />
                <button
                  className="btn btn--primary btn--sm"
                  disabled={!pasteText.trim()}
                  onClick={() =>
                    void replaceText(detail.id, pasteText).then(() => {
                      setPasteText('');
                      setDetail(undefined);
                    })
                  }
                >
                  Index pasted text
                </button>
              </div>
            )}
            {chunks.slice(0, 12).map((chunk) => (
              <div key={chunk.id} className="soft small" style={{ display: 'block' }}>
                <span className="muted">
                  #{chunk.seq + 1}{chunk.section ? ` · ${chunk.section}` : ''}{chunk.page ? ` · page ${chunk.page}` : ''}
                </span>
                <p className="prewrap" style={{ margin: '4px 0 0' }}>{chunk.text.slice(0, 280)}{chunk.text.length > 280 ? '…' : ''}</p>
              </div>
            ))}
            {chunks.length > 12 && <p className="muted small">…and {chunks.length - 12} more passages.</p>}
            <button className="btn btn--secondary" onClick={() => setDetail(undefined)}>Close</button>
          </div>
        </Modal>
      )}

      {confirmDelete && (
        <Modal title="Delete knowledge source?" subtitle={`"${confirmDelete.title}" and all its indexed passages will be permanently removed.`} onClose={() => setConfirmDelete(undefined)} narrow>
          <div className="cluster">
            <button
              className="btn btn--danger"
              onClick={() => {
                void deleteSource(confirmDelete.id);
                setConfirmDelete(undefined);
              }}
            >
              <Icon name="trash" size={14} /> Delete permanently
            </button>
            <button className="btn btn--secondary" onClick={() => setConfirmDelete(undefined)}>Cancel</button>
          </div>
        </Modal>
      )}
    </main>
  );
}
