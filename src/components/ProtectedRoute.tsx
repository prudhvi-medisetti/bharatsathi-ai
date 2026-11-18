import { ShieldCheck } from 'lucide-react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function ProtectedRoute() {
  const { user, loading, authError, profileState, profileError, refreshProfile } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <main className="auth-loading" aria-live="polite">
        <span className="loading-spinner" />
        <p>Restoring your secure session…</p>
      </main>
    );
  }

  if (authError) {
    return <main className="auth-loading" role="alert"><ShieldCheck size={26} /><p>{authError}</p><a href="/login">Go to sign in</a></main>;
  }

  if (!user) return <Navigate to="/login" replace state={{ from: location }} />;
  if (!user.emailVerified) return <Navigate to="/verify?mode=pending" replace state={{ from: location }} />;
  if (profileState === 'checking') {
    return <main className="auth-loading" aria-live="polite"><span className="loading-spinner" /><p>Checking your BharatSathi profile…</p></main>;
  }
  if (profileState === 'error') {
    return <main className="auth-loading" role="alert">
      <ShieldCheck size={26} />
      <p>{profileError ?? 'Your BharatSathi profile could not be verified.'}</p>
      <button type="button" className="solid-green-button" onClick={() => void refreshProfile().catch(() => undefined)}>Retry profile check</button>
    </main>;
  }
  if (profileState !== 'complete') return <Navigate to="/register" replace state={{ from: location }} />;
  return <Outlet />;
}
