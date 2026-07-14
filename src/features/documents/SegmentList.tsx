import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Icon } from '../../app/components/Icon';
import { Badge, Field } from '../../app/components/ui';
import {
  isUnsupportedSegment,
  type DocSegment,
  type SegmentSource,
} from '../../core/db/documentSchema';
import { newId } from '../../core/db/schema';
import { fmtDate } from '../../lib/format';

function SourceLine({ source, clientId }: { source: SegmentSource; clientId: string }) {
  const target =
    source.refType === 'input'
      ? `/clients/${clientId}/inputs/${source.refId}${source.excerpt ? `?highlight=${encodeURIComponent(source.excerpt.slice(0, 120))}` : ''}`
      : source.refType === 'assessment'
        ? `/clients/${clientId}/assessments`
        : source.refType === 'hypothesis'
          ? `/clients/${clientId}/hypotheses`
          : source.refType === 'goal'
            ? `/clients/${clientId}/goals`
            : `/clients/${clientId}/profile`;
  return (
    <p className="small" style={{ margin: '2px 0' }}>
      <Badge tone="blue">{source.label ?? source.refType}</Badge>{' '}
      {source.date && <span className="muted">{fmtDate(source.date)} · </span>}
      {source.excerpt && <span className="soft">“{source.excerpt.slice(0, 160)}”</span>}{' '}
      <Link to={target}>open source</Link>
    </p>
  );
}

const KIND_LABEL: Record<DocSegment['kind'], { label: string; tone: 'blue' | 'plum' | 'neutral' | 'green' }> = {
  'factual': { label: 'Documented fact', tone: 'blue' },
  'interpretive': { label: 'Interpretive', tone: 'plum' },
  'template': { label: 'Template text', tone: 'neutral' },
  'therapist-authored': { label: 'Therapist-authored', tone: 'green' },
};

/**
 * Segment-based document editor: per-sentence evidence drawer, inline edit,
 * delete, mark-as-therapist-authored, add segment, and per-segment risk
 * confirmation. Read-only when the document is not editable.
 */
