import {
  ArrowRight,
  BriefcaseBusiness,
  CalendarDays,
  Check,
  GraduationCap,
  IndianRupee,
  Landmark,
  LockKeyhole,
  Mail,
  MapPin,
  Phone,
  RotateCw,
  ShieldCheck,
  UserRound,
  UsersRound,
} from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { updateProfile, type User } from 'firebase/auth';
import LanguageSwitcher from '../components/LanguageSwitcher';
import BrandLogo from '../components/BrandLogo';
import {
  registrationProfileSchema,
  saveRegistrationProfile,
  type RegistrationProfileInput,
  UserProfilePersistenceError,
} from '../services/userProfile';
import { sendBharatSathiVerificationEmail } from '../services/emailVerification';
import {
  generateAccountRecoveryCode,
  getAccountRecoveryCodeStatus,
  registerAccountRecoveryCode,
} from '../services/emailChange';

type FormValues = {
  name: string;
  email: string;
  phone: string;
  password: string;
  dateOfBirth: string;
  gender: string;
  state: string;
  district: string;
  mandal: string;
  village: string;
  category: string;
  occupation: string;
  education: string;
  educationLevel: string;
  course: string;
  college: string;
  yearOfStudy: string;
  employmentStatus: string;
  userType: string;
  isFarmer: string;
  landDetails: string;
  ownsBusiness: string;
  businessType: string;
  familySize: string;
  disabilityStatus: string;
  annualIncome: string;
};

const blankValues: FormValues = {
  name: '',
  email: '',
  phone: '',
  password: '',
  dateOfBirth: '',
  gender: '',
  state: '',
  district: '',
  mandal: '',
  village: '',
  category: '',
  occupation: '',
  education: '',
  educationLevel: '',
  course: '',
  college: '',
  yearOfStudy: '',
  employmentStatus: '',
  userType: 'General Citizen',
  isFarmer: '',
  landDetails: '',
  ownsBusiness: '',
  businessType: '',
  familySize: '',
  disabilityStatus: '',
  annualIncome: '',
};

