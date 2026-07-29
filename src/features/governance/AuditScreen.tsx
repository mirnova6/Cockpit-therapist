import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon } from '../../app/components/Icon';
import { Badge, Card, EmptyState, Field, type BadgeTone } from '../../app/components/ui';
import type { AiOperationRecord } from '../../core/ai/aiSchema';
import type { AuditCategory } from '../../core/db/schema';
import { fmtDateTime } from '../../lib/format';
import { useAiStore } from '../../state/aiStore';
import { useGovernanceStore } from '../../state/governanceStore';

const CATEGORY_LABELS: Record<AuditCategory | 'all', string> = {
  all: 'All categories',
  auth: 'Login / lock / unlock',
  data: 'Clinical data actions',
  export: 'Exports',
  backup: 'Backup / restore',
  security: 'Security & AI governance',
};

/** Quick filters mapping §14 review needs onto audit actions. */
const ACTION_FILTERS: Array<{ value: string; label: string; test: (action: string) => boolean }> = [
  { value: 'all', label: 'All actions', test: () => true },
  { value: 'auth', label: 'Login & lock events', test: (a) => a.startsWith('auth.') || a.includes('lock') || a.includes('unlock') },
  { value: 'client', label: 'Client create/edit/delete', test: (a) => a.startsWith('client.') },
  { value: 'export', label: 'Export actions', test: (a) => a.includes('export') },
  { value: 'backup', label: 'Backup/restore', test: (a) => a.includes('backup') || a.includes('restore') },
  { value: 'ai-config', label: 'AI configuration changes', test: (a) => a === 'ai.settings-updated' || a.startsWith('provider-approval') },
  { value: 'ai-refused', label: 'Online AI refusals', test: (a) => a === 'ai.operation.refused' },
  { value: 'ai-run', label: 'AI runs (completed/cancelled)', test: (a) => a.startsWith('ai.operation.') && a !== 'ai.operation.refused' },
  { value: 'risk', label: 'Risk-review actions', test: (a) => a.includes('risk') },
  { value: 'approval', label: 'Document/formulation approvals', test: (a) => /\.(approve|reject)$/.test(a) || a.includes('formulation.') },
  { value: 'knowledge', label: 'Knowledge-source decisions', test: (a) => a.startsWith('knowledge.') },
  { value: 'isolation', label: 'Isolation violations blocked', test: (a) => a.includes('isolation') },
];

function opStatusTone(status: AiOperationRecord['status']): BadgeTone {
  return status === 'completed' ? 'green' : status === 'refused' ? 'amber' : status === 'cancelled' ? 'neutral' : 'red';
}

