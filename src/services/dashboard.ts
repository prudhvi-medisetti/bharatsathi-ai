import {
  addDoc,
  collection,
  doc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  type DocumentData,
  type Unsubscribe,
} from 'firebase/firestore';
import { auth, db } from '../lib/firebase';
import type { Scheme, SchemeEligibilityRules } from '../types';
import { canonicalSchemeCategory } from './schemeCategories';

export type UserProfile = {
  name?: string;
  email?: string;
  photoURL?: string;
  language?: string;
  preferredLanguage?: string;
  voiceLanguage?: string;
  voiceAssistantEnabled?: boolean;
  voiceInputEnabled?: boolean;
  voiceResponsesEnabled?: boolean;
  autoDetectVoiceLanguage?: boolean;
  conversationHistoryEnabled?: boolean;
  schemeNotificationsEnabled?: boolean;
  eligibilityNotificationsEnabled?: boolean;
  applicationNotificationsEnabled?: boolean;
  applicationDecisionNotificationsEnabled?: boolean;
  documentNotificationsEnabled?: boolean;
  documentVerificationNotificationsEnabled?: boolean;
  documentReminderEnabled?: boolean;
  governmentAlertsEnabled?: boolean;
  assistantNotificationsEnabled?: boolean;
  aiPersonalizationEnabled?: boolean;
  state?: string;
  district?: string;
  ageGroup?: string;
  education?: string;
  occupation?: string;
  familySize?: string | number;
  dependents?: string | number;
  annualIncome?: string | number;
  incomeRange?: string;
  phone?: string;
  gender?: string;
  mandal?: string;
  village?: string;
  category?: string;
  landDetails?: string;
  businessType?: string;
  profileCompleted?: boolean;
  uid?: string;
  createdAt?: unknown;
  updatedAt?: unknown;
  age?: number | string;
  dateOfBirth?: string;
  educationLevel?: string;
  course?: string;
  college?: string;
  yearOfStudy?: string;
  employmentStatus?: string;
  isFarmer?: boolean;
  ownsBusiness?: boolean;
  userType?: string;
  disabilityStatus?: string;
  [key: string]: unknown;
};

export type DashboardRecord = {
  id: string;
  userId?: string;
  schemeId?: string;
  applicationId?: string;
  status?: string;
  type?: string;
  eventType?: string;
  description?: string;
  occurredAt?: unknown;
  message?: string;
  name?: string;
  nextAction?: string;
  schemeName?: string;
  label?: string;
  required?: boolean;
  completed?: boolean;
  documentType?: string;
  customDocumentName?: string;
  storagePath?: string;
  fileName?: string;
  verificationStatus?: string;
  verificationMessage?: string;
  documentTypeCheck?: string;
  detectedType?: string;
  documentRisk?: 'LOW' | 'MEDIUM' | 'HIGH' | 'UNASSESSED' | string;
  riskSignals?: string[];
  officialVerificationStatus?: string;
  contentHash?: string;
  mimeType?: string;
  fileSize?: number;
  ocrConfidence?: number;
  uploadedAt?: unknown;
  savedAt?: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
  category?: string;
  officialApplicationUrl?: string;
  applicationReference?: string;
  notes?: string;
  appliedDate?: unknown;
  lastUpdated?: unknown;
};

export type DashboardData = {
  profile: UserProfile | null;
  savedSchemes: DashboardRecord[];
  applications: DashboardRecord[];
  documents: DashboardRecord[];
  activities: DashboardRecord[];
  notifications: DashboardRecord[];
  schemes: Scheme[];
};

export type DashboardSubscription = {
  data: DashboardData;
  error: string | null;
  ready: boolean;
};