export function SegmentList({
  clientId,
  section,
  segments,
  editable,
  onChange,
  onAcknowledgeRisk,
}: {
  clientId: string;
  section: string;
  segments: DocSegment[];
  editable: boolean;
  onChange: (next: DocSegment[]) => void;
  onAcknowledgeRisk?: (segmentId: string, note?: string) => void;
}) {
  const [openEvidence, setOpenEvidence] = useState<Set<string>>(new Set());
  const [editingId, setEditingId] = useState<string>();
  const [editText, setEditText] = useState('');
  const [riskNotes, setRiskNotes] = useState<Record<string, string>>({});
  const [adding, setAdding] = useState(false);
  const [newText, setNewText] = useState('');

  const sectionSegments = segments.filter((s) => s.section === section);

  const replace = (id: string, patch: Partial<DocSegment>) =>
    onChange(segments.map((s) => (s.id === id ? { ...s, ...patch } : s)));

  const remove = (id: string) => onChange(segments.filter((s) => s.id !== id));

  const addSegment = () => {
    if (!newText.trim()) return;
    onChange([
      ...segments,
      {
        id: newId(),
        section,
        text: newText.trim(),
        kind: 'therapist-authored',
        sources: [],
        riskRelated: false,
      },
    ]);
    setNewText('');
    setAdding(false);
  };

  return (
    <div className="stack-sm">
      {sectionSegments.length === 0 && <p className="muted small">No content in this section.</p>}
      {sectionSegments.map((segment) => {
        const kind = KIND_LABEL[segment.kind];
        const unsupported = isUnsupportedSegment(segment);
        const showEvidence = openEvidence.has(segment.id);
        return (
          <div
            key={segment.id}
            className="stack-sm"
            style={{
              padding: '10px 12px',
              borderRadius: 10,
              border: `1px solid ${segment.riskRelated && !segment.riskAcknowledged ? 'var(--red)' : 'var(--line)'}`,
              background: segment.riskRelated && !segment.riskAcknowledged ? '#fdfaf9' : 'var(--surface)',
              gap: 6,
            }}
          >
            {editingId === segment.id ? (
              <>
                <textarea className="textarea" style={{ minHeight: 64 }} value={editText} onChange={(e) => setEditText(e.target.value)} />
                <div className="cluster">
                  <button
                    className="btn btn--primary btn--sm"
                    onClick={() => {
                      replace(segment.id, { text: editText.trim() });
                      setEditingId(undefined);
                    }}
                    disabled={!editText.trim()}
                  >
                    Save
                  </button>
                  <button className="btn btn--ghost btn--sm" onClick={() => setEditingId(undefined)}>Cancel</button>
                </div>
              </>
            ) : (
              <p className="soft small prewrap" style={{ margin: 0 }}>{segment.text}</p>
            )}

            <div className="cluster" style={{ gap: 6 }}>
              <Badge tone={kind.tone}>{kind.label}</Badge>
              {segment.fromPendingSource && <Badge tone="amber" icon="clock">From pending source</Badge>}
              {unsupported && <Badge tone="red" icon="alert">Unsupported draft content</Badge>}
              {segment.riskRelated && (
                <Badge tone={segment.riskAcknowledged ? 'amber' : 'red'} icon="alert">
                  {segment.riskAcknowledged ? 'Risk — confirmed' : 'Risk — confirmation required'}
                </Badge>
              )}
              {segment.sources.length > 0 && (
                <button
                  className="btn btn--ghost btn--sm"
                  onClick={() => {
                    const next = new Set(openEvidence);
                    if (next.has(segment.id)) next.delete(segment.id);
                    else next.add(segment.id);
                    setOpenEvidence(next);
                  }}
                >
                  <Icon name="eye" size={12} /> Evidence ({segment.sources.length})
                </button>
              )}
              {editable && editingId !== segment.id && (
                <>
                  <button className="btn btn--ghost btn--sm" onClick={() => { setEditingId(segment.id); setEditText(segment.text); }}>
                    <Icon name="edit" size={12} /> Edit
                  </button>
                  {unsupported && (
                    <button className="btn btn--ghost btn--sm" onClick={() => replace(segment.id, { kind: 'therapist-authored' })}>
                      Mark therapist-authored
                    </button>
                  )}
                  <button className="btn btn--ghost btn--sm" onClick={() => remove(segment.id)}>
                    <Icon name="trash" size={12} /> Delete
                  </button>
                </>
              )}
            </div>

            {showEvidence && (
              <div className="notice notice--info" style={{ display: 'block' }}>
                {segment.sources.map((source, i) => (
                  <SourceLine key={i} source={source} clientId={clientId} />
                ))}
              </div>
            )}

            {segment.riskRelated && !segment.riskAcknowledged && onAcknowledgeRisk && (
              <div className="stack-sm" style={{ gap: 6 }}>
                <Field label="Disposition / follow-up note (recorded with your confirmation)">
                  <input
                    className="input"
                    value={riskNotes[segment.id] ?? ''}
                    onChange={(e) => setRiskNotes({ ...riskNotes, [segment.id]: e.target.value })}
                    placeholder="e.g. Safety plan reviewed in session"
                  />
                </Field>
                <button
                  className="btn btn--danger btn--sm"
                  style={{ alignSelf: 'flex-start' }}
                  onClick={() => onAcknowledgeRisk(segment.id, riskNotes[segment.id]?.trim() || undefined)}
                >
                  <Icon name="check" size={13} /> Confirm this risk content
                </button>
              </div>
            )}
            {segment.riskNote && segment.riskAcknowledged && (
              <p className="muted small" style={{ margin: 0 }}>Disposition: {segment.riskNote}</p>
            )}
          </div>
        );
      })}

      {editable && (
        adding ? (
          <div className="stack-sm">
            <textarea
              className="textarea"
              style={{ minHeight: 60 }}
              value={newText}
              onChange={(e) => setNewText(e.target.value)}
              placeholder="Therapist-authored addition…"
            />
            <div className="cluster">
              <button className="btn btn--primary btn--sm" onClick={addSegment} disabled={!newText.trim()}>Add</button>
              <button className="btn btn--ghost btn--sm" onClick={() => setAdding(false)}>Cancel</button>
            </div>
          </div>
        ) : (
          <button className="btn btn--secondary btn--sm" style={{ alignSelf: 'flex-start' }} onClick={() => setAdding(true)}>
            <Icon name="plus" size={13} /> Add therapist-authored content
          </button>
        )
      )}
    </div>
  );
}