export function AuditScreen() {
  const navigate = useNavigate();
  const auditEvents = useGovernanceStore((s) => s.auditEvents);
  const operations = useGovernanceStore((s) => s.operations);
  const loadAudit = useGovernanceStore((s) => s.loadAudit);
  const aiSettings = useAiStore((s) => s.settings);

  const [tab, setTab] = useState<'audit' | 'operations'>('audit');
  const [category, setCategory] = useState<AuditCategory | 'all'>('all');
  const [actionFilter, setActionFilter] = useState('all');
  const [opMode, setOpMode] = useState<'all' | 'deterministic' | 'local' | 'online'>('all');
  const [opStatus, setOpStatus] = useState<'all' | AiOperationRecord['status']>('all');

  useEffect(() => {
    void loadAudit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const visibleAudit = useMemo(() => {
    const filter = ACTION_FILTERS.find((f) => f.value === actionFilter) ?? ACTION_FILTERS[0];
    return auditEvents.filter((e) => (category === 'all' || e.category === category) && filter.test(e.action));
  }, [auditEvents, category, actionFilter]);

  const visibleOps = useMemo(
    () =>
      operations.filter(
        (op) => (opMode === 'all' || op.mode === opMode) && (opStatus === 'all' || op.status === opStatus),
      ),
    [operations, opMode, opStatus],
  );

  return (
    <main id="main-content" tabIndex={-1} className="page">
      <div className="stack" style={{ maxWidth: 1100, margin: '0 auto' }}>
        <div className="spread">
          <button className="btn btn--ghost btn--sm" onClick={() => navigate('/settings')}>
            <Icon name="chevron-left" size={15} /> Workspace settings
          </button>
          <div className="cluster">
            <button className={`btn btn--sm ${tab === 'audit' ? 'btn--primary' : 'btn--secondary'}`} onClick={() => setTab('audit')}>
              Audit log ({auditEvents.length})
            </button>
            <button className={`btn btn--sm ${tab === 'operations' ? 'btn--primary' : 'btn--secondary'}`} onClick={() => setTab('operations')}>
              AI operations ({operations.length})
            </button>
          </div>
        </div>

        <Card title={tab === 'audit' ? 'Audit viewer' : 'AI operations viewer'} icon="list">
          <p className="muted small" style={{ margin: 0 }}>
            Entries contain identifiers and metadata only — never clinical prompt or record text. To see
            clinical content, open the related client record deliberately from its own screen.
          </p>
        </Card>

        {tab === 'audit' ? (
          <>
            <div className="cluster" style={{ flexWrap: 'wrap' }}>
              <Field label="Category">
                <select className="select" value={category} onChange={(e) => setCategory(e.target.value as never)}>
                  {(Object.keys(CATEGORY_LABELS) as Array<AuditCategory | 'all'>).map((value) => (
                    <option key={value} value={value}>{CATEGORY_LABELS[value]}</option>
                  ))}
                </select>
              </Field>
              <Field label="Action type">
                <select className="select" value={actionFilter} onChange={(e) => setActionFilter(e.target.value)}>
                  {ACTION_FILTERS.map((f) => (
                    <option key={f.value} value={f.value}>{f.label}</option>
                  ))}
                </select>
              </Field>
            </div>
            <Card>
              {visibleAudit.length === 0 ? (
                <EmptyState icon="list" title="No audit entries match the filters" />
              ) : (
                <div className="row-list">
                  {visibleAudit.map((event) => (
                    <div key={event.id} className="list-row" style={{ cursor: 'default' }}>
                      <Badge
                        tone={event.category === 'security' ? 'amber' : event.category === 'auth' ? 'blue' : 'neutral'}
                      >
                        {event.category}
                      </Badge>
                      <span style={{ flex: 1 }}>
                        <strong className="small">{event.action}</strong>
                        {event.detail && <span className="muted small" style={{ display: 'block' }}>{event.detail}</span>}
                      </span>
                      <span className="muted small">{fmtDateTime(event.at)}</span>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </>
        ) : (
          <>
            <div className="cluster" style={{ flexWrap: 'wrap' }}>
              <Field label="Processing mode">
                <select className="select" value={opMode} onChange={(e) => setOpMode(e.target.value as never)}>
                  <option value="all">All modes</option>
                  <option value="deterministic">Deterministic</option>
                  <option value="local">Local</option>
                  <option value="online">Online</option>
                </select>
              </Field>
              <Field label="Status">
                <select className="select" value={opStatus} onChange={(e) => setOpStatus(e.target.value as never)}>
                  <option value="all">All statuses</option>
                  <option value="completed">Completed</option>
                  <option value="refused">Refused</option>
                  <option value="cancelled">Cancelled</option>
                  <option value="failed">Failed</option>
                </select>
              </Field>
            </div>
            <Card>
              {visibleOps.length === 0 ? (
                <EmptyState icon="activity" title="No AI operations match the filters" />
              ) : (
                <div className="stack-sm">
                  {visibleOps.map((op) => (
                    <div key={op.id} className="soft" style={{ display: 'block', padding: 10 }}>
                      <div className="cluster" style={{ flexWrap: 'wrap', gap: 6 }}>
                        <Badge tone={opStatusTone(op.status)} icon={op.status === 'completed' ? 'check' : op.status === 'refused' ? 'alert' : 'x'}>
                          {op.status}
                        </Badge>
                        <Badge tone={op.mode === 'online' ? 'amber' : op.mode === 'local' ? 'blue' : 'green'}>{op.mode}</Badge>
                        <Badge tone={op.phiLeftDevice ? 'amber' : 'green'} icon="shield">
                          {op.phiLeftDevice ? 'data left device' : 'on-device'}
                        </Badge>
                        <span className="small"><strong>{op.capability}</strong> · {op.providerId} · {op.modelId}</span>
                      </div>
                      <p className="muted small" style={{ margin: '4px 0 0' }}>
                        Operation {op.id.slice(0, 8)} · {op.clientId ? (op.clientId.startsWith('eval:') ? `test case ${op.clientId.slice(5, 13)}…` : `client ${op.clientId.slice(0, 8)}…`) : 'workspace'}
                        {' · '}consent: {op.consentStatus}
                        {' · '}attestations: BAA {aiSettings.baaConfirmed ? 'attested' : 'not attested'} / PHI {aiSettings.onlinePhiApproved ? 'attested' : 'not attested'}
                        {' · '}{op.selectedSources.length} source(s), {op.knowledgeSources.length} knowledge
                        {op.inputTokens !== undefined && ` · ~${op.inputTokens}→${op.outputTokens ?? '?'} tokens`}
                        {' · '}{fmtDateTime(op.at)}
                        {op.durationMs !== undefined && ` (+${op.durationMs} ms)`}
                        {op.redactionApplied && ' · redacted'}
                        {op.errorKind && ` · ${op.errorKind}`}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </>
        )}
      </div>
    </main>
  );
}
