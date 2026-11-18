import { applyActionCode, reload } from 'firebase/auth';
import { BadgeCheck, LoaderCircle, LockKeyhole, Mail, RotateCw, ShieldCheck, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import BrandLogo from '../components/BrandLogo';
import { useAuth } from '../context/AuthContext';
import { auth } from '../lib/firebaseApp';
import { getEmailVerificationCooldownSeconds, sendBharatSathiVerificationEmail } from '../services/emailVerification';

type VerificationState = 'checking' | 'pending' | 'success' | 'error';

export default function EmailVerification() {
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const mode = searchParams.get('mode');
  const actionCode = searchParams.get('oobCode');
  const [state, setState] = useState<VerificationState>((mode === 'verifyEmail' || mode === 'verifyAndChangeEmail') && actionCode ? 'checking' : 'pending');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [countdown, setCountdown] = useState(5);
  const [cooldownSeconds, setCooldownSeconds] = useState(0);

  useEffect(() => {
    const updateCooldown = () => setCooldownSeconds(getEmailVerificationCooldownSeconds(user));
    updateCooldown();
    const timer = window.setInterval(updateCooldown, 1000);
    return () => window.clearInterval(timer);
  }, [user?.uid]);

  useEffect(() => {
    let active = true;
    const verify = async () => {
      if ((mode === 'verifyEmail' || mode === 'verifyAndChangeEmail') && actionCode) {
        setState('checking');
        try {
          await applyActionCode(auth, actionCode);
        } catch (error) {
          console.error('Email verification action could not be completed:', error);
          if (mode === 'verifyEmail' && auth.currentUser) {
            try {
              await reload(auth.currentUser);
              if (active) setState(auth.currentUser.emailVerified ? 'success' : 'error');
            } catch (refreshError) {
              console.error('Unable to refresh the verified account:', refreshError);
              if (active) setState('error');
            }
          } else if (active) {
            setState('error');
          }
          return;
        }
        if (auth.currentUser) {
          try {
            await reload(auth.currentUser);
          } catch (error) {
            console.warn('Verification succeeded, but the signed-in user could not be refreshed:', error);
          }
        }
        if (active) setState('success');
        return;
      }

      if (mode === 'pending' && auth.currentUser) {
        try {
          await reload(auth.currentUser);
          if (active) setState(auth.currentUser.emailVerified ? 'success' : 'pending');
        } catch (error) {
          console.error('Email verification state could not be refreshed:', error);
          if (active) setMessage(t('We could not check your verification status. Please try again.'));
        }
      } else {
        setState(mode === 'error' || mode === 'verifyEmail' || mode === 'verifyAndChangeEmail' ? 'error' : 'pending');
      }
    };
    void verify();
    return () => { active = false; };
  }, [actionCode, mode, t]);

  useEffect(() => {
    if (state !== 'success') return;
    setCountdown(5);
    const countdownTimer = window.setInterval(() => {
      setCountdown((current) => Math.max(0, current - 1));
    }, 1000);
    const redirectTimer = window.setTimeout(
      () => navigate(auth.currentUser ? '/dashboard' : '/login', { replace: true }),
      5000,
    );
    return () => {
      window.clearInterval(countdownTimer);
      window.clearTimeout(redirectTimer);
    };
  }, [navigate, state]);

  const resendVerification = async () => {
    if (!user || !auth.currentUser) {
      setMessage(t('Sign in to resend your verification email.'));
      return;
    }
    if (user.emailVerified || auth.currentUser.emailVerified) {
      setState('success');
      return;
    }
    setBusy(true);
    setMessage('');
    try {
      await sendBharatSathiVerificationEmail(user);
      setState('pending');
      setCooldownSeconds(getEmailVerificationCooldownSeconds(user));
      setMessage(t('Check your inbox. We sent a new verification link to: {{email}}', { email: maskEmail(user.email) }));
    } catch (error) {
      console.error('Unable to resend verification email:', error);
      setMessage(getVerificationError(error));
      setCooldownSeconds(getEmailVerificationCooldownSeconds(user));
    } finally {
      setBusy(false);
    }
  };

  const tryAgain = () => {
    setMessage('');
    if (user && !user.emailVerified) {
      navigate('/verify?mode=pending', { replace: true });
    } else {
      navigate('/login', { replace: true });
    }
  };

  return (
    <main className="verification-page">
      <div className="verification-ribbon verification-ribbon-top" aria-hidden="true" />
      <div className="verification-ribbon verification-ribbon-bottom" aria-hidden="true" />
      <section className="verification-panel" aria-live="polite">
        <Link to="/" className="verification-brand" aria-label={t('BharatSathi AI home')}>
          <BrandLogo className="verification-brand-logo" />
          <span><strong>BharatSathi <em>AI</em></strong><small>{t('Your Personal AI Government Benefits Assistant')}</small></span>
        </Link>

        {state === 'checking' ? (
          <div className="verification-state">
            <span className="verification-state-icon verification-icon-checking"><LoaderCircle size={34} className="verification-spin" /></span>
            <h1>{t('Verifying your email…')}</h1>
            <p>{t('Please wait while Firebase securely checks your verification link.')}</p>
          </div>
        ) : state === 'success' ? (
          <div className="verification-state">
            <span className="verification-state-icon verification-icon-success"><BadgeCheck size={42} /></span>
            <h1>{t('Email Verified Successfully')} 🎉</h1>
            <p>{auth.currentUser
              ? t('Your email has been verified. Your BharatSathi AI account is now active. You can explore government schemes, check eligibility, prepare documents, and get step-by-step application guidance.')
              : t('Your email has been verified. Sign in to BharatSathi AI to continue to your account.')}</p>
            <button type="button" className="verification-primary-button" onClick={() => navigate(auth.currentUser ? '/dashboard' : '/login', { replace: true })}>
              {auth.currentUser ? t('Continue to BharatSathi AI') : t('Sign in to BharatSathi AI')} <span aria-hidden="true">→</span>
            </button>
            <p className="verification-redirect"><RotateCw size={14} />{auth.currentUser
              ? t('Redirecting to your dashboard in {{seconds}} seconds…', { seconds: countdown })
              : t('Redirecting to sign in in {{seconds}} seconds…', { seconds: countdown })}</p>
          </div>
        ) : state === 'error' ? (
          <div className="verification-state">
            <span className="verification-state-icon verification-icon-error"><X size={39} /></span>
            <h1>{t('Email Verification Failed')}</h1>
            <p>{t('The verification link is invalid or has expired.')}</p>
            {message && <p className="verification-inline-message" role="status">{message}</p>}
            {cooldownSeconds > 0 && <p className="verification-redirect">{t('You can request another verification email in {{seconds}} seconds.', { seconds: cooldownSeconds })}</p>}
            <div className="verification-actions">
              <button type="button" className="verification-primary-button" onClick={() => void resendVerification()} disabled={busy || cooldownSeconds > 0}>
                <Mail size={17} /> {busy
                  ? t('Sending…')
                  : cooldownSeconds > 0
                    ? t('Resend available in {{seconds}}s', { seconds: cooldownSeconds })
                    : t('Resend Verification Email')}
              </button>
              <button type="button" className="verification-outline-button" onClick={tryAgain}>
                <RotateCw size={16} /> {t('Try Again')}
              </button>
            </div>
          </div>
        ) : (
          <div className="verification-state">
            <span className="verification-state-icon verification-icon-pending"><Mail size={34} /></span>
            <h1>{t('Check your email')}</h1>
            <p>{t('We sent a verification link to {{email}}. Open it to activate your BharatSathi AI account.', { email: maskEmail(user?.email) })}</p>
            <div className="verification-security-note"><LockKeyhole size={17} /><span>{t('For your security, never share your verification link, password, or OTP with anyone.')}</span></div>
            {message && <p className="verification-inline-message" role="status">{message}</p>}
            {cooldownSeconds > 0 && <p className="verification-redirect">{t('You can request another verification email in {{seconds}} seconds.', { seconds: cooldownSeconds })}</p>}
            <button type="button" className="verification-primary-button" onClick={() => void resendVerification()} disabled={busy || cooldownSeconds > 0}>
              <Mail size={17} /> {busy
                ? t('Sending…')
                : cooldownSeconds > 0
                  ? t('Resend available in {{seconds}}s', { seconds: cooldownSeconds })
                  : t('Resend Verification Email')}
            </button>
            <button type="button" className="verification-text-button" onClick={tryAgain}>{t('Try Again')}</button>
          </div>
        )}

        <footer className="verification-footer">
          <span><ShieldCheck size={15} />{t('Secure verification powered by Firebase Authentication')}</span>
          <Link to="/login">{t('Return to sign in')}</Link>
        </footer>
        <div className="verification-skyline" aria-hidden="true"><i /><i /><i /><i /><b /></div>
      </section>
    </main>
  );
}

function maskEmail(email: string | null | undefined): string {
  if (!email) return '';
  const [localPart, domain] = email.split('@');
  if (!domain) return '***';
  return `${localPart.slice(0, 1)}***@${domain}`;
}

function getVerificationError(error: unknown) {
  if (typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string') {
    if (error.code === 'auth/too-many-requests') return 'Too many emails were requested. Please wait a while and try again.';
    if (error.code === 'auth/unauthorized-continue-uri') return 'This verification URL is not authorized in Firebase Authentication settings.';
  }
  if (error instanceof Error) return error.message;
  return 'Could not send the verification email. Please try again.';
}
