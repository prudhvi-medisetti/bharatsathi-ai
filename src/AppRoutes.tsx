import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import ProtectedRoute from './components/ProtectedRoute';
import { AuthProvider } from './context/AuthContext';
import './i18n';

const Assistant = lazy(() => import('./pages/Assistant'));
const Applications = lazy(() => import('./pages/Applications'));
const Dashboard = lazy(() => import('./pages/Dashboard'));
const DashboardSection = lazy(() => import('./pages/DashboardSection'));
const DashboardLayout = lazy(() => import('./layouts/DashboardLayout'));
const EmailChange = lazy(() => import('./pages/EmailChange'));
const EmailVerification = lazy(() => import('./pages/EmailVerification'));
const Eligibility = lazy(() => import('./pages/Eligibility'));
const Login = lazy(() => import('./pages/Login'));
const Register = lazy(() => import('./pages/Register'));
const SchemeDetail = lazy(() => import('./pages/SchemeDetail'));
const Schemes = lazy(() => import('./pages/Schemes'));
const VerificationPreview = lazy(() => import('./pages/VerificationPreview'));

export default function AppRoutes() {
  return (
    <AuthProvider>
      <Suspense fallback={<main className="auth-loading"><span className="loading-spinner" /><p>Loading BharatSathi…</p></main>}>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route path="/verify" element={<EmailVerification />} />
          <Route path="/email-change" element={<EmailChange />} />
          <Route path="/verification-preview" element={<VerificationPreview />} />
          <Route element={<ProtectedRoute />}>
            <Route element={<DashboardLayout />}>
              <Route path="/dashboard" element={<Dashboard />} />
              <Route path="/ai-assistant" element={<Assistant />} />
              <Route path="/assistant" element={<Assistant />} />
              <Route path="/schemes" element={<Schemes />} />
              <Route path="/schemes/:schemeId" element={<SchemeDetail />} />
              <Route path="/eligibility" element={<Eligibility />} />
              <Route path="/applications" element={<Applications />} />
              <Route path="/saved" element={<DashboardSection section="my-schemes" />} />
              <Route path="/my-schemes" element={<DashboardSection section="my-schemes" />} />
              <Route path="/documents" element={<DashboardSection section="documents" />} />
              <Route path="/notifications" element={<DashboardSection section="notifications" />} />
              <Route path="/profile" element={<DashboardSection section="profile" />} />
              <Route path="/settings" element={<DashboardSection section="settings" />} />
            </Route>
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </AuthProvider>
  );
}
