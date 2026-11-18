import { ArrowRight, Bell, FileText, LoaderCircle, Mail, Save, ShieldCheck, Trash2, Upload, UserRound } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../context/AuthContext';
import { useDashboardData } from '../hooks/useDashboardData';
import { saveUserProfile, type UserProfile } from '../services/dashboard';
import {
  cancelEmailChange,
  getEmailChangeStatus,
  initiateEmailRecovery,
  initiateEmailChange,
  resendEmailChangeConfirmation,
  type EmailChangeStatus,
} from '../services/emailChange';
import { confirmDocumentInformation, documentCategories, removeCitizenDocument, uploadCitizenDocument } from '../services/documents';
import { checkDocumentImage, type DocumentImageCheck } from '../services/documentRecognition';
import { evaluateSchemeEligibility } from '../services/eligibility';
import { getDashboardTimestamp } from '../services/dashboard';
import { emailDocumentAccessPin, emailDocumentUploadNotification, getSecureDocumentDownloadUrl } from '../services/notifications';
import { schemes as localSchemes } from '../data/schemes';
import SettingsPage from './Settings';

type SectionName = 'my-schemes' | 'documents' | 'notifications' | 'profile' | 'settings';

const profileFields: { key: keyof UserProfile; label: string; placeholder: string; type?: string; readOnly?: boolean; options?: { value: string; label: string }[] }[] = [
  { key: 'name', label: 'Full name', placeholder: 'Your name' },
  { key: 'phone', label: 'Phone number', placeholder: 'Your phone number', type: 'tel' },
  { key: 'userType', label: 'User type', placeholder: 'Choose what best describes you', options: [
    { value: 'General Citizen', label: 'General citizen' },
    { value: 'Student', label: 'Student' },
    { value: 'Farmer', label: 'Farmer' },
    { value: 'Job Seeker', label: 'Job seeker' },
    { value: 'Business Owner', label: 'Business owner' },
    { value: 'Woman & Family', label: 'Woman / family' },
    { value: 'Person with Disability', label: 'Person with disability' },
  ] },
  { key: 'state', label: 'State', placeholder: 'e.g. Andhra Pradesh' },
  { key: 'district', label: 'District', placeholder: 'Your district' },
  { key: 'dateOfBirth', label: 'Date of birth', placeholder: '', type: 'date' },
  { key: 'age', label: 'Age', placeholder: 'Age in years', type: 'number' },
  { key: 'gender', label: 'Gender (optional)', placeholder: 'Select if you wish to share' },
  { key: 'ageGroup', label: 'Age group', placeholder: 'e.g. 18–25' },
  { key: 'education', label: 'Education', placeholder: 'Your highest education' },
  { key: 'educationLevel', label: 'Education level', placeholder: 'e.g. Graduate' },
  { key: 'course', label: 'Course or field of study', placeholder: 'Your course or subject' },
  { key: 'college', label: 'College or institution', placeholder: 'Your college or institution' },
  { key: 'yearOfStudy', label: 'Year of study', placeholder: 'e.g. 2nd year' },
  { key: 'occupation', label: 'Occupation', placeholder: 'Student, farmer, business owner…' },
  { key: 'employmentStatus', label: 'Employment status', placeholder: 'e.g. Student, Employed, Unemployed' },
  { key: 'familySize', label: 'Family size', placeholder: 'Number of family members', type: 'number' },
  { key: 'dependents', label: 'Dependents', placeholder: 'Number of dependents', type: 'number' },
  { key: 'annualIncome', label: 'Annual household income (₹)', placeholder: 'Enter approximate annual income', type: 'number' },
  { key: 'incomeRange', label: 'Annual household income range', placeholder: 'Select or enter your income range' },
  { key: 'isFarmer', label: 'Are you a farmer?', placeholder: 'Choose an option', options: [{ value: '', label: 'Prefer not to say' }, { value: 'true', label: 'Yes' }, { value: 'false', label: 'No' }] },
  { key: 'landDetails', label: 'Land or farming details (optional)', placeholder: 'Share only details relevant to scheme guidance' },
  { key: 'ownsBusiness', label: 'Do you own a business?', placeholder: 'Choose an option', options: [{ value: '', label: 'Prefer not to say' }, { value: 'true', label: 'Yes' }, { value: 'false', label: 'No' }] },
  { key: 'businessType', label: 'Business type (optional)', placeholder: 'Type of business' },
  { key: 'category', label: 'Community category (optional)', placeholder: 'Select or enter if relevant' },
  { key: 'disabilityStatus', label: 'Disability status (optional)', placeholder: 'Share only if relevant' },
];

export default function DashboardSection({ section }: { section: SectionName }) {
  const { user, signOut } = useAuth();
  const { data, loading, error } = useDashboardData();

  if (section === 'my-schemes') return <MySchemes />;
  if (section === 'documents') return <DocumentsPage />;
  if (section === 'notifications') return <NotificationsPage />;
  if (section === 'profile') return <ProfilePage />;
  if (section === 'settings') return <SettingsPage />;

  return <section className="dashboard-panel dashboard-standalone-section">
    <h1>Account</h1>
    <p>{user?.email}</p>
    <p>{loading ? 'Loading your account…' : error ?? data?.profile?.name}</p>
    <button onClick={() => signOut()}>Sign out</button>
  </section>;
}

