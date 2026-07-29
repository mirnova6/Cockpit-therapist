/**
 * Shared Phase 4 UI pieces: provenance banners (local vs online vs
 * deterministic always visible), qualitative-confidence badges, evidence
 * drawers, the clinician feedback bar, and the retrieval-debug panel.
 */
import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Icon } from '../../app/components/Icon';
import { Badge, type BadgeTone } from '../../app/components/ui';
import {
  CONFIDENCE_LABELS,
  FEEDBACK_LABELS,
  type ConfidenceLevel,
  type FeedbackLabel,
} from '../../core/ai/aiSchema';
import type { SegmentSource } from '../../core/db/documentSchema';
import type { IntelligenceGeneration } from '../../core/db/intelligenceSchema';
import type { RetrievalDebug } from '../../core/rag/clientRetrieval';
import { fmtDate } from '../../lib/format';
import { useIntelligenceStore } from '../../state/intelligenceStore';

// ------------------------------------------------------------- provenance

export function GenerationStamp({ generation }: { generation: IntelligenceGeneration }) {
  const tone: BadgeTone =
    generation.providerType === 'online' ? 'amber' : generation.providerType === 'local' ? 'blue' : 'green';
  const label =
    generation.providerType === 'online'
      ? `Online AI — content left this device (${generation.modelId ?? 'model'})`
      : generation.providerType === 'local'
        ? `Local AI — processed on this device (${generation.modelId ?? 'model'})`
        : 'Deterministic — no AI model used';
  return (
    <div className="notice notice--info" style={{ display: 'block' }}>
      <div className="cluster" style={{ gap: 8 }}>
        <Badge tone={tone} icon={generation.providerType === 'online' ? 'upload' : 'shield'}>
          {label}
        </Badge>
        <span className="muted small">{fmtDate(generation.generatedAt.slice(0, 10))}</span>
      </div>
      <p className="small muted" style={{ margin: '6px 0 0' }}>{generation.disclosure}</p>
    </div>
  );
}

// ------------------------------------------------------------- confidence

export function ConfidenceLevelBadge({ level }: { level: ConfidenceLevel }) {
  const tone: BadgeTone =
    level === 'strong-support' ? 'green' : level === 'moderate-support' ? 'blue' : level === 'low-support' ? 'amber' : 'neutral';
  return (
    <Badge tone={tone} icon="activity">
      {CONFIDENCE_LABELS[level]}
    </Badge>
  );
}

// --------------------------------------------------------- evidence drawer

