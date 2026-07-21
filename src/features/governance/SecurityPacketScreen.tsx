import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon } from '../../app/components/Icon';
import { Badge, Card } from '../../app/components/ui';
import { renderSecurityPacketText } from '../../core/governance/securityPacket';
import { downloadJson, downloadText } from '../../lib/download';
import { useGovernanceStore } from '../../state/governanceStore';

export function SecurityPacketScreen() {
  const navigate = useNavigate();
  const packet = useGovernanceStore((s) => s.securityPacket);
  const buildSecurityPacket = useGovernanceStore((s) => s.buildSecurityPacket);
  const [building, setBuilding] = useState(false);

  useEffect(() => {
    setBuilding(true);
    void buildSecurityPacket().finally(() => setBuilding(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const date = packet?.generatedAt.slice(0, 10) ?? new Date().toISOString().slice(0, 10);

  return (
    <main className="page">
      <div className="stack" style={{ maxWidth: 1000, margin: '0 auto' }}>
        <div className="spread">
          <button className="btn btn--ghost btn--sm" onClick={() => navigate('/governance')}>
            <Icon name="chevron-left" size={15} /> Readiness dashboard
          </button>
          <Badge tone={packet?.liveSummary.phiGate.blocked ? 'red' : 'amber'} icon="shield">
            {packet?.liveSummary.phiGate.blocked ? 'PHI blocked' : 'Limited reviewed use'}
          </Badge>
        </div>

        <Card title="Security review packet" icon="file">
          <div className="stack-sm">
            <p className="muted small" style={{ margin: 0 }}>
              A structured description of the security architecture for independent legal/security review. It contains
              no secrets — no API keys, endpoints, passphrases, provider names, or client PHI — only architecture and
              aggregate counts. This is HIPAA-conscious preparation material and makes no compliance claim.
            </p>
            <div className="cluster">
              <button className="btn btn--primary btn--sm" disabled={building} onClick={() => { setBuilding(true); void buildSecurityPacket().finally(() => setBuilding(false)); }}>
                <Icon name="activity" size={13} /> {building ? 'Assembling…' : 'Refresh'}
              </button>
              {packet && (
                <>
                  <button className="btn btn--secondary btn--sm" onClick={() => downloadText(`cockpit-security-packet-${date}.txt`, renderSecurityPacketText(packet))}>
                    <Icon name="download" size={13} /> Export text
                  </button>
                  <button className="btn btn--secondary btn--sm" onClick={() => downloadJson(`cockpit-security-packet-${date}.json`, packet)}>
                    <Icon name="download" size={13} /> Export JSON
                  </button>
                </>
              )}
            </div>
          </div>
        </Card>

        {packet && (
          <>
            <Card title="Live summary (counts only)" icon="activity">
              <dl className="kv small" style={{ margin: 0 }}>
                <dt>Readiness checklist</dt>
                <dd>{packet.liveSummary.checklist.reviewed}/{packet.liveSummary.checklist.total} reviewed</dd>
                <dt>Provider approvals</dt>
                <dd>{packet.liveSummary.providerApprovals.total} recorded · {packet.liveSummary.providerApprovals.approved} approved · {packet.liveSummary.providerApprovals.withSignedBaa} with signed BAA</dd>
                <dt>Online AI</dt>
                <dd>{packet.liveSummary.onlineEnabled ? 'enabled' : 'disabled'}{packet.liveSummary.killSwitchActive ? ' · kill switch active' : ''}</dd>
                <dt>Real PHI readiness gate</dt>
                <dd>{packet.liveSummary.phiGate.statusLine} ({packet.liveSummary.phiGate.completed}/{packet.liveSummary.phiGate.total})</dd>
              </dl>
            </Card>

            {packet.sections.map((section) => (
              <Card key={section.key} title={section.title} icon="shield">
                <ul className="small" style={{ margin: 0, paddingLeft: 18, lineHeight: 1.6 }}>
                  {section.points.map((point, i) => (
                    <li key={i}>{point}</li>
                  ))}
                </ul>
              </Card>
            ))}
          </>
        )}
      </div>
    </main>
  );
}
