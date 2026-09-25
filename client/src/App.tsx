import { useEffect, useMemo, useState } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './auth/AuthContext';
import { ThemeContext } from './components/charts';
import { Layout, RequirePermission } from './components/Layout';
import { Spinner } from './components/ui';
import { PeriodContext, useBootstrap } from './lib/hooks';
import { LoginPage } from './pages/LoginPage';
import { ChangePasswordPage, ProfilePage } from './pages/ProfilePage';
import { DashboardPage } from './pages/DashboardPage';
import { PerformancePage } from './pages/PerformancePage';
import { TrendsPage } from './pages/TrendsPage';
import { LearnersPage } from './pages/LearnersPage';
import { LearnerProfilePage } from './pages/LearnerProfilePage';
import { ClassesPage, ClassDetailPage } from './pages/ClassesPage';
import { AssessmentsPage } from './pages/AssessmentsPage';
import { AssessmentDetailPage } from './pages/AssessmentDetailPage';
import { GapsPage } from './pages/GapsPage';
import { InterventionsPage } from './pages/InterventionsPage';
import { InterventionDetailPage } from './pages/InterventionDetailPage';
import { ReassessmentPage } from './pages/ReassessmentPage';
import { ReportsPage } from './pages/ReportsPage';
import { UsersPage } from './pages/admin/UsersPage';
import { OrganizationPage } from './pages/admin/OrganizationPage';
import { CurriculumPage } from './pages/admin/CurriculumPage';
import { AssessmentConfigPage } from './pages/admin/AssessmentConfigPage';
import { SettingsPage } from './pages/admin/SettingsPage';
import { AuditPage, BreachesPage, RetentionPage } from './pages/admin/GovernancePages';

const readStore = (k: string) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const writeStore = (k: string, v: string | null) => {
  try {
    if (v === null) localStorage.removeItem(k);
    else localStorage.setItem(k, v);
  } catch {
    /* storage unavailable */
  }
};

export function App() {
  const [theme, setTheme] = useState<'light' | 'dark'>(() => (readStore('eq-theme') as 'light' | 'dark') ?? (window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);
  const themeValue = useMemo(() => ({ theme, toggle: () => setTheme((t) => { const n = t === 'dark' ? 'light' : 'dark'; writeStore('eq-theme', n); return n; }) }), [theme]);
  const { user, loading } = useAuth();

  return (
    <ThemeContext.Provider value={themeValue}>
      {loading ? (
        <div className="flex min-h-screen items-center justify-center"><Spinner label="Starting E-QuAART…" /></div>
      ) : !user ? (
        <Routes>
          <Route path="*" element={<LoginPage />} />
        </Routes>
      ) : user.mustChangePassword ? (
        <ChangePasswordPage forced />
      ) : (
        <PeriodProvider>
          <Routes>
            <Route element={<Layout />}>
              <Route index element={<DashboardPage />} />
              <Route path="performance/:view" element={<RequirePermission perm="analytics:read"><PerformancePage /></RequirePermission>} />
              <Route path="trends" element={<RequirePermission perm="analytics:read"><TrendsPage /></RequirePermission>} />
              <Route path="learners" element={<RequirePermission perm="learner:read"><LearnersPage /></RequirePermission>} />
              <Route path="learners/:id" element={<RequirePermission perm="learner:read"><LearnerProfilePage /></RequirePermission>} />
              <Route path="classes" element={<RequirePermission perm="analytics:read"><ClassesPage /></RequirePermission>} />
              <Route path="classes/:id" element={<RequirePermission perm="analytics:read"><ClassDetailPage /></RequirePermission>} />
              <Route path="assessments" element={<RequirePermission perm="assessment:read"><AssessmentsPage /></RequirePermission>} />
              <Route path="assessments/:id" element={<RequirePermission perm="assessment:read"><AssessmentDetailPage /></RequirePermission>} />
              <Route path="gaps" element={<RequirePermission perm="gap:read"><GapsPage /></RequirePermission>} />
              <Route path="interventions" element={<RequirePermission perm="intervention:read"><InterventionsPage /></RequirePermission>} />
              <Route path="interventions/:id" element={<RequirePermission perm="intervention:read"><InterventionDetailPage /></RequirePermission>} />
              <Route path="reassessment" element={<RequirePermission perm="intervention:read"><ReassessmentPage /></RequirePermission>} />
              <Route path="reports" element={<RequirePermission perm="report:export"><ReportsPage /></RequirePermission>} />
              <Route path="profile" element={<ProfilePage />} />
              <Route path="admin/users" element={<RequirePermission perm="user:manage"><UsersPage /></RequirePermission>} />
              <Route path="admin/organization" element={<RequirePermission perm="reference:write"><OrganizationPage /></RequirePermission>} />
              <Route path="admin/curriculum" element={<RequirePermission perm="reference:write"><CurriculumPage /></RequirePermission>} />
              <Route path="admin/assessment-config" element={<RequirePermission perm="reference:write"><AssessmentConfigPage /></RequirePermission>} />
              <Route path="admin/settings" element={<RequirePermission perm="settings:write"><SettingsPage /></RequirePermission>} />
              <Route path="governance/audit" element={<RequirePermission perm="audit:read"><AuditPage /></RequirePermission>} />
              <Route path="governance/retention" element={<RequirePermission perm="governance:manage"><RetentionPage /></RequirePermission>} />
              <Route path="governance/breaches" element={<RequirePermission perm="governance:manage"><BreachesPage /></RequirePermission>} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          </Routes>
        </PeriodProvider>
      )}
    </ThemeContext.Provider>
  );
}

/** Defaults the period to the current school year; the choice is remembered per browser. */
function PeriodProvider({ children }: { children: React.ReactNode }) {
  const { data } = useBootstrap();
  const [schoolYearId, setSY] = useState<number | undefined>(() => Number(readStore('eq-sy')) || undefined);
  const [termId, setTerm] = useState<number | undefined>(() => Number(readStore('eq-term')) || undefined);
  useEffect(() => {
    if (!data) return;
    if (!schoolYearId || !data.schoolYears.some((s) => s.id === schoolYearId)) setSY(data.schoolYears.find((s) => s.isCurrent)?.id);
  }, [data, schoolYearId]);
  const value = useMemo(() => ({
    schoolYearId,
    termId,
    setSchoolYearId: (id?: number) => { setSY(id); writeStore('eq-sy', id ? String(id) : null); },
    setTermId: (id?: number) => { setTerm(id); writeStore('eq-term', id ? String(id) : null); },
  }), [schoolYearId, termId]);
  if (!data) return <div className="flex min-h-screen items-center justify-center"><Spinner /></div>;
  return <PeriodContext.Provider value={value}>{children}</PeriodContext.Provider>;
}
