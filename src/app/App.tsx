import { useEffect } from 'react';
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import { LockScreen } from '../features/auth/LockScreen';
import { SetupScreen } from '../features/auth/SetupScreen';
import { ChooseClientScreen } from '../features/clients/ChooseClientScreen';
import { ClientDashboardLayout } from '../features/dashboard/ClientDashboardLayout';
import { OverviewTab } from '../features/dashboard/OverviewTab';
import { AddClinicalInputScreen } from '../features/inputs/AddClinicalInputScreen';
import { InputDetailScreen } from '../features/inputs/InputDetailScreen';
import { InputsListTab } from '../features/inputs/InputsListTab';
import { TimelineTab } from '../features/inputs/TimelineTab';
import { AssessmentsTab } from '../features/assessments/AssessmentsTab';
import { DapNoteScreen } from '../features/documents/DapNoteScreen';
import { DapNotesTab } from '../features/documents/DapNotesTab';
import { DocumentsTab } from '../features/documents/DocumentsTab';
import { PlanScreen } from '../features/documents/PlanScreen';
import { PlanTab } from '../features/documents/PlanTab';
import { GoalsTab } from '../features/goals/GoalsTab';
import { EvidenceTab } from '../features/evidence/EvidenceTab';
import { ExtractionPreviewScreen } from '../features/extraction/ExtractionPreviewScreen';
import { HypothesesTab } from '../features/hypotheses/HypothesesTab';
import { StructuredProfileTab } from '../features/profile/StructuredProfileTab';
import { CompareScreen } from '../features/evaluation/CompareScreen';
import { EvalRunScreen } from '../features/evaluation/EvalRunScreen';
import { EvaluationScreen } from '../features/evaluation/EvaluationScreen';
import { AuditScreen } from '../features/governance/AuditScreen';
import { FeedbackDashboard } from '../features/governance/FeedbackDashboard';
import { ProviderRegistryScreen } from '../features/governance/ProviderRegistryScreen';
import { ReadinessScreen } from '../features/governance/ReadinessScreen';
import { GovernanceHubScreen } from '../features/governance/GovernanceHubScreen';
import { PhiGateScreen } from '../features/governance/PhiGateScreen';
import { ThreatModelScreen } from '../features/governance/ThreatModelScreen';
import { PolicyDraftsScreen } from '../features/governance/PolicyDraftsScreen';
import { SecurityPacketScreen } from '../features/governance/SecurityPacketScreen';
import { DataFlowScreen } from '../features/governance/DataFlowScreen';
import { BetaModeScreen } from '../features/beta/BetaModeScreen';
import { ReleaseScreen } from '../features/release/ReleaseScreen';
import { BetaBanner } from './components/BetaBanner';
import { useBetaStore } from '../state/betaStore';
import { AnalyzeTab, UpdateSummaryScreen } from '../features/intelligence/AnalyzeTab';
import { AssistantTab } from '../features/intelligence/AssistantTab';
import { FormulationTab } from '../features/intelligence/FormulationTab';
import { InterventionsTab } from '../features/intelligence/InterventionsTab';
import { SafetyTrustTab } from '../features/intelligence/SafetyTrustTab';
import { GuidesScreen } from '../features/guides/GuidesScreen';
import { KnowledgeScreen } from '../features/knowledge/KnowledgeScreen';
import { GlobalReviewScreen } from '../features/review/GlobalReviewScreen';
import { ReviewQueueTab } from '../features/review/ReviewQueueTab';
import { AppSettingsScreen } from '../features/settings/AppSettingsScreen';
import { ClientSettingsTab } from '../features/settings/ClientSettingsTab';
import { useAutoLock } from '../hooks/useAutoLock';
import { useAuthStore } from '../state/authStore';

export function App() {
  const status = useAuthStore((s) => s.status);
  const refresh = useAuthStore((s) => s.refresh);
  const loadBeta = useBetaStore((s) => s.load);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Load beta state once unlocked so the global banner reflects reality.
  useEffect(() => {
    if (status === 'unlocked') void loadBeta();
  }, [status, loadBeta]);

  useAutoLock();

  if (status === 'loading') {
    return (
      <div className="auth-shell">
        <p className="muted">Opening workspace…</p>
      </div>
    );
  }

  if (status === 'uninitialized') return <SetupScreen />;
  if (status === 'locked') return <LockScreen />;

  return (
    <>
      {/* Skip-navigation: first tab stop, visible on focus (a11y §18). */}
      <a className="skip-nav" href="#main-content">Skip to main content</a>
      <BetaBanner />
      <Routes>
      <Route path="/" element={<ChooseClientScreen />} />
      <Route path="/settings" element={<AppSettingsScreen />} />
      <Route path="/review" element={<GlobalReviewScreen />} />
      <Route path="/knowledge" element={<KnowledgeScreen />} />
      <Route path="/evaluation" element={<EvaluationScreen />} />
      <Route path="/evaluation/runs/:runId" element={<EvalRunScreen />} />
      <Route path="/evaluation/compare" element={<CompareScreen />} />
      <Route path="/audit" element={<AuditScreen />} />
      <Route path="/feedback" element={<FeedbackDashboard />} />
      <Route path="/providers" element={<ProviderRegistryScreen />} />
      <Route path="/readiness" element={<ReadinessScreen />} />
      <Route path="/governance" element={<GovernanceHubScreen />} />
      <Route path="/governance/phi-gate" element={<PhiGateScreen />} />
      <Route path="/governance/threats" element={<ThreatModelScreen />} />
      <Route path="/governance/policies" element={<PolicyDraftsScreen />} />
      <Route path="/governance/security-packet" element={<SecurityPacketScreen />} />
      <Route path="/governance/data-flow" element={<DataFlowScreen />} />
      <Route path="/release" element={<ReleaseScreen />} />
      <Route path="/beta" element={<BetaModeScreen />} />
      <Route path="/guides" element={<GuidesScreen />} />
      <Route path="/clients/:clientId" element={<ClientDashboardLayout />}>
        <Route index element={<OverviewTab />} />
        <Route path="add" element={<AddClinicalInputScreen />} />
        <Route path="inputs" element={<InputsListTab />} />
        <Route path="inputs/:inputId" element={<InputDetailScreen />} />
        <Route path="inputs/:inputId/extract" element={<ExtractionPreviewScreen />} />
        <Route path="profile" element={<StructuredProfileTab />} />
        <Route path="assessments" element={<AssessmentsTab />} />
        <Route path="hypotheses" element={<HypothesesTab />} />
        <Route path="evidence" element={<EvidenceTab />} />
        <Route path="dap" element={<DapNotesTab />} />
        <Route path="dap/:noteId" element={<DapNoteScreen />} />
        <Route path="plan" element={<PlanTab />} />
        <Route path="plan/:planId" element={<PlanScreen />} />
        <Route path="goals" element={<GoalsTab />} />
        <Route path="documents" element={<DocumentsTab />} />
        <Route path="formulation" element={<FormulationTab />} />
        <Route path="interventions" element={<InterventionsTab />} />
        <Route path="safety-trust" element={<SafetyTrustTab />} />
        <Route path="assistant" element={<AssistantTab />} />
        <Route path="analyze" element={<AnalyzeTab />} />
        <Route path="analyze/:summaryId" element={<UpdateSummaryScreen />} />
        <Route path="review" element={<ReviewQueueTab />} />
        <Route path="timeline" element={<TimelineTab />} />
        <Route path="settings" element={<ClientSettingsTab />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  );
}

export function Root() {
  return (
    <HashRouter>
      <App />
    </HashRouter>
  );
}
