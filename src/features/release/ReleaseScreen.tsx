import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon } from '../../app/components/Icon';
import { Badge, Card, type BadgeTone } from '../../app/components/ui';
import { buildInfo } from '../../core/release/buildInfo';
import {
  RELEASE_STATUSES,
  type ReleaseChecklistItem,
  type ReleaseStatus,
} from '../../core/release/releaseSchema';
import { renderDeploymentReportText } from '../../core/release/deploymentReport';
import { downloadJson, downloadText } from '../../lib/download';
import { useBetaStore } from '../../state/betaStore';
import { useGovernanceStore } from '../../state/governanceStore';

function relTone(s: ReleaseStatus): BadgeTone {
  return s === 'done' ? 'green' : s === 'blocked' ? 'red' : s === 'in-progress' ? 'amber' : 'neutral';
}

function ReleaseRow({ item }: { item: ReleaseChecklistItem }) {
  const updateReleaseItem = useGovernanceStore((s) => s.updateReleaseItem);
  const [notes, setNotes] = useState(item.notes ?? '');
  return (
    <div className="soft" style={{ display: 'block', padding: 10 }}>
      <div className="spread">
        <span className="small" style={{ flex: 1 }}>
          <strong>{item.label}</strong>
          <span className="muted" style={{ display: 'block' }}>{item.detail}</span>
        </span>
        <div className="cluster">
          <Badge tone={relTone(item.status)}>{RELEASE_STATUSES.find((s) => s.value === item.status)?.label}</Badge>
          <select
            className="select"
            style={{ width: 'auto' }}
            value={item.status}
            onChange={(e) => void updateReleaseItem(item.id, { status: e.target.value as ReleaseStatus, notes: notes.trim() || undefined })}
            aria-label={`Status for ${item.label}`}
          >
            {RELEASE_STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </div>
      </div>
      <input
        className="input"
        style={{ marginTop: 6 }}
        placeholder="Notes (optional)"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        onBlur={() => void updateReleaseItem(item.id, { notes: notes.trim() || undefined })}
      />
    </div>
  );
}

export function ReleaseScreen() {
  const navigate = useNavigate();
  const releaseChecklist = useGovernanceStore((s) => s.releaseChecklist);
  const deploymentReport = useGovernanceStore((s) => s.deploymentReport);
  const loadRelease = useGovernanceStore((s) => s.loadRelease);
  const buildDeploymentReport = useGovernanceStore((s) => s.buildDeploymentReport);
  const perf = useBetaStore((s) => s.perf);
  const busy = useBetaStore((s) => s.busy);
  const measurePerformance = useBetaStore((s) => s.measurePerformance);
  const [buildingReport, setBuildingReport] = useState(false);

  const build = buildInfo();

  useEffect(() => {
    void loadRelease();
    void buildDeploymentReport();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const grouped = useMemo(() => {
    const map = new Map<string, ReleaseChecklistItem[]>();
    for (const item of releaseChecklist) map.set(item.category, [...(map.get(item.category) ?? []), item]);
    return [...map.entries()];
  }, [releaseChecklist]);

  const date = deploymentReport?.generatedAt.slice(0, 10) ?? new Date().toISOString().slice(0, 10);

  return (
    <main id="main-content" tabIndex={-1} className="page">
      <div className="stack" style={{ maxWidth: 1000, margin: '0 auto' }}>
        <div className="spread">
          <button className="btn btn--ghost btn--sm" onClick={() => navigate('/governance')}>
            <Icon name="chevron-left" size={15} /> Readiness dashboard
          </button>
          <Badge tone="neutral">v{build.version} · {build.commit}</Badge>
        </div>

        <Card title="Release checklist" icon="clipboard">
          <p className="muted small" style={{ margin: 0 }}>
            Build v{build.version} · commit {build.commit} · built {build.buildDate}. Human-tracked release items; the
            deployment report below assembles these with live governance state. This is HIPAA-conscious preparation and
            makes no compliance claim.
          </p>
        </Card>

        {grouped.map(([category, items]) => (
          <Card key={category} title={category} icon="check">
            <div className="stack-sm">
              {items.map((item) => <ReleaseRow key={item.id} item={item} />)}
            </div>
          </Card>
        ))}

        <Card title="Performance snapshot" icon="activity">
          <div className="stack-sm">
            <p className="muted small" style={{ margin: 0 }}>
              Live, non-mutating read timings on the current workspace (load sample data or add clients first for a
              fuller picture). Heavier stress scenarios run in the automated test suite.
            </p>
            <button className="btn btn--secondary btn--sm" style={{ alignSelf: 'flex-start' }} disabled={busy} onClick={() => void measurePerformance()}>
              <Icon name="activity" size={13} /> {busy ? 'Measuring…' : 'Measure performance'}
            </button>
            {perf && (
              <table className="small" style={{ width: '100%', borderCollapse: 'collapse' }}>
                <tbody>
                  {perf.map((p) => (
                    <tr key={p.label}>
                      <td style={{ padding: '2px 8px 2px 0' }}>{p.label}{p.detail ? ` (${p.detail})` : ''}</td>
                      <td style={{ padding: '2px 0', textAlign: 'right', fontFamily: 'ui-monospace, monospace' }}>{p.ms} ms</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </Card>

        <Card title="Deployment decision report" icon="file">
          <div className="stack-sm">
            <button
              className="btn btn--primary btn--sm"
              disabled={buildingReport}
              onClick={() => { setBuildingReport(true); void buildDeploymentReport().finally(() => setBuildingReport(false)); }}
            >
              <Icon name="file" size={13} /> {buildingReport ? 'Assembling…' : 'Regenerate report'}
            </button>
            {deploymentReport && (
              <>
                <div className="notice notice--warn" role="status">
                  <Icon name="shield" size={16} />
                  <span className="small">
                    <strong>Classification: {deploymentReport.classificationLabel}.</strong>{' '}
                    Not approved for online PHI: {String(deploymentReport.notApprovedForOnlinePhi)} · Real PHI gate blocked:{' '}
                    {String(deploymentReport.phiGateBlocked)} · Native builds ready: {String(deploymentReport.nativeBuildsReady)}.
                  </span>
                </div>
                <div className="cluster">
                  <button className="btn btn--secondary btn--sm" onClick={() => downloadText(`cockpit-deployment-${date}.txt`, renderDeploymentReportText(deploymentReport))}>
                    <Icon name="download" size={13} /> Export text
                  </button>
                  <button className="btn btn--secondary btn--sm" onClick={() => downloadJson(`cockpit-deployment-${date}.json`, deploymentReport)}>
                    <Icon name="download" size={13} /> Export JSON
                  </button>
                </div>
                <pre className="soft small" style={{ display: 'block', whiteSpace: 'pre-wrap', maxHeight: 380, overflowY: 'auto', padding: 12, margin: 0 }}>
                  {renderDeploymentReportText(deploymentReport)}
                </pre>
              </>
            )}
          </div>
        </Card>
      </div>
    </main>
  );
}