function MySchemes() {
  const { t } = useTranslation();
  const { data, loading, error } = useDashboardData();
  const [activeTab, setActiveTab] = useState('All');
  const catalogue = data?.schemes.length ? data.schemes : localSchemes;
  const savedRecords = (data?.savedSchemes ?? []).map((record) => ({ ...record, listType: 'saved' }));
  const applicationRecords = (data?.applications ?? []).map((record) => ({ ...record, listType: 'application' }));
  const allRecords = [...savedRecords, ...applicationRecords];
  const tabs = ['All', 'Saved', 'In Progress', 'Ready to Apply', 'Applied', 'Approved'];
  const records = allRecords.filter((record) => {
    const status = (record.status ?? '').toLowerCase();
    if (activeTab === 'All') return true;
    if (activeTab === 'Saved') return record.listType === 'saved';
    if (activeTab === 'In Progress') return record.listType === 'application' && ['draft', 'not started', 'documents pending', 'needs action', 'under review', 'in progress', 'in_progress'].includes(status);
    if (activeTab === 'Ready to Apply') return status === 'ready to apply';
    if (activeTab === 'Applied') return ['submitted', 'applied', 'under review'].includes(status);
    return status === 'approved';
  });
  return (
    <section className="dashboard-panel dashboard-standalone-section">
      <div className="section-title-row"><span className="section-title-icon"><ShieldCheck size={18} /></span><div><h1>{t('My Schemes')}</h1><p>{t('Your saved schemes and application progress.')}</p></div><Link to="/schemes">{t('Explore schemes')} <ArrowRight size={13} /></Link></div>
      {error && <InlineError message={error} />}
      <div className="my-schemes-tabs mt-5 flex flex-wrap gap-2" role="tablist" aria-label={t('Scheme tracking filters')}>
        {tabs.map((tab) => <button key={tab} type="button" role="tab" aria-selected={activeTab === tab} className={`rounded-full border px-3 py-2 text-xs font-bold ${activeTab === tab ? 'border-emerald-700 bg-emerald-700 text-white' : 'border-slate-200 bg-white text-slate-600'}`} onClick={() => setActiveTab(tab)}>{t(tab)}</button>)}
      </div>
      {loading ? <LoadingRows /> : records.length ? (
        <div className="my-schemes-list">
          {records.map((record) => {
            const scheme = catalogue.find((item) => item.id === record.schemeId);
            const match = scheme ? evaluateSchemeEligibility(scheme, data?.profile, data?.documents ?? []).score : null;
            return <article className="my-scheme-row" key={record.id}>
              <span className="my-scheme-icon">{(scheme?.name ?? 'S').slice(0, 1)}</span>
              <div className="min-w-0 flex-1"><strong>{scheme?.name ?? record.name ?? record.schemeId ?? t('Saved scheme')}</strong><p>{scheme ? t(scheme.category) : t('Government scheme')} · {t(record.status ?? 'Saved')} · {t('Eligibility Match')}: {match === null ? '—' : `${match}%`}</p><small>{t(record.nextAction ?? 'Review scheme details and official requirements.')}</small></div>
              <span className="text-xs text-slate-400">{formatDate(record.updatedAt ?? record.createdAt ?? record.savedAt)}</span>
              {scheme && <Link to={`/schemes/${scheme.id}`}>{t('View details')} <ArrowRight size={13} /></Link>}
            </article>;
          })}
        </div>
      ) : <EmptySection title={t('Nothing in this list yet')} text={t('Save a scheme or start an application tracker to follow your progress here.')} link="/schemes" action={t('Explore schemes')} />}
      <div className="dashboard-section-note">{t('Match scores use structured rules when available; official departments decide final eligibility.')}</div>
    </section>
  );
}

function DocumentsPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { data, loading, error } = useDashboardData();
  const [searchParams] = useSearchParams();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const uploadAttemptId = useRef(0);
  const [busyDocument, setBusyDocument] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [selectedApplicationId, setSelectedApplicationId] = useState(searchParams.get('applicationId') ?? '');
  const [documentType, setDocumentType] = useState<string>(documentCategories[0]);
  const [customDocumentName, setCustomDocumentName] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [consent, setConsent] = useState(false);
  const [replaceDocumentId, setReplaceDocumentId] = useState<string | null>(null);
  const [documentCheck, setDocumentCheck] = useState<{
    fileName: string;
    category: string;
    result: DocumentImageCheck;
    message: string;
    recognized?: string;
  } | null>(null);
  const [confirmingDocument, setConfirmingDocument] = useState<string | null>(null);
  const [confirmedName, setConfirmedName] = useState('');
  const [confirmedIncome, setConfirmedIncome] = useState('');
  const [pinDocumentId, setPinDocumentId] = useState<string | null>(null);
  const [documentPin, setDocumentPin] = useState('');
  const [pinAction, setPinAction] = useState<'view' | 'download'>('download');
  const [pinBusy, setPinBusy] = useState(false);
  const existing = data?.documents ?? [];
  const applications = data?.applications ?? [];
  const selectedApplication = applications.find((application) => application.id === selectedApplicationId);
  const selectedSchemeId = selectedApplication?.schemeId;
  const selectedSchemeName = selectedApplication?.schemeName ?? selectedApplication?.name;
  const documents = existing
    .filter((record) => Boolean(record.storagePath))
    .sort((a, b) => dateValue(b.uploadedAt ?? b.createdAt) - dateValue(a.uploadedAt ?? a.createdAt));

  useEffect(() => {
    if (loading) return;
    if (selectedApplicationId && !applications.some((application) => application.id === selectedApplicationId)) {
      setSelectedApplicationId('');
    }
  }, [applications, loading, selectedApplicationId]);

  const clearSelectedFile = () => {
    setSelectedFile(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const getDocumentUploadError = (error: unknown) => {
    const code = typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string'
      ? error.code
      : '';
    const serverResponse = typeof error === 'object' && error !== null
      && 'customData' in error && typeof error.customData === 'object' && error.customData !== null
      && 'serverResponse' in error.customData && typeof error.customData.serverResponse === 'string'
      ? error.customData.serverResponse
      : '';
    if (/bucket.{0,30}(?:not found|does not exist)|storage.{0,30}not set up/i.test(serverResponse)) {
      return 'Uploads are unavailable because Firebase Storage is not set up for this project. Open the Firebase Storage console and select Get Started: https://console.firebase.google.com/project/bharatsathi-ai-1aed0/storage';
    }
    if (['storage/bucket-not-found', 'storage/no-default-bucket', 'storage/project-not-found'].includes(code)) {
      return 'Uploads are unavailable because Firebase Storage is not set up for this project. Open the Firebase Storage console and select Get Started: https://console.firebase.google.com/project/bharatsathi-ai-1aed0/storage';
    }
    if (code === 'storage/unauthorized') {
      return 'Firebase Storage denied this upload. Confirm Storage is initialized and the deployed rules allow uploads to your own users/{uid}/documents path.';
    }
    if (code === 'storage/quota-exceeded') return 'Firebase Storage quota is exceeded. Please contact the project administrator.';
    if (code === 'storage/unauthenticated' || code === 'unauthenticated') return 'Your sign-in expired before the upload completed. Sign in again and retry.';
    if (code === 'permission-denied') return 'Firebase denied saving the document record. Confirm the Firestore document rules allow the signed-in owner to create this record.';
    if (code === 'storage/unknown') return 'Firebase Storage encountered an unexpected upload error. Check your connection and retry.';
    if (code === 'storage/canceled') return 'The upload was canceled. Please try again.';
    if (code === 'storage/retry-limit-exceeded' || code === 'storage/network-request-failed') {
      return 'Firebase Storage could not complete the upload. Confirm Storage is enabled and the configured bucket exists; if it does, check your connection and deployed Storage rules.';
    }
    if (code.startsWith('storage/')) return 'Document upload failed. Please check your connection and Firebase Storage setup, then try again.';
    if (code.startsWith('firestore/')) return 'The document record could not be saved. It was not marked as uploaded; refresh the Document Center before retrying.';
    return error instanceof Error ? error.message : 'Could not upload this document. Please try again.';
  };

  const upload = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const currentUploadAttempt = ++uploadAttemptId.current;
    if (!documentType.trim()) {
      setMessage('Select a document type.');
      return;
    }
    if (!selectedFile) {
      setMessage('Please select a document first.');
      return;
    }
    if (!user) {
      setMessage('Sign in before uploading a document to your private vault.');
      return;
    }
    if (documentType === 'Other' && !customDocumentName.trim()) {
      setMessage('Enter a name for this document.');
      return;
    }
    if (selectedApplicationId && !selectedApplication) {
      setMessage('Choose a valid application or select None.');
      return;
    }
    if (selectedApplication && (!selectedSchemeId || !selectedSchemeName)) {
      setMessage('This application cannot be linked yet. Select None to store the document in your personal vault.');
      return;
    }
    if (!consent) {
      setMessage('Confirm consent to store this file in your private account.');
      return;
    }
    if (selectedFile.size > 10 * 1024 * 1024) {
      setMessage('Maximum file size is 10 MB.');
      return;
    }
    if (!['application/pdf', 'image/jpeg', 'image/png'].includes(selectedFile.type)) {
      setMessage('Only PDF, JPG and PNG files are supported.');
      return;
    }
    const categoryForCheck = documentType === 'Other' ? customDocumentName.trim() : documentType;
    setMessage('');
    try {
      const checkPromise: Promise<DocumentImageCheck> = checkDocumentImage(selectedFile, categoryForCheck).catch((checkError: unknown): DocumentImageCheck => {
        console.error('On-device document type check could not run:', checkError);
        return {
          status: 'uncertain',
          riskLevel: 'MEDIUM',
          riskSignals: ['ON_DEVICE_OCR_FAILED'],
          structureSignals: { titleFound: false, issuerFound: false, dateFound: false, referenceFound: false },
        };
      });
      void checkPromise.then((check) => {
        if (check.status === 'match') {
          setDocumentCheck(null);
          return;
        }
        const statusMessage = check.status === 'mismatch'
          ? `Possible document mismatch. You selected ${categoryForCheck}${check.recognized ? `; it may appear to be ${check.recognized}` : ''}. The upload will continue, but the document will be marked for re-upload. If this is the wrong type, use Replace after upload. This advisory check does not determine whether a document is genuine.`
          : check.status === 'skipped'
            ? 'Automated checks were not available for this file; it can still be uploaded and marked for review.'
            : check.riskSignals.includes('OCR_TIMEOUT_AFTER_5_SECONDS')
              ? 'The automated document-type check reached its 5-second limit. The file can still be uploaded and will need review.'
              : 'Automated checks could not confidently identify this file; it can still be uploaded and marked for review.';
        setDocumentCheck({
          fileName: selectedFile.name,
          category: categoryForCheck,
          result: check,
          message: statusMessage,
          ...(check.recognized ? { recognized: check.recognized } : {}),
        });
      });

      setBusyDocument('upload');
      setUploadProgress(null);
      const application = selectedApplication && selectedSchemeId && selectedSchemeName
        ? {
          applicationId: selectedApplication.id,
          schemeId: selectedSchemeId,
          schemeName: selectedSchemeName,
        }
        : undefined;
      const result = await uploadCitizenDocument(selectedFile, documentType, checkPromise, {
        ...(documentType === 'Other' ? { customDocumentName: customDocumentName.trim() } : {}),
        ...(application ? { application } : {}),
        existingContentHashes: existing.flatMap((record) => record.contentHash ? [record.contentHash] : []),
        onProgress: setUploadProgress,
        onStorageComplete: () => setBusyDocument('saving'),
      });

      let replacementCleanupFailed = false;
      if (replaceDocumentId) {
        const oldRecord = existing.find((record) => record.id === replaceDocumentId);
        if (oldRecord?.storagePath) {
          try {
            await removeCitizenDocument(oldRecord.id, oldRecord.storagePath);
          } catch (replaceError) {
            replacementCleanupFailed = true;
            console.error('Replacement document was stored, but the previous file could not be removed:', replaceError);
          }
        }
      }
      setReplaceDocumentId(null);
      clearSelectedFile();
      setDocumentCheck(null);
      setConsent(false);
      setCustomDocumentName('');
      setPinDocumentId(null);
      setDocumentPin('');
      setPinAction('download');
      const uploadStatusMessage = result.status === 'NEEDS_REUPLOAD'
        ? `${categoryForCheck} uploaded successfully, but may be the wrong document. Please use Replace to re-upload the correct document.`
        : result.status === 'NEEDS_REVIEW'
          ? `${categoryForCheck} uploaded successfully. Needs Review: automated checks could not confidently assess the file.`
          : `${categoryForCheck} uploaded successfully. Status: Uploaded.`;
      setMessage([
        uploadStatusMessage,
        ...(selectedApplication ? [`Linked to ${selectedApplication.schemeName ?? selectedApplication.name ?? 'your application'}.`] : []),
        ...(replacementCleanupFailed ? ['The previous version could not be removed; review your document list.'] : []),
      ].join(' '));
      void (async () => {
        let uploadNotificationStatus = '';
        let uploadNotificationError = '';
        try {
          uploadNotificationStatus = await emailDocumentUploadNotification(result.documentId);
        } catch (notificationError) {
          uploadNotificationError = notificationError instanceof Error ? notificationError.message : 'Unknown email delivery error.';
          console.error('Document uploaded, but its branded upload notification could not be sent:', notificationError);
        }

        let accessPinEmailError = '';
        try {
          await emailDocumentAccessPin(result.documentId);
        } catch (emailError) {
          accessPinEmailError = emailError instanceof Error ? emailError.message : 'Unknown email delivery error.';
          console.error('Document uploaded, but a temporary PIN email could not be sent:', emailError);
        }

        if (uploadAttemptId.current !== currentUploadAttempt) return;
        if (!accessPinEmailError) setPinDocumentId(result.documentId);
        setMessage([
          uploadStatusMessage,
          ...(selectedApplication ? [`Linked to ${selectedApplication.schemeName ?? selectedApplication.name ?? 'your application'}.`] : []),
          ...(replacementCleanupFailed ? ['The previous version could not be removed; review your document list.'] : []),
          ...(uploadNotificationError
            ? [`The upload confirmation email could not be sent: ${uploadNotificationError}`]
            : uploadNotificationStatus === 'skipped'
              ? ['The upload confirmation email was skipped because document notifications are disabled in Settings.']
              : uploadNotificationStatus === 'duplicate'
                ? ['The upload confirmation email was already sent.']
                : ['The upload confirmation email was sent.']),
          ...(accessPinEmailError
            ? [`The access PIN email could not be sent: ${accessPinEmailError}`]
            : ['A temporary access PIN was emailed.']),
        ].join(' '));
      })();
    } catch (uploadError) {
      console.error('Unable to upload citizen document:', uploadError);
      setMessage(getDocumentUploadError(uploadError));
    } finally {
      setBusyDocument(null);
      setUploadProgress(null);
    }
  };

  const confirmInformation = async (event: FormEvent<HTMLFormElement>, documentId: string) => {
    event.preventDefault();
    if (!user) return;
    setBusyDocument(documentId);
    setMessage('');
    try {
      const updates: Record<string, string> = {};
      if (confirmedName.trim()) updates.name = confirmedName.trim();
      if (confirmedIncome.trim()) updates.annualIncome = confirmedIncome.trim();
      await confirmDocumentInformation(documentId, updates);
      setConfirmingDocument(null);
      setConfirmedName('');
      setConfirmedIncome('');
      setMessage('Profile information saved. This does not verify the document with an issuing authority.');
    } catch (confirmError) {
      console.error('Unable to confirm document information:', confirmError);
      setMessage(confirmError instanceof Error ? confirmError.message : 'Could not confirm the information. Please try again.');
    } finally {
      setBusyDocument(null);
    }
  };

  const remove = async (record: (typeof existing)[number]) => {
    if (!record.storagePath) {
      setMessage('This document does not have a storage path and cannot be removed here.');
      return;
    }
    setBusyDocument(record.id);
    setMessage('');
    try {
      await removeCitizenDocument(record.id, record.storagePath);
      setMessage('Document removed from your account.');
    } catch (removeError) {
      console.error('Unable to remove citizen document:', removeError);
      setMessage('Could not remove this document. Please try again.');
    } finally {
      setBusyDocument(null);
    }
  };

  const sendAccessPin = async (documentId: string) => {
    setPinBusy(true);
    setMessage('');
    try {
      await emailDocumentAccessPin(documentId);
      setPinDocumentId(documentId);
      setDocumentPin('');
      setMessage('A new temporary access PIN was sent to your verified email. Any previous PIN for this document is no longer valid.');
    } catch (pinError) {
      console.error('Unable to send a secure document access PIN:', pinError);
      setMessage(pinError instanceof Error ? pinError.message : 'Could not send the access PIN. Please try again.');
    } finally {
      setPinBusy(false);
    }
  };

  const requestDocumentAccess = (documentId: string, action: 'view' | 'download') => {
    setPinAction(action);
    void sendAccessPin(documentId);
  };

  const downloadWithPin = async (documentId: string) => {
    if (!/^\d{6}$/.test(documentPin)) {
      setMessage('Enter the six-digit access PIN from your email.');
      return;
    }
    const viewWindow = pinAction === 'view' ? window.open('', '_blank') : null;
    setPinBusy(true);
    setMessage('');
    try {
      const downloadUrl = await getSecureDocumentDownloadUrl(documentId, documentPin);
      const parsedUrl = new URL(downloadUrl);
      if (parsedUrl.protocol !== 'https:') throw new Error('The secure download service returned an unsafe link.');
      if (viewWindow) {
        viewWindow.opener = null;
        viewWindow.location.assign(parsedUrl.toString());
      } else {
        window.location.assign(parsedUrl.toString());
      }
    } catch (downloadError) {
      viewWindow?.close();
      console.error('Secure document download could not be authorized:', downloadError);
      setMessage(downloadError instanceof Error ? downloadError.message : 'Could not authorize this download. Check the PIN and try again.');
    } finally {
      setPinBusy(false);
    }
  };

  return (
    <section className="dashboard-panel dashboard-standalone-section">
      <div className="section-title-row"><span className="section-title-icon"><FileText size={18} /></span><div><h1>{t('Document Center')}</h1><p>{t('Securely store and manage your personal documents and proofs.')}</p></div></div>
      {error && <InlineError message={error} />}
      {message && <InlineError message={t(message)} />}
      <form className="profile-form" noValidate onSubmit={(event) => void upload(event)}>
        <label>{t('Document Type')}<select value={documentType} onChange={(event) => {
          setDocumentType(event.target.value);
          setCustomDocumentName('');
          setDocumentCheck(null);
        }} aria-required="true">
          {documentCategories.map((category) => <option key={category} value={category}>{t(category)}</option>)}
        </select></label>
        {documentType === 'Other' && <label>{t('Document Name')}<input value={customDocumentName} onChange={(event) => setCustomDocumentName(event.target.value)} maxLength={120} required placeholder={t('Enter document name')} /></label>}
        <label>{t('Application / Scheme (optional)')}<select value={selectedApplicationId} onChange={(event) => {
          setSelectedApplicationId(event.target.value);
          clearSelectedFile();
          setConsent(false);
          setDocumentCheck(null);
        }}>
          <option value="">{t('None')}</option>
          {applications.map((application) => <option key={application.id} value={application.id}>{application.schemeName ?? application.name ?? application.schemeId ?? t('Application')}</option>)}
        </select></label>
        <label>{t('Choose a PDF, JPG, or PNG (max 10 MB)')}<input ref={fileInputRef} type="file" accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png" onChange={(event) => {
          setSelectedFile(event.target.files?.[0] ?? null);
          setDocumentCheck(null);
        }} aria-required="true" /></label>
        {selectedFile && <p className="text-sm text-slate-700" role="status">{t('Selected file')}: <strong>{selectedFile.name}</strong> · {formatFileSize(selectedFile.size)}</p>}
        {busyDocument === 'upload' && uploadProgress === null && <div className="grid gap-1 text-xs text-slate-600" role="status"><span>{t('Connecting to secure storage…')}</span><progress className="w-full accent-emerald-700" /></div>}
        {busyDocument === 'upload' && uploadProgress !== null && <div className="grid gap-1 text-xs text-slate-600" role="status"><span>{t('Uploading document…')} {uploadProgress}%</span><progress className="w-full accent-emerald-700" value={uploadProgress} max="100" /></div>}
        {busyDocument === 'saving' && <div className="grid gap-1 text-xs text-slate-600" role="status"><span>{t('File uploaded. Finalizing checks and saving document record…')}</span><progress className="w-full accent-emerald-700" value={99} max="100" /></div>}
        <label className="document-consent"><input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} aria-required="true" /><span>{t('I consent to securely store this document in my private account. Automated checks are advisory and do not prove document authenticity.')}</span></label>
        {replaceDocumentId && <p className="text-sm font-semibold text-sky-800">{t('Replacing a document. The previous version will be removed after the new upload succeeds.')} <button type="button" className="font-bold underline" onClick={() => setReplaceDocumentId(null)}>{t('Cancel replacement')}</button></p>}
        {documentCheck && <div className={`document-check-notice ${documentCheck.result.status === 'mismatch' ? 'document-check-mismatch' : 'document-check-uncertain'}`} role="alert">
          <strong>{documentCheck.result.status === 'mismatch' ? t('Possible Document Mismatch') : t('Document Needs Review')}</strong>
          <span>{documentCheck.message}</span>
          <small>{t('Selected document')}: {t(documentCheck.category)}{documentCheck.recognized ? ` · ${t('Possible match')}: ${t(documentCheck.recognized)}` : ''}. {t('OCR confidence')}: {documentCheck.result.confidence ?? t('Not available')} · {t('Risk indicator')}: {t(documentCheck.result.riskLevel)}. {t('These AI checks are advisory and do not determine whether a document is fake or authentic.')}</small>
          {documentCheck.result.status === 'mismatch' && !busyDocument && <button type="button" className="profile-email-cancel-button justify-self-start" onClick={() => fileInputRef.current?.click()}>{t('Re-upload with a different file')}</button>}
        </div>}
        <button type="submit" className="solid-green-button" disabled={Boolean(busyDocument)}><Upload size={15} />{busyDocument === 'checking' ? t('Checking document (up to 5 seconds)…') : busyDocument === 'upload' ? uploadProgress === null ? t('Connecting to secure storage…') : `${t('Uploading…')} ${uploadProgress}%` : busyDocument === 'saving' ? t('Saving document record…') : replaceDocumentId ? t('Replace Document') : t('Upload Document')}</button>
      </form>

      <h2 className="mt-8 text-base font-black">{t('My Documents')}</h2>
      {loading ? <LoadingRows /> : documents.length ? (
        <div className="documents-page-list">
          {documents.map((record) => {
            const displayName = record.documentType === 'Other'
              ? record.customDocumentName ?? 'Other'
              : record.documentType ?? record.customDocumentName ?? 'Supporting document';
            const knownDocumentType = documentCategories.find((category) => category === displayName);
            const fileTypeLabel = record.mimeType === 'application/pdf' || /\.pdf$/i.test(record.fileName ?? '')
              ? 'PDF'
              : record.mimeType === 'image/png' || /\.png$/i.test(record.fileName ?? '')
                ? 'PNG'
                : 'JPG';
            return (
            <article key={record.id} className="documents-page-row">
              <span className="document-type"><FileText size={16} /></span>
              <span className="min-w-0 flex-1">
                <strong>{t(displayName)}</strong>
                <small className="block truncate">{fileTypeLabel} · {formatFileSize(record.fileSize)} · {record.fileName}</small>
                <small className="block">{t('Uploaded')}: {formatDate(record.uploadedAt ?? record.createdAt)} · {t(getDocumentStatusLabel(record))}</small>
                {record.status === 'NEEDS_REUPLOAD' && <small className="block font-semibold text-rose-700">{t('This may be the wrong document. Please re-upload the correct file using Replace.')}</small>}
                {record.applicationId && <small className="block">{t('Application')}: {record.schemeName ?? record.name ?? record.schemeId ?? t('Linked application')}</small>}
                <small className="block">{record.officialVerificationStatus === 'OFFICIALLY_VERIFIED' ? t('Officially verified through a connected service.') : t('Authenticity has not been officially verified.')}</small>
              </span>
              {record.status === 'UPLOADED' && <button type="button" className="text-xs font-bold text-emerald-700" onClick={() => { setConfirmingDocument(record.id); setConfirmedName(''); setConfirmedIncome(''); }}>{t('Confirm information')}</button>}
              {record.storagePath && pinDocumentId === record.id ? (
                <div className="basis-full grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto]">
                  <label className="grid gap-1 text-xs font-bold text-slate-500">{t('Six-digit email access PIN')}
                    <input value={documentPin} onChange={(event) => setDocumentPin(event.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" maxLength={6} className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-normal text-slate-800" />
                  </label>
                  <button type="button" className="solid-green-button self-end justify-center" disabled={pinBusy || documentPin.length !== 6} onClick={() => void downloadWithPin(record.id)}>{pinBusy ? t('Checking…') : pinAction === 'view' ? t('Verify PIN & view') : t('Verify PIN & download')}</button>
                  <button type="button" className="profile-email-cancel-button self-end" disabled={pinBusy} onClick={() => void sendAccessPin(record.id)}>{t('Resend PIN')}</button>
                </div>
              ) : record.storagePath && <div className="flex flex-wrap gap-2">
                <button type="button" className="text-xs font-bold text-emerald-700" disabled={pinBusy} onClick={() => requestDocumentAccess(record.id, 'view')}>{t('View')}</button>
                <button type="button" className="text-xs font-bold text-emerald-700" disabled={pinBusy} onClick={() => requestDocumentAccess(record.id, 'download')}>{t('Download')}</button>
                <button type="button" className="text-xs font-bold text-sky-700" disabled={Boolean(busyDocument)} onClick={() => {
                  setDocumentType(knownDocumentType ?? 'Other');
                  setCustomDocumentName(knownDocumentType ? '' : displayName);
                  setSelectedApplicationId(record.applicationId ?? '');
                  clearSelectedFile();
                  setConsent(false);
                  setDocumentCheck(null);
                  setReplaceDocumentId(record.id);
                }}>{t('Replace')}</button>
                <button type="button" disabled={busyDocument === record.id} onClick={() => void remove(record)} aria-label={t('Delete document')} className="text-xs font-bold text-rose-700"><Trash2 size={14} /> {t('Delete')}</button>
              </div>}
              {record.storagePath && pinDocumentId === record.id && <button type="button" className="text-xs font-bold text-sky-700" disabled={Boolean(busyDocument)} onClick={() => {
                setDocumentType(knownDocumentType ?? 'Other');
                setCustomDocumentName(knownDocumentType ? '' : displayName);
                setSelectedApplicationId(record.applicationId ?? '');
                clearSelectedFile();
                setConsent(false);
                setDocumentCheck(null);
                setReplaceDocumentId(record.id);
              }}>{t('Replace')}</button>}
              {confirmingDocument === record.id && <form className="basis-full grid gap-3 sm:grid-cols-2" onSubmit={(event) => void confirmInformation(event, record.id)}>
                <p className="text-xs leading-5 text-slate-600 sm:col-span-2">{t('Enter only information you reviewed and want saved to your profile. BharatSathi does not extract text from this file or verify it with a government authority.')}</p>
                <label>{t('Full name')}<input value={confirmedName} onChange={(event) => setConfirmedName(event.target.value)} /></label>
                <label>{t('Annual household income (₹)')}<input inputMode="numeric" value={confirmedIncome} onChange={(event) => setConfirmedIncome(event.target.value)} /></label>
                <button type="submit" className="solid-green-button sm:col-span-2" disabled={busyDocument === record.id}>{busyDocument === record.id ? t('Saving…') : t('Confirm and update profile')}</button>
              </form>}
            </article>
            );
          })}
        </div>
      ) : <p className="mt-3 text-sm text-slate-500">{t('No documents yet. Upload a personal proof to securely store it here.')}</p>}
      <p className="dashboard-section-note">{t('Your documents are private to your account. Automated OCR and risk checks are advisory only; no official document verification service is connected.')}</p>
    </section>
  );
}

