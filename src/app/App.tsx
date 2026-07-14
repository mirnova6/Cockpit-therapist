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
import { EvidenceTab } from '../features/evidence/EvidenceTab';
import { ExtractionPreviewScreen } from '../features/extraction/ExtractionPreviewScreen';
import { HypothesesTab } from '../features/hypotheses/HypothesesTab';
import { StructuredProfileTab } from '../features/profile/StructuredProfileTab';
import { GlobalReviewScreen } from '../features/review/GlobalReviewScreen';
import { ReviewQueueTab } from '../features/review/ReviewQueueTab';
import { AppSettingsScreen } from '../features/settings/AppSettingsScreen';
import { ClientSettingsTab } from '../features/settings/ClientSettingsTab';
import { useAutoLock } from '../hooks/useAutoLock';
import { useAuthStore } from '../state/authStore';

export function App() {
  const status = useAuthStore((s) => s.status);
  const refresh = useAuthStore((s) => s.refresh);

  useEffect(() => {
    void refresh();
  }, [refresh]);

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
    <Routes>
      <Route path="/" element={<ChooseClientScreen />} />
      <Route path="/settings" element={<AppSettingsScreen />} />
      <Route path="/review" element={<GlobalReviewScreen />} />
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
        <Route path="review" element={<ReviewQueueTab />} />
        <Route path="timeline" element={<TimelineTab />} />
        <Route path="settings" element={<ClientSettingsTab />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export function Root() {
  return (
    <HashRouter>
      <App />
    </HashRouter>
  );
}
