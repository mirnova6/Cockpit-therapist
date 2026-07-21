import { useEffect, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Icon } from '../../app/components/Icon';
import { Badge, Card, type BadgeTone } from '../../app/components/ui';
import { computePhiGateStatus, HIPAA_CONSCIOUS_DISCLAIMER } from '../../core/governance/phase7Schema';
import { useGovernanceStore } from '../../state/governanceStore';

interface HubLink {
  to: string;
  title: string;
  icon: string;
  summary: string;
  status?: { tone: BadgeTone; label: string };
}

export function GovernanceHubScreen() {
  const navigate = useNavigate();
  const checklist = useGovernanceStore((s) => s.checklist);
  const approvals = useGovernanceStore((s) => s.approvals);
  const threatModel = useGovernanceStore((s) => s.threatModel);
  const policies = useGovernanceStore((s) => s.policies);
  const phiGate = useGovernanceStore((s) => s.phiGate);
  const loadGovernance = useGovernanceStore((s) => s.loadGovernance);
  const loadPhase7 = useGovernanceStore((s) => s.loadPhase7);

  useEffect(() => {
    void loadGovernance();
    void loadPhase7();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const gateStatus = useMemo(() => computePhiGateStatus(phiGate), [phiGate]);
  const checklistReviewed = checklist.filter((i) => i.status === 'reviewed').length;
  const threatsReviewed = threatModel.filter((t) => t.reviewStatus === 'reviewed').length;
  const policiesReviewed = policies.filter((p) => p.status === 'reviewed-by-counsel' || p.status === 'adopted').length;
  const approvedProviders = approvals.filter((a) => a.approvalStatus === 'approved').length;

  const links: HubLink[] = [
    {
      to: '/governance/phi-gate',
      title: 'Real PHI Readiness Gate',
      icon: 'shield',
      summary: 'The blocking gate before any real PHI. Items complete only through explicit manual review.',
      status: gateStatus.blocked
        ? { tone: 'red', label: `Blocked · ${gateStatus.completed}/${gateStatus.total}` }
        : { tone: 'amber', label: 'Limited reviewed use' },
    },
    {
      to: '/governance/security-packet',
      title: 'Security review packet',
      icon: 'file',
      summary: 'Architecture, encryption, key management, storage, AI safeguards, isolation, limitations — for reviewers.',
    },
    {
      to: '/governance/data-flow',
      title: 'Data-flow map',
      icon: 'activity',
      summary: 'What is entered, where it is stored, whether it is encrypted, and when (if ever) it leaves the device.',
    },
    {
      to: '/governance/threats',
      title: 'Threat model',
      icon: 'alert',
      summary: 'Lost device, forgotten passphrase, misconfigured online AI, prompt injection, overreliance, and more.',
      status: { tone: threatsReviewed === threatModel.length && threatModel.length > 0 ? 'green' : 'amber', label: `${threatsReviewed}/${threatModel.length} reviewed` },
    },
    {
      to: '/governance/policies',
      title: 'Policy & disclosure drafts',
      icon: 'clipboard',
      summary: 'Editable, exportable templates: retention, deletion, backup, incident response, consent, disclaimer, and more.',
      status: { tone: policiesReviewed > 0 ? 'green' : 'neutral', label: `${policiesReviewed}/${policies.length} reviewed` },
    },
    {
      to: '/providers',
      title: 'AI vendor / BAA review',
      icon: 'shield',
      summary: 'Track provider, model, endpoint, purposes, BAA/contract status, reviewer, and approval — gates online PHI.',
      status: { tone: approvedProviders > 0 ? 'green' : 'neutral', label: `${approvedProviders}/${approvals.length} approved` },
    },
    {
      to: '/readiness',
      title: 'Readiness checklist & report',
      icon: 'check',
      summary: 'The security & compliance readiness checklist and the exportable production-readiness report.',
      status: { tone: checklistReviewed === checklist.length && checklist.length > 0 ? 'green' : 'amber', label: `${checklistReviewed}/${checklist.length} reviewed` },
    },
    {
      to: '/audit',
      title: 'Audit & AI operations',
      icon: 'list',
      summary: 'Security-relevant actions and AI operations — identifiers and metadata only, never clinical plaintext.',
    },
  ];

  return (
    <main className="page">
      <div className="stack" style={{ maxWidth: 1000, margin: '0 auto' }}>
        <div className="spread">
          <button className="btn btn--ghost btn--sm" onClick={() => navigate('/settings')}>
            <Icon name="chevron-left" size={15} /> Workspace settings
          </button>
          <Badge tone={gateStatus.blocked ? 'red' : 'amber'} icon="shield">
            {gateStatus.blocked ? 'Not approved for real PHI' : 'Limited reviewed use'}
          </Badge>
        </div>

        <Card title="HIPAA-conscious readiness dashboard" icon="shield">
          <p className="muted small" style={{ margin: 0, lineHeight: 1.7 }}>{HIPAA_CONSCIOUS_DISCLAIMER}</p>
        </Card>

        <div className="notice notice--warn" role="status">
          <Icon name="alert" size={16} />
          <span className="small">
            <strong>{gateStatus.statusLine}</strong>{' '}
            {gateStatus.blocked
              ? `${gateStatus.incompleteLabels.length} required gate item(s) remain. Real PHI use is blocked by default.`
              : 'All gate items were completed through manual review. This is not a legal certification.'}
          </span>
        </div>

        <div className="row-list">
          {links.map((link) => (
            <Link key={link.to} to={link.to} className="list-row" style={{ textDecoration: 'none' }}>
              <Icon name={link.icon} size={17} className="soft" />
              <span style={{ flex: 1 }}>
                <strong className="small">{link.title}</strong>
                <span className="muted small" style={{ display: 'block' }}>{link.summary}</span>
              </span>
              {link.status && <Badge tone={link.status.tone}>{link.status.label}</Badge>}
              <Icon name="chevron-right" size={15} className="soft" />
            </Link>
          ))}
        </div>

        <Card icon="info">
          <p className="muted small" style={{ margin: 0 }}>
            This dashboard prepares the app for independent legal/security review. It never claims the app is HIPAA
            compliant, legally approved, safe for PHI, or ready for clinical deployment. Use requires legal/security
            review and BAA/vendor verification where applicable.
          </p>
        </Card>
      </div>
    </main>
  );
}