function NotificationsPage() {
  const { t } = useTranslation();
  const { data, loading, error } = useDashboardData();
  const records = [...(data?.notifications ?? [])].sort((a, b) => dateValue(b.createdAt) - dateValue(a.createdAt));
  return (
    <section className="dashboard-panel dashboard-standalone-section">
      <div className="section-title-row"><span className="section-title-icon"><Bell size={18} /></span><div><h1>{t('Notifications')}</h1><p>{t('Updates about your saved schemes and applications.')}</p></div></div>
      {error && <InlineError message={error} />}
      {loading ? <LoadingRows /> : records.length ? <div className="notifications-list">{records.map((record) => <article key={record.id} className="notification-row"><span className="notification-row-icon"><Bell size={16} /></span><div><strong>{record.message ?? record.type ?? t('BharatSathi update')}</strong><p>{formatDate(record.createdAt)}</p></div></article>)}</div> : <EmptySection title={t('You’re all caught up')} text={t('New notifications will appear here.')} link="/dashboard" action={t('Back to dashboard')} />}
    </section>
  );
}

function ProfilePage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { data, loading, error } = useDashboardData();
  const [values, setValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [emailEditing, setEmailEditing] = useState(false);
  const [emailRecoveryMode, setEmailRecoveryMode] = useState(false);
  const [emailDraft, setEmailDraft] = useState('');
  const [recoveryCodeDraft, setRecoveryCodeDraft] = useState('');
  const [emailSaving, setEmailSaving] = useState(false);
  const [emailMessage, setEmailMessage] = useState('');
  const [emailMessageIsError, setEmailMessageIsError] = useState(false);
  const [emailChangeStatus, setEmailChangeStatus] = useState<EmailChangeStatus | null>(null);

  useEffect(() => {
    if (!user?.uid) return;
    let active = true;
    const loadStatus = () => {
      void getEmailChangeStatus().then((status) => {
        if (active) setEmailChangeStatus(status.state === 'none' ? null : status);
      }).catch((statusError: unknown) => {
        console.error('Unable to load current email-change status:', statusError);
        if (active) {
          setEmailMessageIsError(true);
          setEmailMessage(statusError instanceof Error ? statusError.message : 'Could not load email-change status.');
        }
      });
    };
    loadStatus();
    window.addEventListener('focus', loadStatus);
    return () => {
      active = false;
      window.removeEventListener('focus', loadStatus);
    };
  }, [user?.uid]);

  useEffect(() => {
    if (!data?.profile && !user) return;
    const profile = data?.profile ?? {};
    setValues({
      name: String(profile.name ?? user?.displayName ?? ''),
      phone: String(profile.phone ?? ''),
      userType: String(profile.userType ?? 'General Citizen'),
      state: String(profile.state ?? ''),
      district: String(profile.district ?? ''),
      dateOfBirth: String(profile.dateOfBirth ?? ''),
      gender: String(profile.gender ?? ''),
      ageGroup: String(profile.ageGroup ?? ''),
      education: String(profile.education ?? ''),
      educationLevel: String(profile.educationLevel ?? ''),
      course: String(profile.course ?? ''),
      college: String(profile.college ?? ''),
      yearOfStudy: String(profile.yearOfStudy ?? ''),
      occupation: String(profile.occupation ?? ''),
      employmentStatus: String(profile.employmentStatus ?? ''),
      familySize: String(profile.familySize ?? ''),
      dependents: String(profile.dependents ?? ''),
      annualIncome: String(profile.annualIncome ?? ''),
      incomeRange: String(profile.incomeRange ?? ''),
      isFarmer: profile.isFarmer === true ? 'true' : profile.isFarmer === false ? 'false' : '',
      landDetails: String(profile.landDetails ?? ''),
      ownsBusiness: profile.ownsBusiness === true ? 'true' : profile.ownsBusiness === false ? 'false' : '',
      businessType: String(profile.businessType ?? ''),
      category: String(profile.category ?? ''),
      disabilityStatus: String(profile.disabilityStatus ?? ''),
    });
  }, [data?.profile, user]);

  const editEmail = () => {
    setEmailDraft(user?.email ?? '');
    setEmailRecoveryMode(false);
    setRecoveryCodeDraft('');
    setEmailMessage('');
    setEmailEditing(true);
  };

  const chooseEmailRecovery = () => {
    setEmailRecoveryMode(true);
    setRecoveryCodeDraft('');
    setEmailMessage('');
    setEmailMessageIsError(false);
  };

  const submitEmailChange = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nextEmail = emailDraft.trim();
    if (!user) {
      setEmailMessage(t('Sign in again before changing your email address.'));
      return;
    }
    if (nextEmail.toLowerCase() === user.email?.toLowerCase()) {
      setEmailMessage(t('Enter an email address different from your current one.'));
      return;
    }

    setEmailSaving(true);
    setEmailMessage('');
    setEmailMessageIsError(false);
    try {
      const result = emailRecoveryMode
        ? await initiateEmailRecovery(nextEmail, recoveryCodeDraft)
        : await initiateEmailChange(nextEmail);
      setEmailChangeStatus({
        state: emailRecoveryMode ? 'pending_new' : 'pending_old',
        change_type: emailRecoveryMode ? 'recovery' : 'standard',
        new_email: nextEmail,
        expires_in: result.expires_in,
      });
      setEmailEditing(false);
      setEmailRecoveryMode(false);
      setRecoveryCodeDraft('');
      setEmailMessage(emailRecoveryMode
        ? t('We sent a verification link to your new email. Your account email will not change until you verify that address.')
        : t('Check your current email first. We will send the new-email verification only after you confirm the current address.'));
    } catch (emailError) {
      console.error('Unable to request an email address change:', emailError);
      setEmailMessageIsError(true);
      setEmailMessage(emailError instanceof Error ? emailError.message : 'Could not start the email change. Please try again.');
    } finally {
      setEmailSaving(false);
    }
  };

  const resendEmailConfirmation = async () => {
    const stage = emailChangeStatus?.state === 'pending_old' ? 'old'
      : emailChangeStatus?.state === 'pending_new' ? 'new'
        : null;
    if (!stage) return;
    setEmailSaving(true);
    setEmailMessage('');
    setEmailMessageIsError(false);
    try {
      await resendEmailChangeConfirmation(stage);
      setEmailMessage(stage === 'old'
        ? t('A new confirmation link was sent to your current email address.')
        : t('A new verification link was sent to your new email address.'));
    } catch (resendError) {
      console.error('Unable to resend the email-change confirmation:', resendError);
      setEmailMessageIsError(true);
      setEmailMessage(resendError instanceof Error ? resendError.message : 'Could not resend the confirmation email.');
    } finally {
      setEmailSaving(false);
    }
  };

  const cancelPendingEmailChange = async () => {
    setEmailSaving(true);
    setEmailMessage('');
    setEmailMessageIsError(false);
    try {
      await cancelEmailChange();
      setEmailChangeStatus({ state: 'cancelled' });
      setEmailMessage(t('The email change was cancelled. Your current account email was not changed.'));
    } catch (cancelError) {
      console.error('Unable to cancel the email change:', cancelError);
      setEmailMessageIsError(true);
      setEmailMessage(cancelError instanceof Error ? cancelError.message : 'Could not cancel the email change.');
    } finally {
      setEmailSaving(false);
    }
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!user) return;
    setSaving(true);
    setMessage('');
    try {
      await saveUserProfile({
        ...values,
        email: user.email ?? values.email,
        ...(user.photoURL ? { photoURL: user.photoURL } : {}),
        ...(values.isFarmer ? { isFarmer: values.isFarmer === 'true' } : {}),
        ...(values.ownsBusiness ? { ownsBusiness: values.ownsBusiness === 'true' } : {}),
      });
      setMessage('Your profile has been saved.');
    } catch (saveError) {
      console.error('Unable to save profile:', saveError);
      setMessage('Could not save your profile. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="dashboard-panel dashboard-standalone-section">
      <div className="section-title-row"><span className="section-title-icon"><UserRound size={18} /></span><div><h1>{t('Your Profile')}</h1><p>{t('Add details for more relevant scheme guidance.')}</p></div></div>
      {loading && <LoadingRows />}
      {error && <InlineError message={error} />}
      {message && <p className="form-status" role="status">{t(message)}</p>}
      <div className="profile-email-section">
        <label htmlFor="profile-email">{t('Email address')}</label>
        <div className="profile-email-value">
          <input id="profile-email" type="email" value={user?.email ?? ''} readOnly />
          {user?.emailVerified
            ? <span className="text-xs font-bold text-emerald-700">{t('Verified')}</span>
            : <span className="text-xs font-bold text-amber-700">{t('Not verified')}</span>}
          {!emailEditing && !['pending_old', 'pending_new'].includes(emailChangeStatus?.state ?? '')
            && <button type="button" className="profile-email-edit-button" onClick={editEmail}>{t('Edit email')}</button>}
        </div>
        <p>{t('Your account email changes only after you confirm your current address and verify your new address.')}</p>
        {emailMessage && <p className={`profile-email-message${emailMessageIsError ? ' is-error' : ''}`} role={emailMessageIsError ? 'alert' : 'status'}>{t(emailMessage)}</p>}
      </div>
      {(emailEditing || emailChangeStatus?.state === 'pending_old' || emailChangeStatus?.state === 'pending_new') && <ol className="profile-email-progress" aria-label={t('Email change progress')}>
        {(emailRecoveryMode || emailChangeStatus?.change_type === 'recovery'
          ? ['Enter New Email', 'Verify New Email', 'Email Changed']
          : ['Enter New Email', 'Confirm Current Email', 'Verify New Email', 'Email Changed']).map((step, index) => {
          const recoveryFlow = emailRecoveryMode || emailChangeStatus?.change_type === 'recovery';
          const completed = recoveryFlow
            ? emailChangeStatus?.state === 'pending_new' && index < 1
            : emailChangeStatus?.state === 'pending_new' && index < 2;
          const current = emailChangeStatus?.state === 'pending_old'
            ? index === 1
            : emailChangeStatus?.state === 'pending_new'
              ? recoveryFlow ? index === 1 : index === 2
              : index === 0;
          return <li key={step} className={completed ? 'is-complete' : current ? 'is-current' : ''}>
            <span>{completed ? '✓' : index + 1}</span>{t(step)}
          </li>;
        })}
      </ol>}
      {emailChangeStatus?.state === 'pending_old' && <div className="profile-email-change-form">
        <strong>{t('Check your current email')}</strong>
        <p>{t('We sent a confirmation link to {{email}}. The new email will not receive a verification link until you confirm this current address.', { email: maskEmail(user?.email ?? '') })}</p>
        {emailChangeStatus.new_email && <p>{t('Requested new email')}: {maskEmail(emailChangeStatus.new_email)}</p>}
        <div>
          <button type="button" className="solid-green-button" disabled={emailSaving} onClick={() => void resendEmailConfirmation()}>{emailSaving ? t('Sending…') : t('Resend Current Email Confirmation')}</button>
          <button type="button" className="profile-email-cancel-button" disabled={emailSaving} onClick={() => void cancelPendingEmailChange()}>{t('Cancel Email Change')}</button>
        </div>
      </div>}
      {emailChangeStatus?.state === 'pending_new' && <div className="profile-email-change-form">
        <strong>{emailChangeStatus.change_type === 'recovery' ? t('Verify your new email') : t('Current email confirmed')}</strong>
        <p>{emailChangeStatus.change_type === 'recovery'
          ? t('We sent a verification link to your new email. Your Firebase account email stays unchanged until you verify it.')
          : t('Check your new email for the verification link to finish changing your account email.')}</p>
        {emailChangeStatus.new_email && <p>{t('New email')}: {maskEmail(emailChangeStatus.new_email)}</p>}
        <div>
          <button type="button" className="solid-green-button" disabled={emailSaving} onClick={() => void resendEmailConfirmation()}>{emailSaving ? t('Sending…') : t('Resend New Email Verification')}</button>
          <button type="button" className="profile-email-cancel-button" disabled={emailSaving} onClick={() => void cancelPendingEmailChange()}>{t('Cancel Email Change')}</button>
        </div>
      </div>}
      {emailEditing && <form className="profile-email-change-form" onSubmit={(event) => void submitEmailChange(event)}>
        <label htmlFor="profile-new-email">{t('New email address')}</label>
        <input
          id="profile-new-email"
          type="email"
          autoComplete="email"
          maxLength={254}
          required
          value={emailDraft}
          onChange={(event) => setEmailDraft(event.target.value)}
        />
        {emailRecoveryMode && <>
          <label htmlFor="profile-recovery-code">{t('Account recovery code')}</label>
          <input
            id="profile-recovery-code"
            type="text"
            autoComplete="off"
            spellCheck={false}
            maxLength={43}
            required
            value={recoveryCodeDraft}
            onChange={(event) => setRecoveryCodeDraft(event.target.value.trim())}
          />
          <p>{t('This option is only for when you no longer have access to your current email. Your recovery code is checked securely; you must still verify the new email.')}</p>
        </>}
        <div>
          <button type="submit" className="solid-green-button" disabled={emailSaving}>
            {emailSaving ? <LoaderCircle size={15} className="verification-spin" /> : <Mail size={15} />}
            {emailSaving ? t('Sending…') : emailRecoveryMode ? t('Verify recovery code & continue') : t('Continue')}
          </button>
          <button type="button" className="profile-email-cancel-button" onClick={() => {
            setEmailEditing(false);
            setEmailRecoveryMode(false);
          }} disabled={emailSaving}>{t('Cancel')}</button>
        </div>
        {!emailRecoveryMode && <button type="button" className="profile-email-edit-button" onClick={chooseEmailRecovery} disabled={emailSaving}>
          {t('I no longer have access to my current email')}
        </button>}
      </form>}
      {emailChangeStatus?.state === 'recovery_required' && <div className="profile-email-change-form" role="alert">
        <strong>{t('Email change needs support')}</strong>
        <p>{t('We could not safely complete the account email change. Contact support; do not create another request or share your password or OTP.')}</p>
      </div>}
      <form className="profile-form" onSubmit={submit}>
        {profileFields.map(({ key, label, placeholder, type, readOnly, options }) => <label key={key}>{t(label)}{options ? <select value={values[key] ?? ''} onChange={(event) => setValues((current) => ({ ...current, [key]: event.target.value }))}>{options.map((option) => <option key={option.value} value={option.value}>{t(option.label)}</option>)}</select> : <input type={type ?? 'text'} placeholder={t(placeholder)} value={values[key] ?? ''} readOnly={readOnly} onChange={(event) => setValues((current) => ({ ...current, [key]: event.target.value }))} />}</label>)}
        <button type="submit" className="solid-green-button" disabled={saving}><Save size={15} />{saving ? t('Saving…') : t('Save Profile')}</button>
      </form>
    </section>
  );
}

