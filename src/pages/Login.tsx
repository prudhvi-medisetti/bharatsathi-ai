import { sendPasswordResetEmail } from 'firebase/auth';
import { ArrowRight, Eye, EyeOff, Globe2, LockKeyhole, Mail, ShieldCheck, UsersRound } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../context/AuthContext';
import { auth } from '../lib/firebaseApp';
import LanguageSwitcher from '../components/LanguageSwitcher';
import BrandLogo from '../components/BrandLogo';

export default function Login() {
  const { t } = useTranslation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const { user, loading, authError, profileState, profileError, signInWithGoogle: authSignInWithGoogle, signInWithEmail } = useAuth();

  if (loading) return <main className="auth-loading"><span className="loading-spinner" /><p>{t('Restoring your secure session…')}</p></main>;
  if (user) {
    if (!user.emailVerified) return <Navigate to="/verify?mode=pending" replace />;
    if (profileState === 'error') return <main className="auth-loading" role="alert"><p>{t(profileError ?? '')}</p><Link to="/register">{t('Retry profile registration')}</Link></main>;
    if (profileState !== 'complete') return <Navigate to="/register" replace />;
    return <Navigate to={getReturnPath(location.state)} replace />;
  }

  const completeSignIn = () => {
    const signedInUser = auth.currentUser;
    navigate(signedInUser && !signedInUser.emailVerified ? '/verify?mode=pending' : getReturnPath(location.state), { replace: true });
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setMessage('');
    setBusy(true);
    try {
      await signInWithEmail(email, password);
      completeSignIn();
    } catch (error) {
      setMessage(getAuthError(error));
    } finally {
      setBusy(false);
    }
  };

  const signInWithGoogle = async () => {
    setMessage('');
    setBusy(true);
    try {
      await authSignInWithGoogle();
      completeSignIn();
    } catch (error) {
      setMessage(getAuthError(error));
    } finally {
      setBusy(false);
    }
  };

  const resetPassword = async () => {
    if (!email.trim()) {
      setMessage(t('Enter your email address first, then choose Forgot password.'));
      return;
    }
    setMessage('');
    setBusy(true);
    try {
      await sendPasswordResetEmail(auth, email);
      setMessage(t('Password reset email sent. Please check your inbox.'));
    } catch (error) {
      setMessage(error instanceof Error ? t(error.message) : t('Password reset could not be sent. Please try again.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="login-page">
      <div className="login-language-control"><LanguageSwitcher className="dashboard-language" /></div>
      <div className="login-backdrop-ribbon login-ribbon-top" aria-hidden="true" />
      <div className="login-backdrop-ribbon login-ribbon-bottom" aria-hidden="true" />
      <div className="login-layout">
        <section className="login-intro">
          <div className="login-brand">
            <BrandLogo className="login-logo" />
            <span><strong>BharatSathi <em>AI</em></strong><small>{t('Your Government Benefits Companion')}</small></span>
          </div>
          <div className="login-welcome">
            <span className="login-badge"><span className="tricolor-mark" /> {t('AP + Central Government Schemes')}</span>
            <h1>{t('Access Government Benefits,')} <span>{t('the Smart Way')}</span></h1>
            <p>{t('Access schemes, eligibility guidance and your saved benefits in one place.')}</p>
            <ul>
              <li><span><UsersRound size={17} /></span> {t('Built for citizens')}</li>
              <li><span><Globe2 size={17} /></span> {t('Telugu + English')}</li>
              <li><span><ShieldCheck size={17} /></span> {t('Source-linked guidance')}</li>
            </ul>
          </div>
          <img
            src="https://images.unsplash.com/photo-1517486808906-6ca8b3f04846?auto=format&fit=crop&w=1200&q=85"
            alt={t('A group of young people representing citizens across India')}
            className="login-citizens"
          />
          <div className="login-charminar" aria-hidden="true"><i /><i /><i /><b /></div>
        </section>

        <section className="login-card" aria-labelledby="login-title">
          <h2 id="login-title">{t('Welcome back')} 👋</h2>
          <p className="login-card-subtitle">{t('Sign in to BharatSathi AI')}</p>
          {authError && <p className="login-message" role="alert">{t(authError)}</p>}
          {profileError && <p className="login-message" role="alert">{t(profileError)}</p>}

          <button type="button" className="google-button" onClick={signInWithGoogle} disabled={busy}>
          <span className="google-g" aria-hidden="true">G</span> {t('Continue with Google')}
          </button>

          <div className="login-divider"><span />{t('OR')}<span /></div>

          <form onSubmit={submit} className="login-form">
          <label htmlFor="login-email"><Mail size={15} /> {t('Email address')}</label>
          <input id="login-email" type="email" autoComplete="email" placeholder={t('Enter your email')} value={email} onChange={(event) => setEmail(event.target.value)} required />
          <label htmlFor="login-password"><LockKeyhole size={15} /> {t('Password')}</label>
            <div className="password-field">
            <input id="login-password" type={showPassword ? 'text' : 'password'} autoComplete="current-password" placeholder={t('Enter your password')} value={password} onChange={(event) => setPassword(event.target.value)} minLength={6} required />
            <button type="button" className="password-toggle" aria-label={t(showPassword ? 'Hide password' : 'Show password')} onClick={() => setShowPassword((shown) => !shown)}>
                {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
              </button>
            </div>
            <button type="button" onClick={resetPassword} className="forgot-password" disabled={busy}>{t('Forgot password?')}</button>
            {message && <p className="login-message" role="status">{t(message)}</p>}
            <button type="submit" className="login-submit" disabled={busy}>{busy ? t('Please wait…') : t('Sign In')} <ArrowRight size={18} /></button>
          </form>

          <p className="login-switch">
            {t('Don’t have an account?')} <Link to="/register">{t('Create account')}</Link>
          </p>
          <p className="login-terms"><ShieldCheck size={19} /> <span>{t('By signing in, you agree to our')} <a href="/login">{t('Terms of Service')}</a> {t('and')} <a href="/login">{t('Privacy Policy')}</a>.</span></p>
        </section>
      </div>
    </main>
  );
}

function getReturnPath(state: unknown) {
  if (typeof state !== 'object' || state === null || !('from' in state)) return '/dashboard';
  const from = state.from;
  if (typeof from !== 'object' || from === null || !('pathname' in from) || typeof from.pathname !== 'string') return '/dashboard';
  const search = 'search' in from && typeof from.search === 'string' ? from.search : '';
  const hash = 'hash' in from && typeof from.hash === 'string' ? from.hash : '';
  return `${from.pathname}${search}${hash}`;
}

function getAuthError(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string') {
    switch (error.code) {
      case 'auth/invalid-credential':
      case 'auth/wrong-password':
      case 'auth/user-not-found':
        return 'The email or password is incorrect. Please check and try again.';
      case 'auth/email-already-in-use':
        return 'An account already exists for this email. Try signing in instead.';
      case 'auth/weak-password':
        return 'Choose a stronger password with at least 6 characters.';
      case 'auth/invalid-email':
        return 'Enter a valid email address.';
      case 'auth/popup-closed-by-user':
        return 'Google sign-in was closed before it finished.';
      case 'auth/unauthorized-domain':
        return 'This site is not authorized for sign-in. Contact the site administrator.';
      default:
        return 'Sign-in could not be completed. Check your details and connection, then try again.';
    }
  }
  return 'Sign-in could not be completed. Please try again.';
}
