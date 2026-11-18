import {
  createContext,
  useContext,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { User } from 'firebase/auth';
import {
  createAccountWithEmail,
  loginWithEmail,
  loginWithGoogle,
  logout,
  watchAuth,
} from '../services/auth';
import { auth } from '../lib/firebaseApp';
import type { UserProfile } from '../services/dashboard';
import type { ProfileCompletionState } from '../services/userProfile';

type AuthContextValue = {
  user: User | null;
  loading: boolean;
  authLoading: boolean;
  profileLoading: boolean;
  profile: UserProfile | null;
  profileState: ProfileCompletionState | 'checking' | 'error';
  profileError: string | null;
  authError: string | null;
  signInWithGoogle: () => Promise<User>;
  signInWithEmail: (email: string, password: string) => Promise<User>;
  createAccount: (email: string, password: string) => Promise<User>;
  refreshProfile: () => Promise<UserProfile | null>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [profileLoading, setProfileLoading] = useState(false);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [profileState, setProfileState] = useState<ProfileCompletionState | 'checking' | 'error'>('checking');
  const [profileError, setProfileError] = useState<string | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);

  useEffect(() => watchAuth(
    (nextUser) => {
      setAuthError(null);
      setUser(nextUser);
      setAuthLoading(false);
      setProfile(null);
      setProfileError(null);
      if (nextUser) {
        setProfileLoading(true);
        setProfileState('checking');
        if (import.meta.env.DEV) console.info(`[AUTH] User authenticated: ${nextUser.uid}`);
      } else {
        setProfileLoading(false);
        setProfileState('missing');
      }
    },
    (error) => {
      console.error('Firebase authentication state could not be restored:', error);
      setUser(null);
      setAuthError('Your sign-in state could not be verified. Refresh the page and try again.');
      setAuthLoading(false);
      setProfileLoading(false);
      setProfileState('missing');
    },
  ), []);

  useEffect(() => {
    if (!user?.uid) {
      setProfile(null);
      setProfileState('missing');
      setProfileLoading(false);
      return;
    }

    setProfileLoading(true);
    setProfileState('checking');
    let cancelled = false;
    let unsubscribe: (() => void) | undefined;
    const profilePath = `users/${user.uid}`;
    if (import.meta.env.DEV) {
      console.info('[PROFILE] Authenticated:', Boolean(auth.currentUser));
      console.info('[PROFILE] Authenticated UID:', auth.currentUser?.uid ?? 'none');
      console.info('[PROFILE] Reading user document:', profilePath);
    }
    void Promise.all([
      import('firebase/firestore'),
      import('../lib/firebase'),
      import('../services/userProfile'),
    ]).then(([firestore, firebase, userProfile]) => {
      if (cancelled) return;
      unsubscribe = firestore.onSnapshot(firestore.doc(firebase.db, 'users', user.uid), (snapshot) => {
        const nextProfile = snapshot.exists() ? snapshot.data() as UserProfile : null;
        const nextState = userProfile.getProfileCompletionState(nextProfile, user.uid);
        setProfile(nextProfile);
        setProfileState(nextState);
        setProfileError(null);
        setProfileLoading(false);
        if (import.meta.env.DEV) {
          console.info(nextProfile ? (nextState === 'complete' ? '[PROFILE] Profile found and complete' : '[PROFILE] Profile incomplete') : '[PROFILE] Profile not found');
        }
      }, (error) => {
        if (import.meta.env.DEV) console.error(`[PROFILE] Firestore read failed for ${profilePath}:`, error);
        setProfileError('We could not verify your BharatSathi profile. Check your connection and try again.');
        setProfileState('error');
        setProfileLoading(false);
      });
    }).catch((error: unknown) => {
      if (cancelled) return;
      console.error(`[PROFILE] Firestore could not be initialized for ${profilePath}:`, error);
      setProfileError('We could not verify your BharatSathi profile. Check your connection and try again.');
      setProfileState('error');
      setProfileLoading(false);
    });
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [user?.uid]);

  const signInWithGoogle = useCallback(async () => {
    const nextUser = await loginWithGoogle();
    setAuthError(null);
    return nextUser;
  }, []);
  const signInWithEmail = useCallback(async (email: string, password: string) => {
    const nextUser = await loginWithEmail(email, password);
    setAuthError(null);
    return nextUser;
  }, []);
  const createAccount = useCallback(async (email: string, password: string) => {
    const nextUser = await createAccountWithEmail(email, password);
    setAuthError(null);
    return nextUser;
  }, []);
  const refreshProfile = useCallback(async () => {
    setProfileLoading(true);
    setProfileError(null);
    try {
      const { getCurrentUserProfile, getProfileCompletionState } = await import('../services/userProfile');
      const nextProfile = await getCurrentUserProfile();
      setProfile(nextProfile);
      setProfileState(getProfileCompletionState(nextProfile, user?.uid));
      return nextProfile;
    } catch (error) {
      console.error('Unable to verify the saved BharatSathi profile:', error);
      setProfileError('We could not verify your saved profile. Please try again.');
      setProfileState('error');
      throw error;
    } finally {
      setProfileLoading(false);
    }
  }, [user?.uid]);
  const signOut = useCallback(async () => {
    await logout();
    setUser(null);
    setProfile(null);
    setProfileState('missing');
    setProfileLoading(false);
    setAuthError(null);
  }, []);

  const loading = authLoading || profileLoading;
  const value = useMemo<AuthContextValue>(() => ({
    user,
    loading,
    authLoading,
    profileLoading,
    profile,
    profileState,
    profileError,
    authError,
    signInWithGoogle,
    signInWithEmail,
    createAccount,
    refreshProfile,
    signOut,
  }), [user, loading, authLoading, profileLoading, profile, profileState, profileError, authError, signInWithGoogle, signInWithEmail, createAccount, refreshProfile, signOut]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used within AuthProvider');
  return value;
}