function maskEmail(email: string) {
  const [local = '', domain = ''] = email.split('@');
  if (!local || !domain) return email;
  return `${local.slice(0, 1)}***@${domain}`;
}

function EmptySection({ title, text, link, action }: { title: string; text: string; link: string; action: string }) {
  return <div className="dashboard-empty"><FileText size={21} /><strong>{title}</strong><p>{text}</p><Link to={link}>{action} <ArrowRight size={13} /></Link></div>;
}

function InlineError({ message }: { message: string }) {
  return <p className="dashboard-alert dashboard-inline-alert" role="status"><Bell size={15} />{message}</p>;
}

function LoadingRows() {
  return <div className="section-loading"><span className="loading-spinner" /> Loading your information…</div>;
}

function dateValue(value: unknown) {
  if (typeof value === 'object' && value !== null && 'toDate' in value && typeof value.toDate === 'function') return value.toDate().getTime();
  const date = new Date(value as string | number);
  return Number.isNaN(date.getTime()) ? 0 : date.getTime();
}

function getDocumentStatusLabel(record: { status?: string; verificationStatus?: string; officialVerificationStatus?: string }) {
  if (record.officialVerificationStatus === 'OFFICIALLY_VERIFIED') return 'OFFICIALLY_VERIFIED';
  if (record.status === 'VERIFIED' || record.verificationStatus === 'CONFIRMED_BY_USER') return 'UPLOADED';
  if (record.status === 'UPLOADED') return 'Uploaded';
  if (record.status === 'VERIFYING') return 'Verification in progress';
  if (record.status === 'NEEDS_REVIEW') return 'Needs Review';
  if (record.status === 'NEEDS_REUPLOAD') return 'Needs Re-upload';
  return record.status ?? 'UPLOADED';
}

function formatDate(value: unknown) {
  const time = dateValue(value);
  return time ? new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium' }).format(time) : 'Recently';
}

function formatFileSize(size: number | undefined) {
  if (typeof size !== 'number' || !Number.isFinite(size) || size <= 0) return 'Size unavailable';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}
