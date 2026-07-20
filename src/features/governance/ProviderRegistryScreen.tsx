import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon } from '../../app/components/Icon';
import { Badge, Card, EmptyState, Field, Modal, type BadgeTone } from '../../app/components/ui';
import type { AiCapability } from '../../core/ai/aiSchema';
import {
  APPROVAL_PURPOSES,
  APPROVAL_STATUSES,
  BAA_STATUSES,
  type ApprovalStatus,
  type BaaStatus,
  type ProviderApproval,
} from '../../core/governance/governanceSchema';
import { fmtDate } from '../../lib/format';
import { useGovernanceStore } from '../../state/governanceStore';

function statusTone(status: ApprovalStatus): BadgeTone {
  return status === 'approved' ? 'green' : status === 'not-approved' ? 'neutral' : status === 'suspended' ? 'red' : 'amber';
}

interface FormState {
  id?: string;
  providerId: string;
  providerName: string;
  providerType: 'local' | 'online';
  model: string;
  endpoint: string;
  approvalStatus: ApprovalStatus;
  baaStatus: BaaStatus;
  approvedPurposes: AiCapability[];
  disallowedPurposes: AiCapability[];
  reviewDueDate: string;
  keyRotationDue: string;
  notes: string;
}

const EMPTY_FORM: FormState = {
  providerId: 'anthropic-online',
  providerName: '',
  providerType: 'online',
  model: '',
  endpoint: '',
  approvalStatus: 'not-approved',
  baaStatus: 'none',
  approvedPurposes: [],
  disallowedPurposes: [],
  reviewDueDate: '',
  keyRotationDue: '',
  notes: '',
};

