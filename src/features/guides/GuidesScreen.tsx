import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon } from '../../app/components/Icon';
import { Card } from '../../app/components/ui';
// Phase 6 planning documents, bundled as raw text (offline, no fetch).
import nativePackaging from '../../../docs/phase6/NATIVE_PACKAGING.md?raw';
import durableStorage from '../../../docs/phase6/DURABLE_STORAGE.md?raw';
import migration from '../../../docs/phase6/MIGRATION.md?raw';
import deviceTesting from '../../../docs/phase6/DEVICE_TESTING.md?raw';
import securityReview from '../../../docs/phase6/SECURITY_REVIEW.md?raw';
import productionBlockers from '../../../docs/phase6/PRODUCTION_BLOCKERS.md?raw';
import onlineProxy from '../../../docs/phase6/ONLINE_PROXY_PLAN.md?raw';
import pdfIngestion from '../../../docs/phase6/PDF_INGESTION_PLAN.md?raw';

interface Guide {
  id: string;
  title: string;
  summary: string;
  body: string;
}

const GUIDES: Guide[] = [
  { id: 'native', title: 'Native packaging plan', summary: 'Tauri (desktop) & Capacitor (mobile) integration.', body: nativePackaging },
  { id: 'storage', title: 'Durable local storage', summary: 'File-backed encrypted native storage adapter.', body: durableStorage },
  { id: 'migration', title: 'Browser → native migration', summary: 'Encrypted export/import with integrity checks.', body: migration },
  { id: 'device', title: 'Real-device testing checklist', summary: 'Per-device rows for desktop, phone, tablet.', body: deviceTesting },
  { id: 'security', title: 'Security review checklist', summary: 'Preparation for independent security review.', body: securityReview },
  { id: 'blockers', title: 'Production blocker list', summary: 'Gates before fictional / de-identified / PHI use.', body: productionBlockers },
  { id: 'proxy', title: 'Online AI proxy plan (future)', summary: 'How to avoid direct browser→provider PHI.', body: onlineProxy },
  { id: 'pdf', title: 'PDF/document ingestion plan', summary: 'Privacy-respecting local PDF text extraction.', body: pdfIngestion },
];

export function GuidesScreen() {
  const navigate = useNavigate();
  const [openId, setOpenId] = useState<string>();
  const open = GUIDES.find((g) => g.id === openId);

  return (
    <main className="page">
      <div className="stack" style={{ maxWidth: 900, margin: '0 auto' }}>
        <div className="spread">
          <button className="btn btn--ghost btn--sm" onClick={() => navigate('/settings')}>
            <Icon name="chevron-left" size={15} /> Workspace settings
          </button>
        </div>

        <Card title="Guides & checklists" icon="file">
          <p className="muted small" style={{ margin: 0 }}>
            Production-readiness and packaging documentation, bundled offline with the app. These are planning
            and preparation artifacts — they make no compliance claim.
          </p>
        </Card>

        {!open ? (
          <div className="row-list">
            {GUIDES.map((guide) => (
              <button key={guide.id} className="list-row" onClick={() => setOpenId(guide.id)}>
                <Icon name="file" size={16} className="soft" />
                <span style={{ flex: 1 }}>
                  <strong className="small">{guide.title}</strong>
                  <span className="muted small" style={{ display: 'block' }}>{guide.summary}</span>
                </span>
                <Icon name="chevron-right" size={15} className="soft" />
              </button>
            ))}
          </div>
        ) : (
          <Card>
            <div className="stack-sm">
              <button className="btn btn--ghost btn--sm" style={{ alignSelf: 'flex-start' }} onClick={() => setOpenId(undefined)}>
                <Icon name="chevron-left" size={13} /> All guides
              </button>
              <pre
                className="soft"
                style={{ display: 'block', whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontFamily: 'ui-monospace, monospace', fontSize: '0.8rem', lineHeight: 1.6, padding: 14, margin: 0, maxHeight: '70vh', overflowY: 'auto' }}
              >
                {open.body}
              </pre>
            </div>
          </Card>
        )}
      </div>
    </main>
  );
}
