import { lazy, Suspense } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import './i18n';
const Home = lazy(() => import('./pages/Home'));
const AppRoutes = lazy(() => import('./AppRoutes'));

export default function App() {
  return (
    <BrowserRouter>
      <Suspense fallback={<LocalizedFallback />}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/*" element={<AppRoutes />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}

function LocalizedFallback() {
  const { t } = useTranslation();
  return <main className="auth-loading"><span className="loading-spinner" /><p>{t('Loading BharatSathi…')}</p></main>;
}
