import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon } from '../../app/components/Icon';
import { Badge, Card, Field, Modal, type BadgeTone } from '../../app/components/ui';
import {
  BETA_BANNER,
  BETA_CHECK_STATUSES,
  BUG_ISSUE_TYPES,
  BUG_SEVERITIES,
  type BetaCheckItem,
  type BetaCheckStatus,
  type BugIssueType,
  type BugSeverity,
} from '../../core/beta/betaSchema';
import { renderBetaReportText } from '../../core/beta/betaReport';
import { buildInfo } from '../../core/release/buildInfo';
import { runtimeEnvironment } from '../../core/platform/platform';
import { downloadJson, downloadText } from '../../lib/download';
import { useBetaStore } from '../../state/betaStore';

function checkTone(s: BetaCheckStatus): BadgeTone {
  return s === 'pass' ? 'green' : s === 'fail' ? 'red' : s === 'blocked' ? 'amber' : s === 'skip' ? 'neutral' : 'neutral';
}

function CheckRow({ item }: { item: BetaCheckItem }) {
  const updateCheck = useBetaStore((s) => s.updateCheck);
  const [notes, setNotes] = useState(item.notes ?? '');
  return (
    <div className="soft" style={{ display: 'block', padding: 10 }}>
      <div className="spread">
        <span className="small" style={{ flex: 1 }}>
          <strong>{item.label}</strong>
          <span className="muted" style={{ display: 'block' }}>{item.detail}</span>
        </span>
        <div className="cluster">
          <Badge tone={checkTone(item.status)}>{BETA_CHECK_STATUSES.find((s) => s.value === item.status)?.label}</Badge>
          <select
            className="select"
            style={{ width: 'auto' }}
            value={item.status}
            onChange={(e) => void updateCheck(item.id, { status: e.target.value as BetaCheckStatus, notes: notes.trim() || undefined })}
            aria-label={`Status for ${item.label}`}
          >
            {BETA_CHECK_STATUSES.map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
        </div>
      </div>
      <input
        className="input"
        style={{ marginTop: 6 }}
        placeholder="Notes (optional, no PHI)"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        onBlur={() => void updateCheck(item.id, { notes: notes.trim() || undefined })}
      />
    </div>
  );
}

const EMPTY_BUG = {
  screen: '',
  issueType: 'Incorrect behavior' as BugIssueType,
  stepsToReproduce: '',
  expectedBehavior: '',
  actualBehavior: '',
  severity: 'minor' as BugSeverity,
  screenshotNote: '',
  noPhiConfirmed: false,
};

export function BetaModeScreen() {
  const navigate = useNavigate();
  const state = useBetaStore((s) => s.state);
  const checklist = useBetaStore((s) => s.checklist);
  const bugReports = useBetaStore((s) => s.bugReports);
  const feedback = useBetaStore((s) => s.feedback);
  const busy = useBetaStore((s) => s.busy);
  const load = useBetaStore((s) => s.load);
  const setEnabled = useBetaStore((s) => s.setEnabled);
  const loadSampleData = useBetaStore((s) => s.loadSampleData);
  const addBugReport = useBetaStore((s) => s.addBugReport);
  const addFeedback = useBetaStore((s) => s.addFeedback);
  const buildReport = useBetaStore((s) => s.buildReport);

  const [showChecklist, setShowChecklist] = useState(false);
  const [bug, setBug] = useState<typeof EMPTY_BUG>();
  const [bugErr, setBugErr] = useState<string>();
  const [fb, setFb] = useState<{ area: string; rating: number; comment: string }>();
  const [sampleMsg, setSampleMsg] = useState<string>();

  const build = buildInfo();
  const runtime = runtimeEnvironment();

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const passed = useMemo(() => checklist.filter((c) => c.status === 'pass').length, [checklist]);

  const submitBug = async () => {
    if (!bug) return;
    setBugErr(undefined);
    if (!bug.noPhiConfirmed) {
      setBugErr('Please confirm the report contains no PHI before submitting.');
      return;
    }
    if (!bug.screen.trim() || !bug.actualBehavior.trim()) {
      setBugErr('Screen and actual behavior are required.');
      return;
    }
    await addBugReport({
      appVersion: `${build.version} (${build.commit})`,
      platform: runtime.label,
      screen: bug.screen.trim(),
      issueType: bug.issueType,
      stepsToReproduce: bug.stepsToReproduce.trim(),
      expectedBehavior: bug.expectedBehavior.trim(),
      actualBehavior: bug.actualBehavior.trim(),
      severity: bug.severity,
      screenshotNote: bug.screenshotNote.trim() || undefined,
      noPhiConfirmed: true,
    });
    setBug(undefined);
  };

  const submitFeedback = async () => {
    if (!fb || !fb.area.trim()) return;
    await addFeedback({ area: fb.area.trim(), rating: fb.rating, comment: fb.comment.trim() });
    setFb(undefined);
  };

  const exportReport = async () => {
    const report = await buildReport();
    const date = report.generatedAt.slice(0, 10);
    downloadText(`cockpit-beta-report-${date}.txt`, renderBetaReportText(report));
  };

  const exportReportJson = async () => {
    const report = await buildReport();
    downloadJson(`cockpit-beta-report-${report.generatedAt.slice(0, 10)}.json`, report);
  };

  return (
    <main id="main-content" tabIndex={-1} className="page">
      <div className="stack" style={{ maxWidth: 940, margin: '0 auto' }}>
        <div className="spread">
          <button className="btn btn--ghost btn--sm" onClick={() => navigate('/settings')}>
            <Icon name="chevron-left" size={15} /> Workspace settings
          </button>
          <Badge tone={state?.enabled ? 'amber' : 'neutral'} icon="activity">
            {state?.enabled ? 'Beta mode ON' : 'Beta mode off'}
          </Badge>
        </div>

        <Card title="Beta testing mode" icon="activity">
          <div className="stack-sm">
            {state?.enabled && (
              <div className="notice notice--warn" role="status">
                <Icon name="alert" size={16} />
                <span className="small">{BETA_BANNER}</span>
              </div>
            )}
            <p className="muted small" style={{ margin: 0 }}>
              Beta mode is a clearly-labeled testing mode for fictional or fully de-identified data only. It does not
              unlock real-PHI use — the Real PHI Readiness Gate remains authoritative and blocked by default. Runtime:{' '}
              <strong>{runtime.label}</strong> · build v{build.version} ({build.commit}).
            </p>
            <div className="cluster">
              <button className="btn btn--primary btn--sm" onClick={() => void setEnabled(!state?.enabled)}>
                <Icon name={state?.enabled ? 'x' : 'check'} size={13} /> {state?.enabled ? 'Turn off beta mode' : 'Turn on beta mode'}
              </button>
            </div>
          </div>
        </Card>

        <Card title="Sample fictional workspace" icon="users">
          <div className="stack-sm">
            <p className="muted small" style={{ margin: 0 }}>
              Loads three clearly-labeled <strong>[FICTIONAL]</strong> clients with transcripts, assessments, and a risk
              scenario so you can exercise the real flows without any real data.
            </p>
            {sampleMsg && (
              <div className="notice notice--info" role="status">
                <Icon name="check" size={15} /> <span className="small">{sampleMsg}</span>
              </div>
            )}
            <div className="cluster">
              <button
                className="btn btn--secondary btn--sm"
                disabled={busy}
                onClick={async () => {
                  const n = await loadSampleData();
                  setSampleMsg(`Loaded ${n} fictional client(s). Open them from Choose Client.`);
                }}
              >
                <Icon name="plus" size={13} /> Load sample fictional data
              </button>
              {state?.sampleDataLoaded && <Badge tone="green" icon="check">Sample data loaded</Badge>}
            </div>
          </div>
        </Card>

        <Card title="Guided testing checklist" icon="clipboard">
          <div className="stack-sm">
            <div className="spread">
              <span className="muted small">{passed}/{checklist.length} passed</span>
              <button className="btn btn--ghost btn--sm" onClick={() => setShowChecklist((v) => !v)}>
                {showChecklist ? 'Hide' : 'Show'} checklist
              </button>
            </div>
            {showChecklist && checklist.map((item) => <CheckRow key={item.id} item={item} />)}
          </div>
        </Card>

        <Card title="Report a bug (no PHI)" icon="alert">
          <div className="stack-sm">
            <p className="muted small" style={{ margin: 0 }}>
              Bug reports capture structured fields only — never client records, notes, transcripts, prompts, API keys,
              or exports. A report cannot be submitted until you confirm it contains no PHI.
            </p>
            <button className="btn btn--secondary btn--sm" style={{ alignSelf: 'flex-start' }} onClick={() => { setBugErr(undefined); setBug({ ...EMPTY_BUG }); }}>
              <Icon name="plus" size={13} /> New bug report
            </button>
            {bugReports.length > 0 && (
              <div className="stack-sm" style={{ gap: 6 }}>
                {bugReports.map((b) => (
                  <div key={b.id} className="spread small soft" style={{ padding: 8 }}>
                    <span>
                      <Badge tone={b.severity === 'blocker' ? 'red' : b.severity === 'major' ? 'amber' : 'neutral'}>{b.severity}</Badge>{' '}
                      {b.issueType} · {b.screen}
                    </span>
                    <span className="muted">{b.appVersion}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </Card>

        <Card title="Feedback" icon="edit">
          <div className="stack-sm">
            <button className="btn btn--secondary btn--sm" style={{ alignSelf: 'flex-start' }} onClick={() => setFb({ area: '', rating: 4, comment: '' })}>
              <Icon name="plus" size={13} /> Add feedback
            </button>
            {feedback.map((f) => (
              <div key={f.id} className="small soft" style={{ padding: 8 }}>
                <strong>{f.area}</strong> — {f.rating}/5{f.comment ? ` · ${f.comment}` : ''}
              </div>
            ))}
          </div>
        </Card>

        <Card title="Beta test report" icon="file">
          <div className="stack-sm">
            <p className="muted small" style={{ margin: 0 }}>
              Exportable summary of checklist results, bug reports, and feedback. Contains no PHI.
            </p>
            <div className="cluster">
              <button className="btn btn--primary btn--sm" onClick={() => void exportReport()}>
                <Icon name="download" size={13} /> Export report (text)
              </button>
              <button className="btn btn--secondary btn--sm" onClick={() => void exportReportJson()}>
                <Icon name="download" size={13} /> Export JSON
              </button>
            </div>
          </div>
        </Card>
      </div>

      {bug && (
        <Modal title="New bug report" subtitle="No PHI — structured fields only." onClose={() => setBug(undefined)}>
          <div className="stack-sm" style={{ maxHeight: '65vh', overflowY: 'auto', paddingRight: 4 }}>
            <div className="cluster">
              <Field label="Screen">
                <input className="input" value={bug.screen} onChange={(e) => setBug({ ...bug, screen: e.target.value })} placeholder="e.g. Client dashboard" />
              </Field>
              <Field label="Issue type">
                <select className="select" value={bug.issueType} onChange={(e) => setBug({ ...bug, issueType: e.target.value as BugIssueType })}>
                  {BUG_ISSUE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </Field>
              <Field label="Severity">
                <select className="select" value={bug.severity} onChange={(e) => setBug({ ...bug, severity: e.target.value as BugSeverity })}>
                  {BUG_SEVERITIES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </Field>
            </div>
            <Field label="Steps to reproduce">
              <textarea className="input" rows={3} value={bug.stepsToReproduce} onChange={(e) => setBug({ ...bug, stepsToReproduce: e.target.value })} />
            </Field>
            <Field label="Expected behavior">
              <textarea className="input" rows={2} value={bug.expectedBehavior} onChange={(e) => setBug({ ...bug, expectedBehavior: e.target.value })} />
            </Field>
            <Field label="Actual behavior">
              <textarea className="input" rows={2} value={bug.actualBehavior} onChange={(e) => setBug({ ...bug, actualBehavior: e.target.value })} />
            </Field>
            <Field label="Screenshot filename (optional — attach out-of-band, not stored here)">
              <input className="input" value={bug.screenshotNote} onChange={(e) => setBug({ ...bug, screenshotNote: e.target.value })} />
            </Field>
            <label className="cluster small" style={{ gap: 8 }}>
              <input type="checkbox" checked={bug.noPhiConfirmed} onChange={(e) => setBug({ ...bug, noPhiConfirmed: e.target.checked })} />
              I confirm this report contains no PHI.
            </label>
            {bugErr && (
              <div className="notice notice--danger" role="alert">
                <Icon name="alert" size={15} /> <span className="small">{bugErr}</span>
              </div>
            )}
            <div className="cluster">
              <button className="btn btn--primary" onClick={() => void submitBug()}>
                <Icon name="check" size={14} /> Submit report
              </button>
              <button className="btn btn--secondary" onClick={() => setBug(undefined)}>Cancel</button>
            </div>
          </div>
        </Modal>
      )}

      {fb && (
        <Modal narrow title="Feedback" onClose={() => setFb(undefined)}>
          <div className="stack-sm">
            <Field label="Area">
              <input className="input" value={fb.area} onChange={(e) => setFb({ ...fb, area: e.target.value })} placeholder="e.g. Navigation, Documents" />
            </Field>
            <Field label="Rating (1–5)">
              <select className="select" value={fb.rating} onChange={(e) => setFb({ ...fb, rating: Number(e.target.value) })}>
                {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </Field>
            <Field label="Comment (no PHI)">
              <textarea className="input" rows={3} value={fb.comment} onChange={(e) => setFb({ ...fb, comment: e.target.value })} />
            </Field>
            <div className="cluster">
              <button className="btn btn--primary" onClick={() => void submitFeedback()}>Save feedback</button>
              <button className="btn btn--secondary" onClick={() => setFb(undefined)}>Cancel</button>
            </div>
          </div>
        </Modal>
      )}
    </main>
  );
}
