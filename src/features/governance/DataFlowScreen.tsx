import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon } from '../../app/components/Icon';
import { Badge, Card, type BadgeTone } from '../../app/components/ui';
import { renderDataFlowMapText, type DataFlowRow } from '../../core/governance/dataFlowMap';
import { downloadJson, downloadText } from '../../lib/download';
import { useGovernanceStore } from '../../state/governanceStore';

function encTone(v: DataFlowRow['encryptedAtRest']): BadgeTone {
  return v === 'yes' ? 'green' : v === 'no' ? 'amber' : 'neutral';
}

export function DataFlowScreen() {
  const navigate = useNavigate();
  const dataFlowMap = useGovernanceStore((s) => s.dataFlowMap);
  const buildDataFlow = useGovernanceStore((s) => s.buildDataFlow);

  useEffect(() => {
    buildDataFlow();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const date = new Date().toISOString().slice(0, 10);

  return (
    <main className="page">
      <div className="stack" style={{ maxWidth: 1000, margin: '0 auto' }}>
        <div className="spread">
          <button className="btn btn--ghost btn--sm" onClick={() => navigate('/governance')}>
            <Icon name="chevron-left" size={15} /> Readiness dashboard
          </button>
        </div>

        <Card title="Data-flow map" icon="activity">
          <div className="stack-sm">
            <p className="muted small" style={{ margin: 0 }}>
              {dataFlowMap?.disclaimer ??
                'Schema-level description of how each kind of data moves through the app. Contains no client PHI and no secrets.'}
            </p>
            {dataFlowMap && (
              <div className="cluster">
                <button className="btn btn--secondary btn--sm" onClick={() => downloadText(`cockpit-data-flow-${date}.txt`, renderDataFlowMapText(dataFlowMap))}>
                  <Icon name="download" size={13} /> Export text
                </button>
                <button className="btn btn--secondary btn--sm" onClick={() => downloadJson(`cockpit-data-flow-${date}.json`, dataFlowMap)}>
                  <Icon name="download" size={13} /> Export JSON
                </button>
              </div>
            )}
          </div>
        </Card>

        {dataFlowMap?.rows.map((row) => (
          <Card key={row.dataType} title={row.dataType} icon="file">
            <div className="stack-sm">
              <div className="cluster" style={{ gap: 6, flexWrap: 'wrap' }}>
                <Badge tone={encTone(row.encryptedAtRest)} icon="shield">
                  Encrypted at rest: {row.encryptedAtRest}
                </Badge>
              </div>
              <dl className="kv small" style={{ margin: 0 }}>
                <dt>Entered via</dt>
                <dd>{row.entryPoint}</dd>
                <dt>Stored</dt>
                <dd>{row.storageLocation}</dd>
                <dt>Leaves device</dt>
                <dd>{row.leavesDevice}</dd>
                <dt>Clinician approval</dt>
                <dd>{row.clinicianApproval}</dd>
                <dt>Provider approval</dt>
                <dd>{row.providerApproval}</dd>
                <dt>In exports</dt>
                <dd>{row.appearsInExports}</dd>
                <dt>In audit logs</dt>
                <dd>{row.appearsInAuditLogs}</dd>
                <dt>Never plaintext</dt>
                <dd>{row.neverPlaintext}</dd>
              </dl>
            </div>
          </Card>
        ))}

        {dataFlowMap && (
          <Card title="Legend" icon="info">
            <ul className="small" style={{ margin: 0, paddingLeft: 18, lineHeight: 1.6 }}>
              {dataFlowMap.legend.map((l, i) => (
                <li key={i}>{l}</li>
              ))}
            </ul>
          </Card>
        )}
      </div>
    </main>
  );
}