export function EvidenceDrawer({
  sources,
  clientId,
  label = 'Evidence',
  emptyText = 'No evidence attached.',
}: {
  sources: SegmentSource[];
  clientId: string;
  label?: string;
  emptyText?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button className="btn btn--ghost btn--sm" onClick={() => setOpen((v) => !v)}>
        <Icon name="eye" size={13} /> {label} ({sources.length})
      </button>
      {open && (
        <div className="stack-sm" style={{ marginTop: 6 }}>
          {sources.length === 0 && <p className="muted small">{emptyText}</p>}
          {sources.map((source, i) => (
            <div key={i} className="soft small" style={{ display: 'block' }}>
              <div className="cluster" style={{ gap: 6 }}>
                <Badge tone={source.refType === 'hypothesis' ? 'plum' : 'blue'} icon="clipboard">
                  {source.label ?? source.refType}
                </Badge>
                {source.date && <span className="muted">{fmtDate(source.date)}</span>}
                {source.refType === 'input' && (
                  <Link className="small" to={`/clients/${clientId}/inputs/${source.refId}?highlight=${encodeURIComponent((source.excerpt ?? '').slice(0, 80))}`}>
                    Open in context
                  </Link>
                )}
              </div>
              {source.excerpt && <span className="prewrap" style={{ display: 'block', marginTop: 4 }}>“{source.excerpt}”</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------ feedback bar

export function FeedbackBar({
  clientId,
  targetType,
  targetId,
  operationId,
}: {
  clientId: string;
  targetType: string;
  targetId: string;
  operationId?: string;
}) {
  const addFeedback = useIntelligenceStore((s) => s.addFeedback);
  const existing = useIntelligenceStore(
    (s) => (s.byClient[clientId]?.feedback ?? []).filter((f) => f.targetId === targetId),
  );
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<FeedbackLabel[]>([]);
  const [comment, setComment] = useState('');
  const [saving, setSaving] = useState(false);

  const toggle = (label: FeedbackLabel) =>
    setSelected((prev) => (prev.includes(label) ? prev.filter((l) => l !== label) : [...prev, label]));

  const submit = async () => {
    if (selected.length === 0) return;
    setSaving(true);
    try {
      await addFeedback(clientId, targetType, targetId, selected, comment.trim() || undefined, operationId);
      setSelected([]);
      setComment('');
      setOpen(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="stack-sm" style={{ gap: 6 }}>
      <div className="cluster" style={{ gap: 8 }}>
        <button className="btn btn--ghost btn--sm" onClick={() => setOpen((v) => !v)}>
          <Icon name="edit" size={13} /> Rate this AI output
        </button>
        {existing.length > 0 && (
          <span className="muted small">
            Your feedback: {existing.flatMap((f) => f.labels).map((l) => FEEDBACK_LABELS.find((x) => x.value === l)?.label ?? l).join(', ')}
          </span>
        )}
      </div>
      {open && (
        <div className="soft" style={{ display: 'block', padding: 10 }}>
          <p className="muted small" style={{ marginTop: 0 }}>
            Feedback is stored separately from the clinical record, never becomes another client's data, and is
            not used to train any model. It feeds the Phase 5 evaluation export only.
          </p>
          <div className="cluster" style={{ gap: 6, flexWrap: 'wrap' }}>
            {FEEDBACK_LABELS.map((option) => (
              <button
                key={option.value}
                className={`btn btn--sm ${selected.includes(option.value) ? 'btn--primary' : 'btn--secondary'}`}
                onClick={() => toggle(option.value)}
                type="button"
              >
                {option.label}
              </button>
            ))}
          </div>
          <div className="cluster" style={{ marginTop: 8, gap: 8 }}>
            <input
              className="input"
              placeholder="Optional note"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
            />
            <button className="btn btn--primary btn--sm" disabled={selected.length === 0 || saving} onClick={() => void submit()}>
              Save feedback
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------ retrieval debug

export function RetrievalDebugPanel({ debug }: { debug: RetrievalDebug }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button className="btn btn--ghost btn--sm" onClick={() => setOpen((v) => !v)}>
        <Icon name="search" size={13} /> Why these sources? (retrieval details)
      </button>
      {open && (
        <div className="soft small" style={{ display: 'block', marginTop: 6, maxHeight: 320, overflowY: 'auto' }}>
          <p style={{ marginTop: 0 }}>
            <strong>Query:</strong> “{debug.query.slice(0, 160)}” · terms: {debug.queryTerms.join(', ') || '—'} ·{' '}
            {debug.candidateCount} candidate source(s) · time periods covered: {debug.timePeriodsCovered.join(', ') || '—'}
            {debug.contradictionsRetrieved && ' · contradictory evidence retrieved'}
          </p>
          {/* Phase 9: state the ranking mode ACTUALLY used, never the one merely requested. */}
          {debug.mode && (
            <p style={{ margin: '0 0 6px' }}>
              <strong>Ranking mode:</strong> {debug.mode}
              {debug.requestedMode && debug.requestedMode !== debug.mode && ` (requested: ${debug.requestedMode})`}
              {debug.weights &&
                ` · weights L${debug.weights.lexical}/S${debug.weights.semantic}/M${debug.weights.metadata}`}
              {typeof debug.semanticScoresAvailable === 'number' &&
                ` · ${debug.semanticScoresAvailable} vector score(s)`}
              {debug.modeDowngradedReason && (
                <span style={{ display: 'block', color: 'var(--amber)' }}>{debug.modeDowngradedReason}</span>
              )}
            </p>
          )}
          <strong>Retrieved:</strong>
          <ul style={{ margin: '4px 0' }}>
            {debug.retrieved.map((row) => (
              <li key={row.ref}>
                <strong>{row.ref}</strong> {row.label} · {fmtDate(row.date)} · {row.approvalStatus} · score {row.score}
                {typeof row.lexicalScore === 'number' && (
                  <>
                    {' '}
                    <span className="muted">
                      (lexical {row.lexicalScore} · semantic {row.semanticScore ?? 0} · metadata {row.metadataBoost ?? 0})
                    </span>
                  </>
                )}
                {row.keptForLongitudinalCoverage && <> · <em>kept for longitudinal coverage</em></>}
                {row.contradicts && <> · <em>contradicts another source</em></>}
                <br />
                <span className="muted">{row.reasons.join(' · ')}</span>
              </li>
            ))}
          </ul>
          {debug.excluded.length > 0 && (
            <>
              <strong>Excluded:</strong>
              <ul style={{ margin: '4px 0' }}>
                {debug.excluded.map((row, i) => (
                  <li key={i}>
                    {row.label} — <span className="muted">{row.reason}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------ misc badges

export function BasisBadge({ basis }: { basis: string }) {
  if (basis === 'hypothesis') return <Badge tone="plum" icon="search">Hypothesis</Badge>;
  if (basis === 'general-knowledge') return <Badge tone="blue" icon="file">Clinical knowledge</Badge>;
  if (basis === 'insufficient-evidence') return <Badge tone="neutral" icon="info">Insufficient evidence</Badge>;
  return <Badge tone="green" icon="check">Documented</Badge>;
}

export function SectionCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="soft" style={{ display: 'block', padding: 12 }}>
      <strong className="small" style={{ display: 'block', marginBottom: 6 }}>{title}</strong>
      {children}
    </div>
  );
}
