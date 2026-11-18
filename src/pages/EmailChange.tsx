import { AlertCircle, ArrowRight, CheckCircle2, LoaderCircle, Mail } from 'lucide-react';
import { reload } from 'firebase/auth';
import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { auth } from '../lib/firebaseApp';
import { confirmNewEmailChange, confirmOldEmailChange } from '../services/emailChange';
import BrandLogo from '../components/BrandLogo';

type ConfirmationState = 'processing' | 'old-confirmed' | 'completed' | 'error' | 'idle';

export default function EmailChange() {
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const stage = searchParams.get('stage');
  const token = new URLSearchParams(location.hash.replace(/^#/, '')).get('token') ?? '';
  const [state, setState] = useState<ConfirmationState>(token ? 'processing' : 'idle');
  const [message, setMessage] = useState('');
  const [updatedEmail, setUpdatedEmail] = useState('');
  const processedToken = useRef('');

  useEffect(() => {
    if (!token || processedToken.current === token) return;
    processedToken.current = token;
    let active = true;
    setState('processing');
    setMessage('');

    const confirm = async () => {
      try {
        if (stage === 'old') {
          await confirmOldEmailChange(token);
          if (active) {
            setState('old-confirmed');
            setMessage('Your current email is confirmed. A verification link has been sent to the new email address.');
          }
          return;
        }
        if (stage !== 'new') throw new Error('This email-change link is not recognized.');

        await confirmNewEmailChange(token);
        const currentUser = auth.currentUser;
        let sessionNeedsRefresh = false;
        if (currentUser) {
          try {
            await reload(currentUser);
            setUpdatedEmail(auth.currentUser?.email ?? '');
            await currentUser.getIdToken(true);
          } catch (refreshError) {
            console.error('Email change completed, but the local session needs to be refreshed:', refreshError);
            sessionNeedsRefresh = true;
          }
        }
        if (active) {
          setState('completed');
          setMessage(sessionNeedsRefresh
            ? 'Both email addresses were confirmed and your account email has been updated. Sign in again to refresh this device.'
            : 'Both email addresses were confirmed and your account email has been updated.');
        }
      } catch (error) {
        if (active) {
          setState('error');
          setMessage(error instanceof Error ? error.message : 'The email-change confirmation could not be completed.');
        }
      }
    };

    void confirm();
    return () => { active = false; };
  }, [stage, token]);

  const signedIn = Boolean(auth.currentUser);
  const heading = state === 'processing'
    ? 'Confirming your email change…'
    : state === 'old-confirmed'
      ? 'Current Email Confirmed'
      : state === 'completed'
        ? 'Email Address Updated'
        : state === 'error'
          ? 'Email Change Needs Attention'
          : 'Confirm Email Change';

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-10">
      <section className="mx-auto max-w-xl rounded-3xl border border-slate-200 bg-white p-7 shadow-soft sm:p-10">
        <div className="flex flex-col items-center gap-2 text-center"><BrandLogo className="h-10 w-10" /><h2 className="text-lg font-black text-slate-900">BharatSathi AI</h2><p className="text-sm font-semibold text-slate-500">Your Personal AI Government Benefits Assistant</p></div>
        <div className="mt-8 text-center">
          {state === 'processing' ? <LoaderCircle className="mx-auto animate-spin text-blue-700" size={48} />
            : state === 'error' ? <AlertCircle className="mx-auto text-rose-600" size={48} />
              : state === 'idle' ? <Mail className="mx-auto text-blue-700" size={48} />
                : <CheckCircle2 className="mx-auto text-emerald-700" size={48} />}
          <h1 className="mt-5 text-2xl font-black text-slate-900">{heading}</h1>
          <p className="mx-auto mt-3 max-w-lg text-sm leading-6 text-slate-600">{message || (state === 'idle'
            ? 'Use the secure link sent to the requested email address. Your account email changes only after both addresses are confirmed.'
            : '')}</p>
          {state === 'old-confirmed' && <ol className="mx-auto mt-6 grid max-w-md gap-3 text-left text-sm">
            <li className="flex items-center gap-2 text-emerald-800"><CheckCircle2 size={17} /> Current email confirmed</li>
            <li className="flex items-center gap-2 text-blue-800"><Mail size={17} /> Check your new email for its verification link</li>
            <li className="flex items-center gap-2 text-slate-500">Firebase account email remains unchanged until that link is confirmed</li>
          </ol>}
          {state === 'completed' && updatedEmail && <p className="mt-4 font-bold text-slate-800">{updatedEmail}</p>}
          {state === 'error' && <p className="mt-3 text-xs text-slate-500">If the link expired or was already used, sign in and request a new confirmation from your profile.</p>}
          <div className="mt-7 flex flex-wrap justify-center gap-3">
            {state === 'old-confirmed' && <Link to={signedIn ? '/profile' : '/login'} className="solid-green-button justify-center">
              Continue <ArrowRight size={15} />
            </Link>}
            {(state === 'completed' || state === 'idle' || state === 'error') && <Link to={signedIn ? '/profile' : '/login'} className="solid-green-button justify-center">
              {signedIn ? 'Continue to Profile' : 'Sign in'} <ArrowRight size={15} />
            </Link>}
          </div>
          <p className="mt-7 border-t border-slate-100 pt-4 text-xs text-slate-500">BharatSathi AI helps you prepare and manage your account. Firebase Authentication remains the source of truth for your email.</p>
        </div>
      </section>
    </main>
  );
}
