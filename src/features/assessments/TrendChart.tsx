import { useMemo, useRef, useState } from 'react';
import { getDefinition } from '../../core/assessments/definitions';
import type { AssessmentRecord } from '../../core/db/structuredSchema';
import { fmtDate } from '../../lib/format';

/**
 * Single-series score-over-time line chart (one chart per measure, so no
 * legend — the card title names the series). Palette validated:
 * #3574ab passes chroma/contrast checks on white; grid and text stay in
 * neutral ink tokens. A chronological score table always accompanies this
 * chart in the Assessments tab (table view for accessibility).
 */
const SERIES = '#3574ab';
const W = 640;
const H = 220;
const PAD = { top: 18, right: 56, bottom: 34, left: 40 };

interface Point {
  x: number;
  y: number;
  record: AssessmentRecord;
}

export function TrendChart({ records }: { records: AssessmentRecord[] }) {
  const [hover, setHover] = useState<Point | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const scored = useMemo(
    () =>
      records
        .filter((r) => r.totalScore !== undefined)
        .sort((a, b) => a.dateAdministered.localeCompare(b.dateAdministered)),
    [records],
  );

  const def = scored.length > 0 ? getDefinition(scored[0].definitionKey) : undefined;

  const { points, yTicks, yMin, yMax } = useMemo(() => {
    if (scored.length === 0) return { points: [] as Point[], yTicks: [] as number[], yMin: 0, yMax: 10 };
    const scores = scored.map((r) => r.totalScore ?? 0);
    const lo = def?.min ?? Math.min(...scores);
    const hi = def?.max ?? Math.max(...scores);
    const yMin = Math.min(lo, Math.min(...scores));
    const yMax = Math.max(hi, Math.max(...scores), yMin + 1);
    const xFor = (i: number) =>
      scored.length === 1
        ? (W - PAD.left - PAD.right) / 2 + PAD.left
        : PAD.left + (i * (W - PAD.left - PAD.right)) / (scored.length - 1);
    const yFor = (score: number) =>
      PAD.top + ((yMax - score) / (yMax - yMin)) * (H - PAD.top - PAD.bottom);
    const points = scored.map((record, i) => ({
      x: xFor(i),
      y: yFor(record.totalScore ?? 0),
      record,
    }));
    const tickCount = 4;
    const yTicks = Array.from({ length: tickCount + 1 }, (_, i) =>
      Math.round(yMin + ((yMax - yMin) * i) / tickCount),
    );
    return { points, yTicks: [...new Set(yTicks)], yMin, yMax };
  }, [scored, def]);

  if (scored.length === 0) {
    return <p className="muted small">No scores recorded yet.</p>;
  }

  const yFor = (score: number) =>
    PAD.top + ((yMax - score) / (yMax - yMin)) * (H - PAD.top - PAD.bottom);

  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  const last = points[points.length - 1];

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = ((e.clientX - rect.left) / rect.width) * W;
    let nearest: Point | null = null;
    let best = Infinity;
    for (const p of points) {
      const d = Math.abs(p.x - x);
      if (d < best) {
        best = d;
        nearest = p;
      }
    }
    setHover(nearest);
  };

  return (
    <div style={{ position: 'relative' }}>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        style={{ width: '100%', height: 'auto', display: 'block', touchAction: 'none' }}
        role="img"
        aria-label={`Score trend across ${scored.length} administrations; details in the table below`}
        onPointerMove={onMove}
        onPointerLeave={() => setHover(null)}
      >
        {/* recessive grid + y labels */}
        {yTicks.map((tick) => (
          <g key={tick}>
            <line
              x1={PAD.left}
              x2={W - PAD.right}
              y1={yFor(tick)}
              y2={yFor(tick)}
              stroke="var(--line)"
              strokeWidth={1}
            />
            <text
              x={PAD.left - 8}
              y={yFor(tick) + 4}
              textAnchor="end"
              fontSize={11}
              fill="var(--ink-faint)"
            >
              {tick}
            </text>
          </g>
        ))}

        {/* x labels: first and last administration (single label when only one point) */}
        {(points.length === 1 ? [last] : [points[0], last]).map((p, i) => (
          <text
            key={i}
            x={p.x}
            y={H - PAD.bottom + 18}
            textAnchor={points.length === 1 ? 'middle' : i === 0 ? 'start' : 'end'}
            fontSize={11}
            fill="var(--ink-faint)"
          >
            {fmtDate(p.record.dateAdministered)}
          </text>
        ))}

        {/* series */}
        <path d={path} fill="none" stroke={SERIES} strokeWidth={2} strokeLinejoin="round" />
        {points.map((p) => (
          <circle
            key={p.record.id}
            cx={p.x}
            cy={p.y}
            r={hover?.record.id === p.record.id ? 6 : 4}
            fill={SERIES}
            stroke="var(--surface)"
            strokeWidth={2}
          />
        ))}

        {/* selective direct label: latest value only */}
        <text
          x={last.x + 10}
          y={last.y + 4}
          fontSize={12}
          fontWeight={650}
          fill="var(--ink-soft)"
        >
          {last.record.totalScore}
        </text>

        {/* hover crosshair */}
        {hover && (
          <line
            x1={hover.x}
            x2={hover.x}
            y1={PAD.top}
            y2={H - PAD.bottom}
            stroke="var(--line-strong)"
            strokeWidth={1}
            strokeDasharray="3 3"
          />
        )}
      </svg>

      {hover && (
        <div
          role="status"
          style={{
            position: 'absolute',
            left: `${(hover.x / W) * 100}%`,
            top: 0,
            transform: hover.x > W * 0.65 ? 'translateX(-105%)' : 'translateX(12px)',
            background: 'var(--surface)',
            border: '1px solid var(--line-strong)',
            borderRadius: 8,
            boxShadow: 'var(--shadow)',
            padding: '6px 10px',
            pointerEvents: 'none',
            maxWidth: 240,
          }}
        >
          <strong className="small">{hover.record.totalScore}</strong>{' '}
          <span className="muted small">{fmtDate(hover.record.dateAdministered)}</span>
          {hover.record.severityInterpretation && (
            <span className="muted small" style={{ display: 'block' }}>
              {hover.record.severityInterpretation}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
