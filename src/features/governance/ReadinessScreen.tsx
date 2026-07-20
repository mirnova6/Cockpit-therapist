import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon } from '../../app/components/Icon';
import { Badge, Card, Field, type BadgeTone } from '../../app/components/ui';
import {
  CHECKLIST_STATUSES,
  READINESS_DISCLAIMER,
  type ChecklistItem,
  type ChecklistStatus,
} from '../../core/governance/governanceSchema';
import { renderReadinessReportText } from '../../core/governance/readinessReport';
import { downloadJson, downloadText } from '../../lib/download';
import { fmtDate } from '../../lib/format';
import { useGovernanceStore } from '../../state/governanceStore';

function statusTone(status: ChecklistStatus): BadgeTone {
  return status === 'reviewed' ? 'green' : status === 'blocked' ? 'red' : status === 'not-started' ? 'neutral' : 'amber';
}

function ChecklistRow({ item }: { item: ChecklistItem }) {
  const updateChecklistItem = useGovernanceStore((s) => s.updateChecklistItem);
  const [open, setOpen] = useState(false);
  const [notes, setNotes] = useState(item.notes ?? '');
  const [evidence, setEvidence] = useState(item.evidence ?? '');
  const [reviewer, setReviewer] = useState(item.reviewer ?? '');
  const [nextReview, setNextReview] = useState(item.nextReviewDate ?? '');

  const save = async (status?: ChecklistStatus) => {
    await updateChecklistItem(item.id, {
      status: status ?? item.status,
      notes: notes.trim() || undefined,
      evidence: evidence.trim() || undefined,
      reviewer: reviewer.trim() || undefined,
      nextReviewDate: nextReview || undefined,
    });
    setOpen(false);
  };

  return (
    <div className="soft" style={{ display: 'block', padding: 10 }}>
      <div className="spread">
        <span className="small" style={{ flex: 1 }}>
          {item.item}
          {item.dateReviewed && (
            <span className="muted" style={{ display: 'block' }}>
              Reviewed {fmtDate(item.dateReviewed)}{item.reviewer ? ` by ${item.reviewer}` : ''}
              {item.nextReviewDate ? ` · next review ${fmtDate(item.nextReviewDate)}` : ''}
            </span>
          )}
        </span>
        <div className="cluster">
          <Badge tone={statusTone(item.status)}>
            {CHECKLIST_STATUSES.find((s) => s.value === item.status)?.label}
          </Badge>
          <button className="btn btn--ghost btn--sm" onClick={() => setOpen((v) => !v)}>
            <Icon name="edit" size={13} />
          </button>
        </div>
      </div>
      {(item.notes || item.evidence) && !open && (
        <p className="muted small" style={{ margin: '4px 0 0' }}>
          {item.evidence && <>Evidence: {item.evidence}. </>}
          {item.notes && <>Notes: {item.notes}</>}
        </p>
      )}
      {open && (
        <div className="stack-sm" style={{ marginTop: 8 }}>
          <div className="cluster" style={{ flexWrap: 'wrap' }}>
            <Field label="Status">
              <select
                className="select"
                value={item.status}
                onChange={(e) => void save(e.target.value as ChecklistStatus)}
              >
                {CHECKLIST_STATUSES.map((s) => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
              </select>
            </Field>
            <Field label="Reviewer">
              <input className="input" value={reviewer} onChange={(e) => setReviewer(e.target.value)} />
            </Field>
            <Field label="Next review date">
              <input className="input" type="date" value={nextReview} onChange={(e) => setNextReview(e.target.value)} />
            </Field>
          </div>
          <Field label="Evidence or test link">
            <input className="input" value={evidence} onChange={(e) => setEvidence(e.target.value)} />
          </Field>
          <Field label="Notes">
            <input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
          <div className="cluster">
            <button className="btn btn--primary btn--sm" onClick={() => void save()}>
              <Icon name="check" size={13} /> Save
            </button>
            <button className="btn btn--secondary btn--sm" onClick={() => setOpen(false)}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}

export function ReadinessScreen() {
  const navigate = useNavigate();
  const checklist = useGovernanceStore((s) => s.checklist);
  const report = useGovernanceStore((s) => s.report);
  const loadGovernance = useGovernanceStore((s) => s.loadGovernance);
  const buildReport = useGovernanceStore((s) => s.buildReport);
  const [building, setBuilding] = useState(false);

  useEffect(() => {
    void loadGovernance();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const grouped = useMemo(() => {
    const map = new Map<string, ChecklistItem[]>();
    for (const item of checklist) {
      map.set(item.category, [...(map.get(item.category) ?? []), item]);
    }
    return [...map.entries()];
  }, [checklist]);

  const reviewed = checklist.filter((i) => i.status === 'reviewed').length;

  const generate = async () => {
    setBuilding(true);
    try {
      await buildReport();
    } finally {
      setBuilding(false);
    }
  };

  return (
    <main className="page">
      <div className="stack" style={{ maxWidth: 1000, margin: '0 auto' }}>
        <div className="spread">
          <button className="btn btn--ghost btn--sm" onClick={() => navigate('/settings')}>
            <Icon name="chevron-left" size={15} /> Workspace settings
          </button>
          <Badge tone={reviewed === checklist.length && checklist.length > 0 ? 'green' : 'amber'} icon="check">
            {reviewed}/{checklist.length} reviewed
          </Badge>
        </div>

        <Card title="Security & compliance readiness checklist" icon="shield">
          <p className="muted small" style={{ margin: 0 }}>{READINESS_DISCLAIMER}</p>
        </Card>

        {grouped.map(([category, items]) => (
          <Card key={category} title={category} icon="clipboard">
            <div className="stack-sm">
              {items.map((item) => (
                <ChecklistRow key={item.id} item={item} />
              ))}
            </div>
          </Card>
        ))}

        <Card title="Production readiness report" icon="file">
          <div className="stack-sm">
            <p className="muted small" style={{ margin: 0 }}>
              Assembles live workspace state (checklist, approvals, operations, evaluation results) with
              documented capabilities, limitations, and the items required before real client data, online PHI
              processing, or multi-user deployment. Requires legal/security review — generating it makes no
              compliance claim.
            </p>
            <div className="cluster">
              <button className="btn btn--primary" disabled={building} onClick={() => void generate()}>
                <Icon name="file" size={15} /> {building ? 'Assembling…' : report ? 'Regenerate report' : 'Generate report'}
              </button>
              {report && (
                <>
                  <button className="btn btn--secondary btn--sm" onClick={() => downloadText(`cockpit-readiness-${report.generatedAt.slice(0, 10)}.txt`, renderReadinessReportText(report))}>
                    <Icon name="download" size={13} /> Export text
                  </button>
                  <button className="btn btn--secondary btn--sm" onClick={() => downloadJson(`cockpit-readiness-${report.generatedAt.slice(0, 10)}.json`, report)}>
                    <Icon name="download" size={13} /> Export JSON
                  </button>
                </>
              )}
            </div>
            {report && (
              <pre
                className="soft small"
                style={{ display: 'block', whiteSpace: 'pre-wrap', maxHeight: 420, overflowY: 'auto', padding: 12, margin: 0 }}
              >
                {renderReadinessReportText(report)}
              </pre>
            )}
          </div>
        </Card>
      </div>
    </main>
  );
}