export default function Register() {
  const { t } = useTranslation();
  const {
    user,
    authLoading,
    profileLoading,
    profile,
    profileState,
    profileError,
    signInWithGoogle,
    createAccount,
    refreshProfile,
    signOut,
  } = useAuth();
  const navigate = useNavigate();
  const [values, setValues] = useState<FormValues>(blankValues);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [recoveryCode, setRecoveryCode] = useState('');
  const [recoveryCodeReady, setRecoveryCodeReady] = useState(false);
  const [recoveryCodeSaved, setRecoveryCodeSaved] = useState(false);
  const [recoveryCodeMessage, setRecoveryCodeMessage] = useState('');
  const [recoverySetupPending, setRecoverySetupPending] = useState(false);
  const [recoveryAccount, setRecoveryAccount] = useState<User | null>(null);

  useEffect(() => {
    setValues((current) => ({
      ...current,
      name: String(profile?.name ?? user?.displayName ?? current.name),
      email: String(profile?.email ?? user?.email ?? current.email),
      phone: String(profile?.phone ?? current.phone),
      dateOfBirth: String(profile?.dateOfBirth ?? current.dateOfBirth),
      gender: String(profile?.gender ?? current.gender),
      state: String(profile?.state ?? current.state),
      district: String(profile?.district ?? current.district),
      mandal: String(profile?.mandal ?? current.mandal),
      village: String(profile?.village ?? current.village),
      category: String(profile?.category ?? current.category),
      occupation: String(profile?.occupation ?? current.occupation),
      education: String(profile?.education ?? current.education),
      educationLevel: String(profile?.educationLevel ?? current.educationLevel),
      course: String(profile?.course ?? current.course),
      college: String(profile?.college ?? current.college),
      yearOfStudy: String(profile?.yearOfStudy ?? current.yearOfStudy),
      employmentStatus: String(profile?.employmentStatus ?? current.employmentStatus),
      userType: String(profile?.userType ?? inferUserType(profile?.occupation, profile?.employmentStatus) ?? current.userType),
      isFarmer: profile?.isFarmer === true ? 'true' : profile?.isFarmer === false ? 'false' : current.isFarmer,
      landDetails: String(profile?.landDetails ?? current.landDetails),
      ownsBusiness: profile?.ownsBusiness === true ? 'true' : profile?.ownsBusiness === false ? 'false' : current.ownsBusiness,
      businessType: String(profile?.businessType ?? current.businessType),
      familySize: String(profile?.familySize ?? current.familySize),
      disabilityStatus: String(profile?.disabilityStatus ?? current.disabilityStatus),
      annualIncome: String(profile?.annualIncome ?? current.annualIncome),
    }));
  }, [profile, user]);

  if (authLoading || (profileLoading && profileState !== 'error')) {
    return <main className="auth-loading"><span className="loading-spinner" /><p>{t('Checking your account and profile…')}</p></main>;
  }
  if (user && profileState === 'complete' && !recoverySetupPending && !recoveryCodeReady) {
    return <Navigate to={user.emailVerified ? '/dashboard' : '/verify?mode=pending'} replace />;
  }

  const update = (field: keyof FormValues, value: string) => {
    setValues((current) => ({ ...current, [field]: value }));
  };

  const continueRegistration = async (account: User) => {
    setBusy(true);
    setMessage('');
    try {
      if (!account.emailVerified) {
        await sendBharatSathiVerificationEmail(account);
        setRecoverySetupPending(false);
        navigate('/verify?mode=pending', { replace: true });
        return;
      }
      const verified = await refreshProfile();
      if (!verified) throw new Error('The saved profile could not be verified.');
      setRecoverySetupPending(false);
      navigate('/dashboard', { replace: true });
    } catch (error) {
      console.error('[PROFILE] Registration continuation failed:', error);
      setMessage(error instanceof Error ? error.message : 'We could not continue registration. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const saveRecoveryCode = async () => {
    if (!recoveryCodeSaved || !recoveryAccount) return;
    const account = recoveryAccount;
    setRecoveryCode('');
    setRecoveryCodeReady(false);
    setRecoveryCodeSaved(false);
    setRecoveryCodeMessage('');
    await continueRegistration(account);
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setMessage('');
    setBusy(true);
    let accountCreated = false;
    let recoverySetupRequired = false;
    try {
      const { password: _password, ...formProfile } = values;
      const {
        isFarmer,
        ownsBusiness,
        ...profileFields
      } = formProfile;
      const profileInput = {
        ...profileFields,
        occupation: formProfile.userType,
        ...(formProfile.userType === 'Farmer' ? { isFarmer: true } : isFarmer ? { isFarmer: false } : {}),
        ...(formProfile.userType === 'Business Owner' ? { ownsBusiness: true } : ownsBusiness ? { ownsBusiness: false } : {}),
      };
      const parsed = registrationProfileSchema.safeParse(profileInput satisfies RegistrationProfileInput);
      if (!parsed.success) {
        setMessage(parsed.error.issues[0]?.message ?? 'Review the required information and try again.');
        return;
      }

      let account = user;
      if (!account) {
        account = await createAccount(parsed.data.email, values.password);
        accountCreated = true;
      }
      setRecoverySetupPending(true);
      recoverySetupRequired = true;
      await saveRegistrationProfile(parsed.data);
      if (!account.displayName) await updateProfile(account, { displayName: parsed.data.name });

      setRecoveryAccount(account);
      const recoveryStatus = await getAccountRecoveryCodeStatus();
      if (recoveryStatus.state === 'not_issued' || recoveryStatus.state === 'expired' || recoveryCode) {
        const code = recoveryCode || generateAccountRecoveryCode();
        setRecoveryCode(code);
        const result = await registerAccountRecoveryCode(code);
        if (result.status === 'created' || result.status === 'already_issued') {
          setRecoveryCodeReady(true);
          setRecoveryCodeSaved(false);
          return;
        }
      }
      await continueRegistration(account);
    } catch (error) {
      if (error instanceof UserProfilePersistenceError) {
        console.error(`[PROFILE] Registration failed at ${error.stage}:`, error.cause ?? error);
      } else {
        console.error('[PROFILE] Registration save or verification failed:', error);
      }
      if (isFirebaseAuthError(error, 'auth/email-already-in-use')) {
        setMessage('An account already exists for this email. Sign in with it to complete your BharatSathi profile.');
      } else if (recoverySetupRequired) {
        setMessage(error instanceof Error ? error.message : 'Your profile is saved, but recovery-code setup could not finish. Please retry.');
      } else if (error instanceof UserProfilePersistenceError && error.stage === 'write') {
        setMessage(error.firebaseCode === 'permission-denied'
          ? 'Your account is signed in, but Firestore denied the profile write. Confirm the deployed users/{uid} rule allows the signed-in user and checks request.resource.data.uid == userId. If App Check is enforced, authorize the development debug token or use a valid site key.'
          : 'Your account is signed in, but the profile write failed. Check your connection, Firebase project configuration, Firestore availability, and App Check setup.');
      } else if (error instanceof UserProfilePersistenceError && error.stage === 'read-before-write') {
        setMessage(error.firebaseCode === 'permission-denied'
          ? 'Your account is signed in, but Firestore denied reading users/{uid}. Confirm the deployed rule allows reads when request.auth.uid == userId and check App Check authorization.'
          : 'Your account is signed in, but the existing profile could not be read. Check your connection, Firestore availability, and App Check setup.');
      } else if (error instanceof UserProfilePersistenceError && error.stage === 'read-after-write') {
        setMessage(error.firebaseCode === 'permission-denied'
          ? 'The profile write may have succeeded, but Firestore denied the read-back check. Confirm the deployed users/{uid} read rule and App Check authorization before retrying.'
          : 'The profile write may have succeeded, but we could not read it back. Check your connection, Firestore availability, and App Check setup before retrying.');
      } else if (error instanceof UserProfilePersistenceError && error.stage === 'verification') {
        setMessage(error.message);
      } else if (error instanceof UserProfilePersistenceError && error.stage === 'validation') {
        setMessage(error.message);
      } else if (accountCreated) {
        setMessage("Your account was created, but we couldn't save your BharatSathi profile. Please try again.");
      } else if (!user) {
        setMessage('Registration could not be completed. Check your information and connection, then try again.');
      } else {
        setMessage('We could not save or verify your BharatSathi profile. Please check your connection and try again.');
      }
    } finally {
      setBusy(false);
    }
  };

  const continueWithGoogle = async () => {
    setBusy(true);
    setMessage('');
    try {
      await signInWithGoogle();
    } catch (error) {
      console.error('Google sign-in for registration could not be completed:', error);
      setMessage('Google sign-in could not be completed. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const switchAccount = async () => {
    try {
      await signOut();
      navigate('/login', { replace: true });
    } catch (error) {
      console.error('Unable to sign out while switching accounts:', error);
      setMessage('Could not sign out. Please try again.');
    }
  };

  return (
    <main className="citizen-onboarding">
      <div className="onboarding-language-control"><LanguageSwitcher className="dashboard-language" /></div>
      <div className="onboarding-shell">
        <section className="onboarding-intro" aria-labelledby="onboarding-title">
          <Link to="/" className="onboarding-brand" aria-label={t('BharatSathi AI home')}>
            <BrandLogo className="onboarding-brand-mark" />
            <span><strong>BharatSathi <em>AI</em></strong><small>{t('Your Government Benefits Companion')}</small></span>
          </Link>
          <div className="onboarding-intro-copy">
            <span className="onboarding-scheme-badge"><i /> {t('AP + Central Government Schemes')}</span>
            <h1 id="onboarding-title">{t('Complete your citizen profile')}</h1>
            <p>{t('One secure profile helps us connect you with relevant government schemes and guidance—without asking for the same details again.')}</p>
            <div className="onboarding-illustration" aria-hidden="true">
              <div className="illustration-orbit illustration-orbit-one" />
              <div className="illustration-orbit illustration-orbit-two" />
              <span className="illustration-dot illustration-dot-one" />
              <span className="illustration-dot illustration-dot-two" />
              <div className="illustration-service-card">
                <span className="illustration-service-icon"><Landmark size={23} /></span>
                <span><strong>{t('Benefits, made personal')}</strong><small>{t('One profile. Clearer next steps.')}</small></span>
                <Check size={17} className="illustration-check" />
              </div>
              <div className="illustration-person illustration-person-one"><UserRound size={26} /></div>
              <div className="illustration-person illustration-person-two"><UsersRound size={21} /></div>
              <span className="illustration-leaf illustration-leaf-one" />
              <span className="illustration-leaf illustration-leaf-two" />
            </div>
          </div>
          <ul className="onboarding-trust-list">
            <li><span><ShieldCheck size={15} /></span>{t('Secure & private')}</li>
            <li><span><Check size={15} /></span>{t('One-time registration')}</li>
            <li><span><UsersRound size={15} /></span>{t('Personalized recommendations')}</li>
          </ul>
        </section>

        <section className="onboarding-card" aria-labelledby="registration-title">
          <header className="onboarding-card-header">
            <div className="onboarding-step-row"><span>{t('STEP 1 OF 1')}</span><span>{t('Profile setup')}</span></div>
            <div className="onboarding-progress" role="progressbar" aria-label="Registration progress" aria-valuemin={0} aria-valuemax={1} aria-valuenow={1}><span /></div>
            <h2 id="registration-title">{t('Complete your registration')}</h2>
            <p>{user ? t('Your account is authenticated. Complete your citizen profile to continue.') : t('Create your secure account and tell us a little about yourself.')}</p>
          </header>

          {profileError && <div className="onboarding-alert" role="alert">
            <span className="onboarding-alert-icon" aria-hidden="true">!</span>
            <span><strong>{t('Profile verification failed')}</strong><small>{t(profileError ?? '')}</small></span>
          </div>}
          {user && profileState === 'error' && <button
            type="button"
            className="onboarding-retry"
            onClick={() => void refreshProfile().catch(() => undefined)}
            disabled={profileLoading}
          >
            <RotateCw size={15} className={profileLoading ? 'onboarding-spin' : ''} />
            {profileLoading ? t('Checking your profile…') : t('Retry profile check')}
          </button>}

          {!user && <div className="onboarding-auth-options">
            <button type="button" className="onboarding-google-button" onClick={() => void continueWithGoogle()} disabled={busy}>
              <span className="google-g" aria-hidden="true">G</span>
              <span>{t('Continue with Google')}</span>
            </button>
            <div className="onboarding-divider"><span />{t('or register with email')}<span /></div>
          </div>}

          {recoveryCodeReady ? <div className="onboarding-form" role="region" aria-labelledby="recovery-code-title">
            <div className="onboarding-alert" role="note">
              <span className="onboarding-alert-icon" aria-hidden="true"><ShieldCheck size={17} /></span>
              <span><strong id="recovery-code-title">{t('Save your account recovery code')}</strong><small>{t('Use this one-time code only if you permanently lose access to your current email. It will be shown only once. Keep it somewhere private and never share it.')}</small></span>
            </div>
            <code className="block break-all rounded-xl border border-slate-200 bg-slate-50 p-4 text-center text-lg font-bold tracking-wider text-slate-900">{recoveryCode}</code>
            <button type="button" className="onboarding-google-button" onClick={() => {
              void (async () => {
                try {
                  await navigator.clipboard.writeText(recoveryCode);
                  setRecoveryCodeMessage(t('Recovery code copied. Store it somewhere private.'));
                } catch {
                  setRecoveryCodeMessage(t('Copy failed. Select and copy the recovery code manually.'));
                }
              })();
            }}>
              {t('Copy recovery code')}
            </button>
            {recoveryCodeMessage && <p className="form-status" role="status">{recoveryCodeMessage}</p>}
            <label className="onboarding-security">
              <input type="checkbox" checked={recoveryCodeSaved} onChange={(event) => setRecoveryCodeSaved(event.target.checked)} />
              {t('I have saved this recovery code somewhere secure.')}
            </label>
            <button type="button" className="onboarding-submit" onClick={() => void saveRecoveryCode()} disabled={busy || !recoveryCodeSaved}>
              <span>{busy ? t('Continuing…') : t('Continue')}</span>
              {busy ? <span className="onboarding-spinner" aria-hidden="true" /> : <ArrowRight size={18} />}
            </button>
          </div> : <form onSubmit={(event) => void submit(event)} className="onboarding-form">
            <div className="onboarding-fields">
              <FormField id="register-name" label="Full name" icon={<UserRound />} required placeholder="Enter your full name" autoComplete="name" value={values.name} onChange={(value) => update('name', value)} minLength={2} maxLength={100} />
              <FormField id="register-email" label="Email address" icon={<Mail />} required placeholder="you@example.com" type="email" autoComplete="email" value={values.email} onChange={(value) => update('email', value)} readOnly={Boolean(user?.email)} />
              {!user && <FormField id="register-password" label="Password" icon={<LockKeyhole />} required placeholder="At least 6 characters" type="password" autoComplete="new-password" value={values.password} onChange={(value) => update('password', value)} minLength={6} />}
              <FormField id="register-phone" label="Phone number" optional icon={<Phone />} placeholder="Enter your phone number" type="tel" autoComplete="tel" inputMode="tel" value={values.phone} onChange={(value) => update('phone', value)} />
              <FormField id="register-dob" label="Date of birth" optional icon={<CalendarDays />} type="date" autoComplete="bday" value={values.dateOfBirth} onChange={(value) => update('dateOfBirth', value)} max={new Date().toISOString().slice(0, 10)} />
              <FormField id="register-user-type" label="What best describes you?" icon={<BriefcaseBusiness />} required as="select" value={values.userType} onChange={(value) => update('userType', value)}>
                <option value="General Citizen">{t('General citizen')}</option>
                <option value="Student">{t('Student')}</option>
                <option value="Farmer">{t('Farmer')}</option>
                <option value="Job Seeker">{t('Job seeker')}</option>
                <option value="Business Owner">{t('Business owner')}</option>
                <option value="Woman & Family">{t('Woman / family')}</option>
                <option value="Person with Disability">{t('Person with disability')}</option>
              </FormField>
              <FormField id="register-state" label="State" icon={<MapPin />} required placeholder="Select your state" autoComplete="address-level1" list="indian-states" value={values.state} onChange={(value) => update('state', value)} maxLength={80} />
              <FormField id="register-district" label="District" optional icon={<MapPin />} placeholder="Enter your district" autoComplete="address-level2" value={values.district} onChange={(value) => update('district', value)} maxLength={80} />
              <datalist id="indian-states">{['Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chhattisgarh', 'Goa', 'Gujarat', 'Haryana', 'Himachal Pradesh', 'Jharkhand', 'Karnataka', 'Kerala', 'Madhya Pradesh', 'Maharashtra', 'Manipur', 'Meghalaya', 'Mizoram', 'Nagaland', 'Odisha', 'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana', 'Tripura', 'Uttar Pradesh', 'Uttarakhand', 'West Bengal'].map((state) => <option key={state} value={state} />)}</datalist>
              {values.userType === 'Student' && <>
                <FormField id="register-education" label="Education level" optional icon={<GraduationCap />} placeholder="e.g. Undergraduate" value={values.educationLevel} onChange={(value) => update('educationLevel', value)} maxLength={120} />
                <FormField id="register-course" label="Course or field of study" optional placeholder="Your course or subject" value={values.course} onChange={(value) => update('course', value)} maxLength={120} />
                <FormField id="register-college" label="College or institution (optional)" optional placeholder="Your college or institution" value={values.college} onChange={(value) => update('college', value)} maxLength={160} />
                <FormField id="register-study-year" label="Year of study (optional)" optional placeholder="e.g. 2nd year" value={values.yearOfStudy} onChange={(value) => update('yearOfStudy', value)} maxLength={40} />
                <FormField id="register-category" label="Community category (optional)" optional placeholder="Share if relevant to your scheme search" value={values.category} onChange={(value) => update('category', value)} maxLength={80} />
                <FormField id="register-income" label="Annual household income (₹)" optional icon={<IndianRupee />} placeholder="Enter approximate amount" type="number" inputMode="decimal" min="0" max="1000000000" step="1" value={values.annualIncome} onChange={(value) => update('annualIncome', value)} />
              </>}
              {values.userType === 'Farmer' && <>
                <FormField id="register-land-details" label="Land or farming details (optional)" optional placeholder="Share relevant farming details" value={values.landDetails} onChange={(value) => update('landDetails', value)} maxLength={500} />
                <FormField id="register-income" label="Annual household income (₹)" optional icon={<IndianRupee />} placeholder="Enter approximate amount" type="number" inputMode="decimal" min="0" max="1000000000" step="1" value={values.annualIncome} onChange={(value) => update('annualIncome', value)} />
              </>}
              {values.userType === 'Job Seeker' && <>
                <FormField id="register-education" label="Education level" optional icon={<GraduationCap />} placeholder="Your highest education" value={values.educationLevel} onChange={(value) => update('educationLevel', value)} maxLength={120} />
                <FormField id="register-employment" label="Employment status" optional placeholder="e.g. Looking for work" value={values.employmentStatus} onChange={(value) => update('employmentStatus', value)} maxLength={80} />
                <FormField id="register-category" label="Community category (optional)" optional placeholder="Share if relevant to your scheme search" value={values.category} onChange={(value) => update('category', value)} maxLength={80} />
              </>}
              {values.userType === 'Business Owner' && <>
                <FormField id="register-business-type" label="Business type (optional)" optional placeholder="Type of business" value={values.businessType} onChange={(value) => update('businessType', value)} maxLength={120} />
                <FormField id="register-income" label="Annual household income (₹)" optional icon={<IndianRupee />} placeholder="Enter approximate amount" type="number" inputMode="decimal" min="0" max="1000000000" step="1" value={values.annualIncome} onChange={(value) => update('annualIncome', value)} />
              </>}
              {values.userType === 'Woman & Family' && <>
                <FormField id="register-gender" label="Gender" optional icon={<UsersRound />} as="select" value={values.gender} onChange={(value) => update('gender', value)}>
                  <option value="">{t('Prefer not to say')}</option><option value="Female">{t('Female')}</option><option value="Other">{t('Other')}</option>
                </FormField>
                <FormField id="register-family-size" label="Family size" optional placeholder="Number of family members" type="number" min="1" max="50" value={values.familySize} onChange={(value) => update('familySize', value)} />
                <FormField id="register-income" label="Annual household income (₹)" optional icon={<IndianRupee />} placeholder="Enter approximate amount" type="number" inputMode="decimal" min="0" max="1000000000" step="1" value={values.annualIncome} onChange={(value) => update('annualIncome', value)} />
              </>}
              {values.userType === 'Person with Disability' && <>
                <FormField id="register-disability" label="Disability status (optional)" optional placeholder="Share only if relevant" value={values.disabilityStatus} onChange={(value) => update('disabilityStatus', value)} maxLength={80} />
                <FormField id="register-education" label="Education level" optional icon={<GraduationCap />} placeholder="Your highest education" value={values.educationLevel} onChange={(value) => update('educationLevel', value)} maxLength={120} />
                <FormField id="register-category" label="Community category (optional)" optional placeholder="Share if relevant to your scheme search" value={values.category} onChange={(value) => update('category', value)} maxLength={80} />
                <FormField id="register-income" label="Annual household income (₹)" optional icon={<IndianRupee />} placeholder="Enter approximate amount" type="number" inputMode="decimal" min="0" max="1000000000" step="1" value={values.annualIncome} onChange={(value) => update('annualIncome', value)} />
              </>}
              {(values.userType === 'General Citizen' || values.userType === 'Job Seeker') && <FormField id="register-income" label="Annual household income (₹)" optional icon={<IndianRupee />} placeholder="Enter approximate amount" type="number" inputMode="decimal" min="0" max="1000000000" step="1" value={values.annualIncome} onChange={(value) => update('annualIncome', value)} />}
            </div>

            {message && <div className="onboarding-alert onboarding-alert-message" role="alert">
              <span className="onboarding-alert-icon" aria-hidden="true">!</span>
              <span><strong>{t('We couldn’t complete registration')}</strong><small>{t(message)}</small></span>
            </div>}
            <button type="submit" className="onboarding-submit" disabled={busy}>
              <span>{busy ? t('Creating your profile...') : t('Complete registration')}</span>
              {busy ? <span className="onboarding-spinner" aria-hidden="true" /> : <ArrowRight size={18} />}
            </button>
            <p className="onboarding-security"><LockKeyhole size={14} />{t('Your information is securely protected and used only to personalize your government-benefit experience.')}</p>
          </form>}

          {!recoveryCodeReady && <footer className="onboarding-card-footer">
            {user
              ? <button type="button" onClick={() => void switchAccount()}>{t('Sign out and use another account')}</button>
              : <>{t('Already registered?')} <Link to="/login">{t('Sign In')}</Link></>}
          </footer>}
        </section>
      </div>
    </main>
  );
}

type FormFieldProps = {
  id: string;
  label: string;
  icon?: React.ReactNode;
  required?: boolean;
  optional?: boolean;
  placeholder?: string;
  type?: string;
  autoComplete?: string;
  inputMode?: 'none' | 'text' | 'tel' | 'url' | 'email' | 'numeric' | 'decimal' | 'search';
  value: string;
  onChange: (value: string) => void;
  readOnly?: boolean;
  list?: string;
  minLength?: number;
  maxLength?: number;
  min?: string;
  max?: string;
  step?: string;
  as?: 'input' | 'select';
  children?: React.ReactNode;
};

function FormField({
  id,
  label,
  icon,
  required,
  optional,
  placeholder,
  type = 'text',
  autoComplete,
  inputMode,
  value,
  onChange,
  readOnly,
  list,
  minLength,
  maxLength,
  min,
  max,
  step,
  as = 'input',
  children,
}: FormFieldProps) {
  const { t } = useTranslation();

  return (
    <div className="onboarding-field">
      <label htmlFor={id} className="onboarding-field-label">
        <span>{t(label)}{required && <i aria-hidden="true"> *</i>}</span>
        {optional && <small>{t('Optional')}</small>}
      </label>
      <span className={`onboarding-input-wrap ${icon ? 'onboarding-input-with-icon' : ''}`}>
        {icon && <span className="onboarding-input-icon" aria-hidden="true">{icon}</span>}
        {as === 'select'
          ? <select id={id} value={value} onChange={(event) => onChange(event.target.value)} aria-label={t(label)}>{children}</select>
          : <input
              id={id}
              type={type}
              autoComplete={autoComplete}
              inputMode={inputMode}
              value={value}
              onChange={(event) => onChange(event.target.value)}
              readOnly={readOnly}
              list={list}
              minLength={minLength}
              maxLength={maxLength}
              min={min}
              max={max}
              step={step}
              placeholder={placeholder ? t(placeholder) : undefined}
              required={required}
              aria-required={required || undefined}
            />}
        {as === 'select' && <span className="onboarding-select-chevron" aria-hidden="true">⌄</span>}
      </span>
    </div>
  );
}

function isFirebaseAuthError(error: unknown, code: string) {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code;
}

function inferUserType(occupation?: unknown, employmentStatus?: unknown) {
  const identity = `${String(occupation ?? '')} ${String(employmentStatus ?? '')}`.toLocaleLowerCase();
  if (/\bstudent\b/.test(identity)) return 'Student';
  if (/\bfarmer\b/.test(identity)) return 'Farmer';
  if (/job.?seek|unemploy/.test(identity)) return 'Job Seeker';
  if (/business owner|entrepreneur/.test(identity)) return 'Business Owner';
  return undefined;
}