const emptyData = (): DashboardData => ({
  profile: null,
  savedSchemes: [],
  applications: [],
  documents: [],
  activities: [],
  notifications: [],
  schemes: [],
});

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function asRecord(id: string, data: DocumentData): DashboardRecord {
  return {
    id,
    userId: asString(data.userId),
    schemeId: asString(data.schemeId),
    applicationId: asString(data.applicationId),
    status: asString(data.status),
    type: asString(data.type),
    eventType: asString(data.eventType),
    description: asString(data.description),
    occurredAt: data.occurredAt,
    message: asString(data.message),
    name: asString(data.name) ?? asString(data.schemeName),
    nextAction: asString(data.nextAction),
    schemeName: asString(data.schemeName),
    label: asString(data.label),
    required: typeof data.required === 'boolean' ? data.required : undefined,
    completed: typeof data.completed === 'boolean' ? data.completed : undefined,
    documentType: asString(data.documentType) ?? asString(data.type) ?? asString(data.name),
    customDocumentName: asString(data.customDocumentName),
    storagePath: asString(data.storagePath),
    fileName: asString(data.fileName),
    verificationStatus: asString(data.verificationStatus),
    verificationMessage: asString(data.verificationMessage),
    documentTypeCheck: asString(data.documentTypeCheck),
    detectedType: asString(data.detectedType),
    documentRisk: asString(data.documentRisk),
    riskSignals: Array.isArray(data.riskSignals) ? data.riskSignals.filter((item): item is string => typeof item === 'string') : undefined,
    officialVerificationStatus: asString(data.officialVerificationStatus),
    contentHash: asString(data.contentHash),
    mimeType: asString(data.mimeType) ?? asString(data.contentType),
    fileSize: typeof data.fileSize === 'number'
      ? data.fileSize
      : typeof data.size === 'number'
        ? data.size
        : undefined,
    ocrConfidence: typeof data.ocrConfidence === 'number' ? data.ocrConfidence : undefined,
    uploadedAt: data.uploadedAt,
    savedAt: data.savedAt,
    createdAt: data.createdAt,
    updatedAt: data.updatedAt,
    category: asString(data.category),
    officialApplicationUrl: asString(data.officialApplicationUrl),
    applicationReference: asString(data.applicationReference),
    notes: asString(data.notes),
    appliedDate: data.appliedDate,
    lastUpdated: data.lastUpdated,
  };
}

function asScheme(id: string, data: DocumentData): Scheme | null {
  const name = asString(data.name) ?? asString(data.title);
  if (!name) return null;
  const category = asString(data.category) ?? 'Other';
  const stateText = asString(data.state) ?? asString(data.governmentLevel) ?? 'Central';
  const state: Scheme['state'] = /andhra/i.test(stateText) ? 'Andhra Pradesh' : 'Central';
  const eligibility = Array.isArray(data.eligibility) ? data.eligibility.filter((item): item is string => typeof item === 'string') : [];
  const rawRules = data.eligibilityRules;
  const eligibilityRules = typeof rawRules === 'object' && rawRules !== null
    ? rawRules as SchemeEligibilityRules
    : undefined;
  const rawDocuments = Array.isArray(data.requiredDocuments)
    ? data.requiredDocuments
    : Array.isArray(data.documents)
      ? data.documents
      : Array.isArray(eligibilityRules?.requiredDocuments)
        ? eligibilityRules.requiredDocuments
        : [];
  const documents = [...new Set(rawDocuments
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean))];
  const tags = Array.isArray(data.tags) ? data.tags.filter((item): item is string => typeof item === 'string') : [];
  return {
    id,
    name,
    category: canonicalSchemeCategory(category),
    state,
    short: asString(data.short) ?? asString(data.description) ?? 'Explore this scheme and review its official eligibility requirements.',
    benefit: asString(data.benefit) ?? 'Review the scheme details on the official source.',
    eligibility,
    eligibilityRules,
    eligibilityNeedsVerification: data.eligibilityNeedsVerification === true,
    documents,
    department: asString(data.department) ?? 'Government department',
    officialUrl: asString(data.officialUrl) ?? asString(data.sourceUrl) ?? 'https://www.myscheme.gov.in/',
    applicationUrl: asString(data.officialApplicationUrl) ?? asString(data.applicationUrl),
    applicationSteps: Array.isArray(data.applicationSteps)
      ? data.applicationSteps.filter((step): step is string => typeof step === 'string')
      : undefined,
    sourceUrl: asString(data.sourceUrl) ?? asString(data.officialUrl) ?? 'https://www.myscheme.gov.in/',
    verified: data.verified === true || data.verificationStatus === 'VERIFIED'
      ? 'Verified'
      : asString(data.verified) ?? 'Check official source',
    tags,
  };
}

function asProfile(data: DocumentData | undefined): UserProfile | null {
  if (!data) return null;
  return data as UserProfile;
}

export async function saveUserProfile(profile: UserProfile) {
  const { updateCurrentUserProfile } = await import('./userProfile');
  await updateCurrentUserProfile(profile);
}

export async function setUserDocument(name: string, completed: boolean, required: boolean) {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error('You must be signed in to update your document checklist.');
  const existing = await getDocs(query(
    collection(db, 'documents'),
    where('userId', '==', uid),
  ));
  const matching = existing.docs.filter((record) => record.data().name === name);
  if (!matching.length) {
    await addDoc(collection(db, 'documents'), {
      userId: uid,
      name,
      completed,
      required,
      status: completed ? 'completed' : 'pending',
      updatedAt: serverTimestamp(),
    });
    return;
  }
  await Promise.all(matching.map((record) => updateDoc(doc(db, 'documents', record.id), {
    completed,
    status: completed ? 'completed' : 'pending',
    updatedAt: serverTimestamp(),
  })));
}

