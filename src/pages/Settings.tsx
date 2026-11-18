import {
  AlertTriangle,
  Bell,
  CheckCircle2,
  ChevronRight,
  CircleHelp,
  FileText,
  Globe2,
  Headphones,
  Languages,
  LockKeyhole,
  LogOut,
  Mic,
  Save,
  ShieldCheck,
  Trash2,
  UserRound,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { getDownloadURL, ref, uploadBytesResumable } from 'firebase/storage';
import { appLanguages, getInterfaceLanguage, getLanguageCode, interfaceLanguages } from '../data/languages';
import { useAuth } from '../context/AuthContext';
import { useDashboardData } from '../hooks/useDashboardData';
import { clearAssistantConversations } from '../services/preferences';
import { deleteCurrentAccountAndData } from '../services/account';
import { saveUserProfile } from '../services/dashboard';
import { sendBharatSathiVerificationEmail } from '../services/emailVerification';
import { calculateProfileCompletion, getProfileCompletionSections } from '../services/profile';
import { isFirestorePermissionError } from '../services/userProfile';
import { storage } from '../lib/firebase';
import i18n from '../i18n';

type PreferenceKey =
  | 'voiceAssistantEnabled'
  | 'voiceInputEnabled'
  | 'voiceResponsesEnabled'
  | 'autoDetectVoiceLanguage'
  | 'conversationHistoryEnabled'
  | 'schemeNotificationsEnabled'
  | 'eligibilityNotificationsEnabled'
  | 'applicationNotificationsEnabled'
  | 'applicationDecisionNotificationsEnabled'
  | 'documentNotificationsEnabled'
  | 'documentVerificationNotificationsEnabled'
  | 'documentReminderEnabled'
  | 'governmentAlertsEnabled'
  | 'assistantNotificationsEnabled'
  | 'aiPersonalizationEnabled';

const defaultPreferences: Record<PreferenceKey, boolean> = {
  voiceAssistantEnabled: true,
  voiceInputEnabled: true,
  voiceResponsesEnabled: true,
  autoDetectVoiceLanguage: true,
  conversationHistoryEnabled: true,
  schemeNotificationsEnabled: true,
  eligibilityNotificationsEnabled: true,
  applicationNotificationsEnabled: true,
  applicationDecisionNotificationsEnabled: true,
  documentNotificationsEnabled: true,
  documentVerificationNotificationsEnabled: true,
  documentReminderEnabled: true,
  governmentAlertsEnabled: true,
  assistantNotificationsEnabled: true,
  aiPersonalizationEnabled: true,
};

const notificationOptions: { key: PreferenceKey; title: string; detail: string }[] = [
  { key: 'schemeNotificationsEnabled', title: 'Scheme recommendations', detail: 'Updates about schemes that may fit your profile.' },
  { key: 'eligibilityNotificationsEnabled', title: 'Eligibility updates', detail: 'Changes to saved eligibility checks and requirements.' },
  { key: 'applicationNotificationsEnabled', title: 'Application updates', detail: 'Progress updates for applications you track.' },
  { key: 'applicationDecisionNotificationsEnabled', title: 'Approval and rejection updates', detail: 'Email alerts when a tracked application is marked approved or rejected.' },
  { key: 'documentNotificationsEnabled', title: 'Document updates', detail: 'Email alerts when your uploaded documents need attention.' },
  { key: 'documentVerificationNotificationsEnabled', title: 'Document verification updates', detail: 'Email alerts when document review status changes.' },
  { key: 'documentReminderEnabled', title: 'Document reminders', detail: 'Reminders about documents you marked as needed.' },
  { key: 'governmentAlertsEnabled', title: 'Government scheme alerts', detail: 'Important scheme information and deadline reminders.' },
  { key: 'assistantNotificationsEnabled', title: 'AI assistant notifications', detail: 'Helpful reminders related to your assistant activity.' },
];

export default function SettingsPage() {
  const { t } = useTranslation();
  const { user, signOut } = useAuth();
  const { data, profilePhotoOverride, setProfilePhotoOverride } = useDashboardData();
  const navigate = useNavigate();
  const profile = data?.profile;
  const preferredLanguage = getInterfaceLanguage(i18n.resolvedLanguage)
    ?? getInterfaceLanguage(profile?.preferredLanguage)
    ?? getInterfaceLanguage(profile?.language)
    ?? 'en';
  const [languageSearch, setLanguageSearch] = useState('');
  const [preferences, setPreferences] = useState(defaultPreferences);
  const [voiceLanguage, setVoiceLanguage] = useState('en');
  const [profileDraft, setProfileDraft] = useState({ name: '', phone: '' });
  const [editingProfile, setEditingProfile] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingPreference, setSavingPreference] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState('');
  const [statusIsError, setStatusIsError] = useState(false);
  const [deletingAccount, setDeletingAccount] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState('');
  const [accountDeleteOpen, setAccountDeleteOpen] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [photoUploadProgress, setPhotoUploadProgress] = useState(0);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const photoPreviewUrlRef = useRef<string | null>(null);

  useEffect(() => () => {
    if (photoPreviewUrlRef.current) URL.revokeObjectURL(photoPreviewUrlRef.current);
  }, []);

  useEffect(() => {
    setPreferences((current) => Object.keys(defaultPreferences).reduce((next, key) => {
      const preferenceKey = key as PreferenceKey;
      const savedValue = profile?.[preferenceKey];
      next[preferenceKey] = typeof savedValue === 'boolean' ? savedValue : current[preferenceKey];
      return next;
    }, { ...current }));
    setVoiceLanguage(getLanguageCode(profile?.voiceLanguage) ?? preferredLanguage);
    setProfileDraft({
      name: String(profile?.name ?? user?.displayName ?? ''),
      phone: String(profile?.phone ?? ''),
    });
  }, [preferredLanguage, profile, user]);

  const filteredLanguages = useMemo(() => {
    const search = languageSearch.trim().toLocaleLowerCase();
    return interfaceLanguages.filter((language) => (
      !search
      || language.name.toLocaleLowerCase().includes(search)
      || language.nativeName.toLocaleLowerCase().includes(search)
      || language.code.includes(search)
    ));
  }, [languageSearch]);

  const completion = calculateProfileCompletion(getProfileCompletionSections(
    profile,
    data?.documents ?? [],
    user?.displayName,
    user?.email,
  ));
  const accountVerified = Boolean(user?.emailVerified);
  const profilePhotoUrl = profilePhotoOverride ?? profile?.photoURL ?? user?.photoURL;

  const setStatus = (message: string, isError = false) => {
    setStatusMessage(message);
    setStatusIsError(isError);
  };

  const savePreference = async (key: PreferenceKey, value: boolean) => {
    if (!user || savingPreference) return;
    setSavingPreference(key);
    setStatusMessage('');
    try {
      await saveUserProfile({ [key]: value });
      setPreferences((current) => ({ ...current, [key]: value }));
      setStatus(t('Settings saved.'));
    } catch (error) {
      console.error(`Unable to save ${key} preference:`, error);
      setStatus(t('Could not save your preference. Please try again.'), true);
    } finally {
      setSavingPreference(null);
    }
  };

  const changeLanguage = async (code: string) => {
    if (!user || savingPreference) return;
    setSavingPreference('preferredLanguage');
    setStatusMessage('');
    try {
      await i18n.changeLanguage(code);
    } catch (error) {
      console.error('Unable to apply the selected language:', error);
      setStatus(t('Could not save your preference. Please try again.'), true);
      setSavingPreference(null);
      return;
    }

    let localPreferenceSaved = true;
    try {
      localStorage.setItem('bharatsathi-language', code);
    } catch (error) {
      localPreferenceSaved = false;
      console.warn('Unable to cache the selected language on this device:', error);
    }

    try {
      await saveUserProfile({ preferredLanguage: code });
      setStatus(t('Language preference saved.'));
    } catch (error) {
      console.error('Unable to persist language preference:', error);
      setStatus(localPreferenceSaved
        ? t(isFirestorePermissionError(error)
          ? 'Language saved on this device, but Firestore denied account sync. Check the deployed rules and App Check authorization.'
          : 'Language saved on this device, but account sync failed. Check your connection and try again.')
        : t('Could not save your preference. Please try again.'), true);
    } finally {
      setSavingPreference(null);
    }
  };

  const changeVoiceLanguage = async (code: string) => {
    if (!user || savingPreference) return;
    setSavingPreference('voiceLanguage');
    setStatusMessage('');
    try {
      await saveUserProfile({ voiceLanguage: code });
      setVoiceLanguage(code);
      setStatus(t('Settings saved.'));
    } catch (error) {
      console.error('Unable to save voice language preference:', error);
      setStatus(t('Could not save your preference. Please try again.'), true);
    } finally {
      setSavingPreference(null);
    }
  };

  const saveProfile = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!user) return;
    setSavingProfile(true);
    setStatusMessage('');
    try {
      await saveUserProfile({
        name: profileDraft.name.trim(),
        phone: profileDraft.phone.trim(),
        email: user.email ?? profile?.email ?? '',
      });
      setEditingProfile(false);
      setStatus(t('Your profile has been saved.'));
    } catch (error) {
      console.error('Unable to save account profile settings:', error);
      setStatus(t('Could not save your profile. Please try again.'), true);
    } finally {
      setSavingProfile(false);
    }
  };

  const uploadProfilePhoto = async (file?: File) => {
    if (!user || !file) return;
    if (!file.type.startsWith('image/')) {
      setStatus(t('Choose an image file to upload.'), true);
      return;
    }

    const previewUrl = URL.createObjectURL(file);
    photoPreviewUrlRef.current = previewUrl;
    setProfilePhotoOverride(previewUrl);
    setUploadingPhoto(true);
    setPhotoUploadProgress(0);
    setStatusMessage('');
    try {
      const photoRef = ref(storage, `users/${user.uid}/profile/avatar`);
      const task = uploadBytesResumable(photoRef, file, {
        contentType: file.type,
        customMetadata: { ownerUid: user.uid },
      });
      await new Promise<void>((resolve, reject) => {
        task.on('state_changed',
          (snapshot) => setPhotoUploadProgress(Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100)),
          reject,
          resolve,
        );
      });
      const photoURL = await getDownloadURL(task.snapshot.ref);
      await saveUserProfile({ photoURL });
      setProfilePhotoOverride(photoURL);
      setStatus(t('Profile photo updated.'));
    } catch (error) {
      setProfilePhotoOverride(null);
      console.error('Unable to upload account profile photo:', error);
      setStatus(t('Could not upload your profile photo. Please try again.'), true);
    } finally {
      if (photoPreviewUrlRef.current === previewUrl) {
        URL.revokeObjectURL(previewUrl);
        photoPreviewUrlRef.current = null;
      }
      setUploadingPhoto(false);
      setPhotoUploadProgress(0);
      if (photoInputRef.current) photoInputRef.current.value = '';
    }
  };

  const sendVerificationEmail = async () => {
    if (!user || accountVerified) return;
    try {
      await sendBharatSathiVerificationEmail(user);
      setStatus(t('Verification email sent to {{email}}. Check your inbox.', { email: maskEmailAddress(user.email) }));
    } catch (error) {
      console.error('Unable to send account verification email:', error);
      const errorCode = typeof error === 'object' && error !== null && 'code' in error
        && typeof error.code === 'string'
        ? error.code
        : null;
      const message = errorCode === 'auth/unauthorized-domain'
        ? 'Firebase rejected this website domain. Add the current hostname to Firebase Console > Authentication > Settings > Authorized domains.'
        : errorCode === 'auth/operation-not-allowed' || errorCode === 'auth/admin-restricted-operation'
          ? 'Firebase is not allowing email verification for this project. Check Authentication > Sign-in method and the project email verification settings.'
          : errorCode === 'auth/too-many-requests' || errorCode === 'auth/quota-exceeded'
            ? 'Firebase temporarily limited verification emails. Wait before trying again, and check the project email-sending quota.'
            : errorCode === 'auth/network-request-failed'
              ? 'The request could not reach Firebase. Check your internet connection, browser extensions, and network restrictions.'
              : errorCode === 'auth/user-token-expired' || errorCode === 'auth/invalid-user-token'
                ? 'Your sign-in has expired. Sign out, sign in again, and retry.'
                : errorCode
                  ? `Could not send the verification email (Firebase: ${errorCode}). Check the browser console for details.`
                  : error instanceof Error
                    ? error.message
                    : t('Could not send the verification email. Please try again.');
      setStatus(message, true);
    }
  };

  const manageHistory = async () => {
    if (!window.confirm(t('Clear all saved BharatSathi assistant conversations? This cannot be undone.'))) return;
    setSavingPreference('conversationHistory');
    setStatusMessage('');
    try {
      const count = await clearAssistantConversations();
      setStatus(t('Conversation history cleared. {{count}} conversation(s) removed.', { count }));
    } catch (error) {
      console.error('Unable to clear assistant conversation history:', error);
      setStatus(t('Could not clear conversation history. Please try again.'), true);
    } finally {
      setSavingPreference(null);
    }
  };

  const handleSignOut = async () => {
    try {
      await signOut();
      navigate('/login', { replace: true });
    } catch (error) {
      console.error('Unable to sign out:', error);
      setStatus(t('Sign out could not be completed. Please try again.'), true);
    }
  };

  const deleteAccount = async () => {
    if (deleteConfirmation !== 'DELETE') return;
    setDeletingAccount(true);
    setStatusMessage('');
    try {
      await deleteCurrentAccountAndData();
      navigate('/', { replace: true });
    } catch (error) {
      console.error('Account deletion could not be completed:', error);
      setStatus(error instanceof Error ? error.message : t('Account deletion could not be completed. Please try again.'), true);
    } finally {
      setDeletingAccount(false);
    }
  };

  return (
    <main className="settings-experience">
      <header className="settings-page-heading">
        <span className="settings-page-heading-icon"><ShieldCheck size={21} /></span>
        <div><p>{t('Your BharatSathi account')}</p><h1>{t('Settings')}</h1><span>{t('Manage language, privacy, notifications and your voice assistant.')}</span></div>
      </header>

      {statusMessage && <p className={`settings-status ${statusIsError ? 'settings-status-error' : ''}`} role={statusIsError ? 'alert' : 'status'}>{statusIsError ? <AlertTriangle size={16} /> : <CheckCircle2 size={16} />}{statusMessage}</p>}

      <div className="settings-sections">
        <section className="settings-card settings-account-card" aria-labelledby="settings-account-title">
          <SettingsSectionHeading icon={<UserRound />} title={t('Account')} subtitle={t('Profile, contact information and verification.')} id="settings-account-title" />
          <div className="settings-account-summary">
            {profilePhotoUrl
              ? <img className="settings-avatar" src={profilePhotoUrl} alt="" />
              : <span className="settings-avatar settings-avatar-fallback"><UserRound size={25} /></span>}
            <div className="settings-account-name"><strong>{profile?.name || user?.displayName || t('BharatSathi citizen')}</strong><span>{user?.email}</span></div>
            <div className={`settings-verification ${accountVerified ? 'settings-verified' : ''}`}>
              {accountVerified ? <CheckCircle2 size={15} /> : <AlertTriangle size={15} />}
              {accountVerified ? t('Email verified') : t('Email not verified')}
            </div>
          </div>
          <div className="settings-photo-upload">
            <input
              ref={photoInputRef}
              className="settings-photo-input"
              type="file"
              accept="image/*"
              aria-label={t('Choose a profile photo')}
              disabled={uploadingPhoto}
              onChange={(event) => void uploadProfilePhoto(event.currentTarget.files?.[0])}
            />
            <button type="button" className="settings-secondary-button" onClick={() => photoInputRef.current?.click()} disabled={uploadingPhoto}>
              {uploadingPhoto ? `${t('Uploading photo')} ${photoUploadProgress}%` : t('Upload profile photo')}
            </button>
            <span>{t('Choose an image file. There is no app-level file size limit; very large uploads may take longer.')}</span>
          </div>
          <div className="settings-completion">
            <div><span>{t('Profile completion')}</span><strong>{completion}%</strong></div>
            <span className="settings-completion-track"><i style={{ width: `${completion}%` }} /></span>
          </div>
          {editingProfile ? <form className="settings-profile-form" onSubmit={(event) => void saveProfile(event)}>
            <label>{t('Full name')}<input required minLength={2} maxLength={100} value={profileDraft.name} onChange={(event) => setProfileDraft((current) => ({ ...current, name: event.target.value }))} /></label>
            <label>{t('Email address')}<input type="email" value={user?.email ?? ''} readOnly /></label>
            <label>{t('Phone number')}<input type="tel" maxLength={18} value={profileDraft.phone} onChange={(event) => setProfileDraft((current) => ({ ...current, phone: event.target.value }))} /></label>
            <div className="settings-form-actions"><button type="submit" className="settings-primary-button" disabled={savingProfile}><Save size={15} />{savingProfile ? t('Saving…') : t('Save Profile')}</button><button type="button" className="settings-secondary-button" onClick={() => setEditingProfile(false)}>{t('Cancel')}</button></div>
          </form> : <div className="settings-account-details">
            <p><span>{t('Phone number')}</span><strong>{profile?.phone || t('Not added')}</strong></p>
            <p><span>{t('Authentication')}</span><strong>{user?.providerData.map((provider) => provider.providerId === 'google.com' ? 'Google' : provider.providerId === 'password' ? 'Email and password' : provider.providerId).join(', ') || t('Firebase account')}</strong></p>
            <div className="settings-form-actions"><button type="button" className="settings-primary-button" onClick={() => setEditingProfile(true)}>{t('Edit Profile')} <ChevronRight size={15} /></button>{!accountVerified && <button type="button" className="settings-secondary-button" onClick={() => void sendVerificationEmail()}>{t('Send verification email')}</button>}</div>
          </div>}
        </section>

        <section className="settings-card" aria-labelledby="settings-language-title">
          <SettingsSectionHeading icon={<Globe2 />} title={t('Language & Accessibility')} subtitle={t('Choose the language used across BharatSathi.')} id="settings-language-title" />
          <label className="settings-control-label">{t('App language')}
            <span className="settings-language-search"><Languages size={16} /><input value={languageSearch} onChange={(event) => setLanguageSearch(event.target.value)} placeholder={t('Search by language name or native script')} aria-label={t('Search languages')} /></span>
          </label>
          <select className="settings-language-select" value={preferredLanguage} onChange={(event) => void changeLanguage(event.target.value)} disabled={savingPreference === 'preferredLanguage'} aria-label={t('App language')}>
            {filteredLanguages.map((language) => <option key={language.code} value={language.code}>{language.nativeName} — {language.name}</option>)}
          </select>
          {!filteredLanguages.length && <p className="settings-help-copy">{t('No languages match your search.')}</p>}
          <p className="settings-help-copy">{t('Core menus and common screens are translated into English, Telugu, Hindi, Tamil, Malayalam, Marathi, Gujarati and Punjabi. Some scheme records and less-used messages may remain in English.')}</p>
          <div className="settings-subsection-heading"><Headphones size={17} /><strong>{t('Voice settings')}</strong></div>
          <label className="settings-control-label">{t('Preferred voice language')}
            <select className="settings-language-select" value={voiceLanguage} onChange={(event) => void changeVoiceLanguage(event.target.value)} disabled={savingPreference === 'voiceLanguage'}>
              {appLanguages.map((language) => <option key={language.code} value={language.code}>{language.nativeName} — {language.name}</option>)}
            </select>
          </label>
          <PreferenceToggle title={t('Auto-detect spoken language')} detail={t('Best-effort script detection selects the reply voice without changing your app language.')} checked={preferences.autoDetectVoiceLanguage} disabled={Boolean(savingPreference)} onChange={(value) => void savePreference('autoDetectVoiceLanguage', value)} />
          <p className="settings-help-copy">{t('Speech input and spoken voices depend on the language support available in your browser and device.')}</p>
        </section>

        <section className="settings-card" aria-labelledby="settings-notifications-title">
          <SettingsSectionHeading icon={<Bell />} title={t('Notifications')} subtitle={t('Choose the updates you would like to receive.')} id="settings-notifications-title" />
          {notificationOptions.map((option) => <PreferenceToggle key={option.key} title={t(option.title)} detail={t(option.detail)} checked={preferences[option.key]} disabled={Boolean(savingPreference)} onChange={(value) => void savePreference(option.key, value)} />)}
          <p className="settings-help-copy">{t('These preferences are saved to your account. Push and email delivery depend on notification services configured for this project.')}</p>
        </section>

        <section className="settings-card" aria-labelledby="settings-assistant-title">
          <SettingsSectionHeading icon={<Mic />} title={t('AI Assistant')} subtitle={t('Control voice and conversation features.')} id="settings-assistant-title" />
          <PreferenceToggle title={t('Voice assistant')} detail={t('Show or hide the floating BharatSathi assistant.')} checked={preferences.voiceAssistantEnabled} disabled={Boolean(savingPreference)} onChange={(value) => void savePreference('voiceAssistantEnabled', value)} />
          <PreferenceToggle title={t('Voice input')} detail={t('Use your browser microphone to turn speech into text.')} checked={preferences.voiceInputEnabled} disabled={Boolean(savingPreference) || !preferences.voiceAssistantEnabled} onChange={(value) => void savePreference('voiceInputEnabled', value)} />
          <PreferenceToggle title={t('Speak AI responses')} detail={t('Read source-based assistant replies aloud when supported.')} checked={preferences.voiceResponsesEnabled} disabled={Boolean(savingPreference) || !preferences.voiceAssistantEnabled} onChange={(value) => void savePreference('voiceResponsesEnabled', value)} />
          <PreferenceToggle title={t('Conversation history')} detail={t('Save redacted assistant exchanges in your private account.')} checked={preferences.conversationHistoryEnabled} disabled={Boolean(savingPreference)} onChange={(value) => void savePreference('conversationHistoryEnabled', value)} />
          <div className="settings-row-action"><div><strong>{t('Manage conversation history')}</strong><small>{t('Clear saved assistant conversations from your account.')}</small></div><button type="button" className="settings-secondary-button" onClick={() => void manageHistory()} disabled={Boolean(savingPreference)}>{savingPreference === 'conversationHistory' ? t('Working…') : t('Clear history')}</button></div>
          <p className="settings-help-copy">{t('The current assistant uses your local scheme catalogue and structured eligibility rules. No generative AI service is configured to process your private data.')}</p>
        </section>

        <section className="settings-card" aria-labelledby="settings-privacy-title">
          <SettingsSectionHeading icon={<LockKeyhole />} title={t('Privacy & Security')} subtitle={t('Understand how profile and assistant data are used.')} id="settings-privacy-title" />
          <PreferenceToggle title={t('Personalized scheme guidance')} detail={t('Use relevant profile fields to rank verified scheme records on this device.')} checked={preferences.aiPersonalizationEnabled} disabled={Boolean(savingPreference)} onChange={(value) => void savePreference('aiPersonalizationEnabled', value)} />
          <PrivacyItem title={t('Personal information')} text={t('Profile data is stored in users/{uid} and read by the authenticated account owner.')} />
          <PrivacyItem title={t('Document privacy')} text={t('Uploads use a private users/{uid}/documents path. Documents are not sent to an AI service by this application.')} />
          <PrivacyItem title={t('AI data preferences')} text={t('Assistant replies use available scheme records and profile context only when relevant. Avoid entering Aadhaar, bank details, passwords or OTPs.')} />
          <PrivacyItem title={t('Active sessions')} text={t('This page shows the current Firebase Authentication session. Use Sign out on shared devices.')} />
        </section>

        <section className="settings-card" aria-labelledby="settings-data-title">
          <SettingsSectionHeading icon={<FileText />} title={t('Documents & Data')} subtitle={t('Manage uploaded files and saved application information.')} id="settings-data-title" />
          <SettingsLink to="/documents" title={t('Uploaded documents')} detail={t('{{count}} private document record(s)', { count: data?.documents.length ?? 0 })} />
          <SettingsLink to="/my-schemes" title={t('Saved schemes and applications')} detail={t('Review your saved opportunities and application progress.')} />
          <p className="settings-help-copy">{t('Uploaded documents are stored privately in Firebase Storage and their metadata is kept in Firestore. Files are not public.')}</p>
        </section>

        <section className="settings-card" aria-labelledby="settings-help-title">
          <SettingsSectionHeading icon={<CircleHelp />} title={t('Help & Support')} subtitle={t('Find your next step or browse verified scheme sources.')} id="settings-help-title" />
          <SettingsLink to="/ai-assistant" title={t('Help Center and FAQs')} detail={t('Ask the source-based assistant or type a question.')} />
          <SettingsLink to="/schemes" title={t('Browse scheme information')} detail={t('Open official sources to confirm current requirements.')} />
          <p className="settings-help-copy">{t('A dedicated support contact and problem-reporting service are not configured in this application yet.')}</p>
        </section>

        <section className="settings-card" aria-labelledby="settings-about-title">
          <SettingsSectionHeading icon={<ShieldCheck />} title={t('About BharatSathi AI')} subtitle={t('A guide to government-benefit information.')} id="settings-about-title" />
          <p className="settings-about-copy">{t('BharatSathi helps people discover relevant government scheme information, organize documents and understand structured eligibility checks.')}</p>
          <p className="settings-disclaimer">{t('Government information disclaimer')}: {t('Scheme information is preliminary. Eligibility and approval are determined only by the relevant government authority. Always check the official source.')}</p>
          <Link className="settings-text-link" to="/schemes">{t('View verified scheme sources')} <ChevronRight size={15} /></Link>
        </section>

        <section className="settings-card settings-danger-card" aria-labelledby="settings-danger-title">
          <SettingsSectionHeading icon={<AlertTriangle />} title={t('Danger Zone')} subtitle={t('Actions that affect your account and saved data.')} id="settings-danger-title" />
          <div className="settings-danger-actions">
            <button type="button" className="settings-secondary-button" onClick={() => void handleSignOut()}><LogOut size={15} />{t('Sign out')}</button>
            <button type="button" className="settings-delete-button" onClick={() => { setAccountDeleteOpen(true); setDeleteConfirmation(''); }}><Trash2 size={15} />{t('Delete account')}</button>
          </div>
        </section>
      </div>

      {accountDeleteOpen && <div className="settings-dialog-backdrop">
        <section className="settings-delete-dialog" role="alertdialog" aria-modal="true" aria-labelledby="delete-account-title">
          <span className="settings-delete-icon"><AlertTriangle size={22} /></span>
          <h2 id="delete-account-title">{t('Permanently delete your account?')}</h2>
          <p>{t('This permanently deletes your Firebase account, profile, saved schemes, applications, documents, notifications, activity, AI conversation history, uploaded files and associated private data. You will need to re-authenticate to continue.')}</p>
          <label>{t('Type DELETE to confirm')}<input autoComplete="off" value={deleteConfirmation} onChange={(event) => setDeleteConfirmation(event.target.value)} /></label>
          <div className="settings-form-actions">
            <button type="button" className="settings-secondary-button" onClick={() => setAccountDeleteOpen(false)} disabled={deletingAccount}>{t('Cancel')}</button>
            <button type="button" className="settings-delete-button" onClick={() => void deleteAccount()} disabled={deleteConfirmation !== 'DELETE' || deletingAccount}>{deletingAccount ? t('Deleting…') : t('Delete account')}</button>
          </div>
        </section>
      </div>}
    </main>
  );
}