export function ProviderRegistryScreen() {
  const navigate = useNavigate();
  const approvals = useGovernanceStore((s) => s.approvals);
  const loadGovernance = useGovernanceStore((s) => s.loadGovernance);
  const saveApproval = useGovernanceStore((s) => s.saveApproval);
  const deleteApproval = useGovernanceStore((s) => s.deleteApproval);
  const [form, setForm] = useState<FormState>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    void loadGovernance();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const today = new Date().toISOString().slice(0, 10);

  const edit = (approval?: ProviderApproval) => {
    setError(undefined);
    setForm(
      approval
        ? {
            id: approval.id,
            providerId: approval.providerId,
            providerName: approval.providerName,
            providerType: approval.providerType,
            model: approval.model,
            endpoint: approval.endpoint ?? '',
            approvalStatus: approval.approvalStatus,
            baaStatus: approval.baaStatus,
            approvedPurposes: approval.approvedPurposes,
            disallowedPurposes: approval.disallowedPurposes,
            reviewDueDate: approval.reviewDueDate ?? '',
            keyRotationDue: approval.keyRotationDue ?? '',
            notes: approval.notes ?? '',
          }
        : { ...EMPTY_FORM },
    );
  };

  const togglePurpose = (list: 'approvedPurposes' | 'disallowedPurposes', purpose: AiCapability) => {
    if (!form) return;
    const current = form[list];
    const next = current.includes(purpose) ? current.filter((p) => p !== purpose) : [...current, purpose];
    const other: 'approvedPurposes' | 'disallowedPurposes' = list === 'approvedPurposes' ? 'disallowedPurposes' : 'approvedPurposes';
    setForm({ ...form, [list]: next, [other]: form[other].filter((p) => p !== purpose) });
  };

  const submit = async () => {
    if (!form) return;
    if (!form.providerName.trim() || !form.providerId.trim()) {
      setError('Provider name and provider id are required.');
      return;
    }
    await saveApproval({
      id: form.id,
      providerId: form.providerId.trim(),
      providerName: form.providerName.trim(),
      providerType: form.providerType,
      model: form.model.trim(),
      endpoint: form.endpoint.trim() || undefined,
      approvalStatus: form.approvalStatus,
      baaStatus: form.baaStatus,
      approvedPurposes: form.approvedPurposes,
      disallowedPurposes: form.disallowedPurposes,
      reviewDueDate: form.reviewDueDate || undefined,
      keyRotationDue: form.keyRotationDue || undefined,
      notes: form.notes.trim() || undefined,
    });
    setForm(undefined);
  };

  return (
    <main className="page">
      <div className="stack" style={{ maxWidth: 1000, margin: '0 auto' }}>
        <div className="spread">
          <button className="btn btn--ghost btn--sm" onClick={() => navigate('/settings')}>
            <Icon name="chevron-left" size={15} /> Workspace settings
          </button>
          <button className="btn btn--primary" onClick={() => edit()}>
            <Icon name="plus" size={15} /> Add provider entry
          </button>
        </div>

        <Card title="Provider approval registry" icon="shield">
          <p className="muted small" style={{ margin: 0 }}>
            Records your approval decisions per provider: BAA/contract status, approved and disallowed uses,
            review dates, and key-rotation reminders. When an entry exists for an online provider, the gateway
            ENFORCES it — no PHI is sent unless the entry is approved, unexpired, and the purpose is allowed.
            API keys are configured under AI settings, never stored here.
          </p>
        </Card>

        {approvals.length === 0 ? (
          <Card>
            <EmptyState icon="shield" title="No provider entries yet">
              <p className="small">
                Without an entry, online sends still require the Phase 4 attestations. Add an entry to enable
                per-purpose enforcement, expiration, and rotation reminders.
              </p>
            </EmptyState>
          </Card>
        ) : (
          approvals.map((approval) => (
            <Card key={approval.id}>
              <div className="stack-sm">
                <div className="spread">
                  <div className="cluster" style={{ flexWrap: 'wrap' }}>
                    <strong>{approval.providerName}</strong>
                    <Badge tone={statusTone(approval.approvalStatus)}>
                      {APPROVAL_STATUSES.find((s) => s.value === approval.approvalStatus)?.label}
                    </Badge>
                    <Badge tone={approval.baaStatus === 'signed' ? 'green' : 'amber'}>
                      {BAA_STATUSES.find((s) => s.value === approval.baaStatus)?.label}
                    </Badge>
                    <Badge tone="neutral">{approval.providerType} · {approval.model || 'model unset'}</Badge>
                    {approval.reviewDueDate && (
                      <Badge tone={approval.reviewDueDate < today ? 'red' : 'neutral'} icon="clock">
                        {approval.reviewDueDate < today ? 'REVIEW OVERDUE' : `review by ${fmtDate(approval.reviewDueDate)}`}
                      </Badge>
                    )}
                    {approval.keyRotationDue && (
                      <Badge tone={approval.keyRotationDue < today ? 'red' : 'neutral'} icon="lock">
                        {approval.keyRotationDue < today ? 'KEY ROTATION DUE' : `rotate key by ${fmtDate(approval.keyRotationDue)}`}
                      </Badge>
                    )}
                  </div>
                  <div className="cluster">
                    <button className="btn btn--secondary btn--sm" onClick={() => edit(approval)}>
                      <Icon name="edit" size={13} /> Edit
                    </button>
                    <button className="btn btn--ghost btn--sm" onClick={() => void deleteApproval(approval.id)}>
                      <Icon name="trash" size={13} />
                    </button>
                  </div>
                </div>
                <p className="muted small" style={{ margin: 0 }}>
                  Registry id: {approval.providerId}
                  {approval.endpoint ? ` · endpoint ${approval.endpoint}` : ''} · Approved uses:{' '}
                  {approval.approvedPurposes.length === 0
                    ? 'all (none restricted)'
                    : approval.approvedPurposes.map((p) => APPROVAL_PURPOSES.find((x) => x.value === p)?.label).join(', ')}
                  {approval.disallowedPurposes.length > 0 &&
                    ` · Disallowed: ${approval.disallowedPurposes.map((p) => APPROVAL_PURPOSES.find((x) => x.value === p)?.label).join(', ')}`}
                  {approval.notes && ` · ${approval.notes}`}
                </p>
              </div>
            </Card>
          ))
        )}
      </div>

      {form && (
        <Modal title={form.id ? 'Edit provider entry' : 'Add provider entry'} subtitle="Approval decisions are audited. Keys are never stored here." onClose={() => setForm(undefined)}>
          <div className="stack-sm" style={{ maxHeight: '65vh', overflowY: 'auto', paddingRight: 4 }}>
            <div className="cluster">
              <Field label="Provider name *">
                <input className="input" value={form.providerName} onChange={(e) => setForm({ ...form, providerName: e.target.value })} placeholder="e.g. Anthropic (Claude API)" />
              </Field>
              <Field label="Provider type">
                <select className="select" value={form.providerType} onChange={(e) => setForm({ ...form, providerType: e.target.value as 'local' | 'online' })}>
                  <option value="online">Online</option>
                  <option value="local">Local</option>
                </select>
              </Field>
            </div>
            <Field label="Registry id (must match the app provider id for enforcement)">
              <select className="select" value={form.providerId} onChange={(e) => setForm({ ...form, providerId: e.target.value })}>
                <option value="anthropic-online">anthropic-online (Secure Online AI)</option>
                <option value="online-embedding">online-embedding (Secure online embeddings)</option>
                <option value="local-endpoint">local-endpoint (Local AI)</option>
                <option value="local-embedding">local-embedding (Local embeddings)</option>
              </select>
            </Field>
            <div className="cluster">
              <Field label="Model">
                <input className="input" value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} />
              </Field>
              <Field label="Endpoint (informational)">
                <input className="input" value={form.endpoint} onChange={(e) => setForm({ ...form, endpoint: e.target.value })} />
              </Field>
            </div>
            <div className="cluster">
              <Field label="Approval status">
                <select className="select" value={form.approvalStatus} onChange={(e) => setForm({ ...form, approvalStatus: e.target.value as ApprovalStatus })}>
                  {APPROVAL_STATUSES.map((s) => (
                    <option key={s.value} value={s.value}>{s.label}</option>
                  ))}
                </select>
              </Field>
              <Field label="BAA / contract status">
                <select className="select" value={form.baaStatus} onChange={(e) => setForm({ ...form, baaStatus: e.target.value as BaaStatus })}>
                  {BAA_STATUSES.map((s) => (
                    <option key={s.value} value={s.value}>{s.label}</option>
                  ))}
                </select>
              </Field>
            </div>
            <Field label="Approved purposes (empty = all purposes allowed when approved)">
              <div className="stack-sm" style={{ gap: 4 }}>
                {APPROVAL_PURPOSES.map((purpose) => (
                  <label key={purpose.value} className="cluster small" style={{ gap: 8 }}>
                    <input
                      type="checkbox"
                      checked={form.approvedPurposes.includes(purpose.value)}
                      onChange={() => togglePurpose('approvedPurposes', purpose.value)}
                    />
                    {purpose.label}
                    <button
                      type="button"
                      className={`btn btn--sm ${form.disallowedPurposes.includes(purpose.value) ? 'btn--danger' : 'btn--ghost'}`}
                      style={{ marginLeft: 'auto' }}
                      onClick={() => togglePurpose('disallowedPurposes', purpose.value)}
                    >
                      {form.disallowedPurposes.includes(purpose.value) ? 'Disallowed' : 'Disallow'}
                    </button>
                  </label>
                ))}
              </div>
            </Field>
            <div className="cluster">
              <Field label="Approval expiration / re-review date">
                <input className="input" type="date" value={form.reviewDueDate} onChange={(e) => setForm({ ...form, reviewDueDate: e.target.value })} />
              </Field>
              <Field label="API key rotation reminder">
                <input className="input" type="date" value={form.keyRotationDue} onChange={(e) => setForm({ ...form, keyRotationDue: e.target.value })} />
              </Field>
            </div>
            <Field label="Notes">
              <input className="input" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </Field>
            {error && (
              <div className="notice notice--danger" role="alert">
                <Icon name="alert" size={15} />
                <span className="small">{error}</span>
              </div>
            )}
            <div className="cluster">
              <button className="btn btn--primary" onClick={() => void submit()}>
                <Icon name="check" size={14} /> Save entry
              </button>
              <button className="btn btn--secondary" onClick={() => setForm(undefined)}>Cancel</button>
            </div>
          </div>
        </Modal>
      )}
    </main>
  );
}