export function subscribeToDashboard(
  uid: string,
  onChange: (subscription: DashboardSubscription) => void,
): Unsubscribe {
  const data = emptyData();
  const unsubscribers: Unsubscribe[] = [];
  const loaded = new Set<string>();
  const failed = new Map<string, string>();
  let legacySavedRecords: DashboardRecord[] = [];

  const mergeSavedRecords = (currentRecords: DashboardRecord[]) => {
    const records = [...currentRecords, ...legacySavedRecords];
    const seen = new Set<string>();
    data.savedSchemes = records.filter((record) => {
      const key = record.schemeId ?? record.id;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  };

  const publish = () => {
    const firstError = failed.values().next().value as string | undefined;
    onChange({
      data: { ...data },
      error: firstError ?? null,
      ready: loaded.size === 8,
    });
  };

  const subscribe = <T,>(
    key: string,
    listen: (success: (value: T) => void, failure: (error: Error) => void) => Unsubscribe,
    assign: (value: T) => void,
  ) => {
    const unsubscribe = listen(
      (value) => {
        assign(value);
        loaded.add(key);
        failed.delete(key);
        publish();
      },
      (error) => {
        failed.set(key, error.message);
        loaded.add(key);
        publish();
      },
    );
    unsubscribers.push(unsubscribe);
  };

  subscribe<UserProfile | null>(
    'profile',
    (success, failure) => onSnapshot(doc(db, 'users', uid), (snapshot) => success(asProfile(snapshot.data())), failure),
    (profile) => { data.profile = profile; },
  );
  subscribe<DashboardRecord[]>(
    'saved',
    (success, failure) => onSnapshot(query(collection(db, 'savedSchemes'), where('userId', '==', uid)), (snapshot) => success(snapshot.docs.map((item) => asRecord(item.id, item.data()))), failure),
    mergeSavedRecords,
  );
  subscribe<DashboardRecord[]>(
    'legacy-saved',
    (success, failure) => onSnapshot(collection(db, 'users', uid, 'savedSchemes'), (snapshot) => success(snapshot.docs.map((item) => asRecord(item.id, item.data()))), failure),
    (records) => {
      legacySavedRecords = records;
      mergeSavedRecords(data.savedSchemes);
    },
  );
  subscribe<DashboardRecord[]>(
    'applications',
    (success, failure) => onSnapshot(query(collection(db, 'applications'), where('userId', '==', uid)), (snapshot) => success(snapshot.docs.map((item) => asRecord(item.id, item.data()))), failure),
    (records) => { data.applications = records; },
  );
  subscribe<DashboardRecord[]>(
    'documents',
    (success, failure) => onSnapshot(query(collection(db, 'documents'), where('userId', '==', uid)), (snapshot) => success(snapshot.docs.map((item) => asRecord(item.id, item.data()))), failure),
    (records) => { data.documents = records; },
  );
  subscribe<DashboardRecord[]>(
    'activities',
    (success, failure) => onSnapshot(query(collection(db, 'activities'), where('userId', '==', uid)), (snapshot) => success(snapshot.docs.map((item) => asRecord(item.id, item.data()))), failure),
    (records) => { data.activities = records; },
  );
  subscribe<DashboardRecord[]>(
    'notifications',
    (success, failure) => onSnapshot(query(collection(db, 'notifications'), where('userId', '==', uid)), (snapshot) => success(snapshot.docs.map((item) => asRecord(item.id, item.data()))), failure),
    (records) => { data.notifications = records; },
  );
  subscribe<Scheme[]>(
    'schemes',
    (success, failure) => onSnapshot(collection(db, 'schemes'), (snapshot) => success(snapshot.docs.map((item) => asScheme(item.id, item.data())).filter((scheme): scheme is Scheme => scheme !== null)), failure),
    (records) => { data.schemes = records; },
  );

  return () => unsubscribers.forEach((unsubscribe) => unsubscribe());
}

export function getDashboardTimestamp(value: unknown): Date | null {
  if (value instanceof Date) return value;
  if (typeof value === 'object' && value !== null && 'toDate' in value && typeof value.toDate === 'function') {
    return value.toDate() as Date;
  }
  if (typeof value === 'string' || typeof value === 'number') {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  return null;
}