function SettingsSectionHeading({ icon, title, subtitle, id }: { icon: React.ReactNode; title: string; subtitle: string; id: string }) {
  return <header className="settings-section-heading">
    <span className="settings-section-icon">{icon}</span>
    <span><h2 id={id}>{title}</h2><p>{subtitle}</p></span>
  </header>;
}

function PreferenceToggle({ title, detail, checked, disabled, onChange }: { title: string; detail: string; checked: boolean; disabled: boolean; onChange: (value: boolean) => void }) {
  return <div className="settings-toggle-row">
    <span><strong>{title}</strong><small>{detail}</small></span>
    <button type="button" className={`settings-switch ${checked ? 'settings-switch-on' : ''}`} role="switch" aria-checked={checked} aria-label={title} onClick={() => onChange(!checked)} disabled={disabled}>
      <i />
    </button>
  </div>;
}

function PrivacyItem({ title, text }: { title: string; text: string }) {
  return <div className="settings-privacy-item"><strong>{title}</strong><p>{text}</p></div>;
}

function SettingsLink({ to, title, detail }: { to: string; title: string; detail: string }) {
  return <Link to={to} className="settings-row-action settings-row-link"><span><strong>{title}</strong><small>{detail}</small></span><ChevronRight size={17} /></Link>;
}

function maskEmailAddress(email: string | null | undefined): string {
  if (!email) return '';
  const [localPart, domain] = email.split('@');
  return domain ? `${localPart.slice(0, 1)}***@${domain}` : '***';
}
