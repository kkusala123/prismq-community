import React from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './lib/auth';
import { ThemeProvider } from './lib/theme';
import { Layout } from './components/Layout';
import { AuthPage } from './pages/AuthPage';
import { DashboardPage } from './pages/DashboardPage';
import { BanksPage } from './pages/BanksPage';
import { BankDetailPage } from './pages/BankDetailPage';
import { BankShareJoinPage } from './pages/BankShareJoinPage';
import { ImportPage } from './pages/ImportPage';
import { PracticePage } from './pages/PracticePage';
import { MistakesPage } from './pages/MistakesPage';
import { SearchPage } from './pages/SearchPage';
import { ExamsPage } from './pages/ExamsPage';
import { ExamTakePage } from './pages/ExamTakePage';
import { ExamReportPage } from './pages/ExamReportPage';
import { SettingsPage } from './pages/SettingsPage';
import { AdminPage } from './pages/AdminPage';

const AdminRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 text-sm text-slate-500">
        正在校验管理员权限...
      </div>
    );
  }
  if (!user) {
    return <Navigate to="/auth" replace />;
  }
  if (user.role !== 'admin') {
    return <Navigate to="/" replace />;
  }
  return <Layout>{children}</Layout>;
};

const ProtectedRoute: React.FC<{ children: React.ReactNode; withLayout?: boolean }> = ({
  children,
  withLayout = true,
}) => {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 text-sm text-slate-500">
        正在初始化棱题 · PrismQ...
      </div>
    );
  }
  if (!user) {
    const target = `${location.pathname}${location.search}`;
    const nextUrl =
      target && target !== '/' && !target.startsWith('/auth')
        ? `/auth?redirect=${encodeURIComponent(target)}`
        : '/auth';
    return <Navigate to={nextUrl} replace />;
  }
  return withLayout ? <Layout>{children}</Layout> : <>{children}</>;
};

const PublicOrAuthShell: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user } = useAuth();
  if (user) {
    return <Layout>{children}</Layout>;
  }
  return <>{children}</>;
};

export const App: React.FC = () => {
  return (
    <ThemeProvider>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/auth" element={<AuthPage />} />

            {/* 考生免登录也可以打开分享码考场和查看自己的交卷报告 */}
            <Route path="/exam/join/:shareCode" element={<ExamTakePage />} />
            <Route
              path="/exam/report/:submissionId"
              element={
                <PublicOrAuthShell>
                  <ExamReportPage />
                </PublicOrAuthShell>
              }
            />

            <Route
              path="/"
              element={
                <ProtectedRoute>
                  <DashboardPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/banks"
              element={
                <ProtectedRoute>
                  <BanksPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/banks/share/:code"
              element={
                <ProtectedRoute>
                  <BankShareJoinPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/banks/:id"
              element={
                <ProtectedRoute>
                  <BankDetailPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/import"
              element={
                <ProtectedRoute>
                  <ImportPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/practice/:bankId"
              element={
                <ProtectedRoute withLayout={false}>
                  <PracticePage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/mistakes"
              element={
                <ProtectedRoute>
                  <MistakesPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/search"
              element={
                <ProtectedRoute>
                  <SearchPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/exams"
              element={
                <ProtectedRoute>
                  <ExamsPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/exams/:examId/analytics"
              element={
                <ProtectedRoute>
                  <ExamReportPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/settings"
              element={
                <ProtectedRoute>
                  <SettingsPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/admin"
              element={
                <AdminRoute>
                  <AdminPage />
                </AdminRoute>
              }
            />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </ThemeProvider>
  );
};

export default App;
