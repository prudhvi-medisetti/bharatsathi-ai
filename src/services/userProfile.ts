import { z } from 'zod';
import { auth, db } from '../lib/firebase';
import {
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
} from 'firebase/firestore';
import type { UserProfile } from './dashboard';

const nameSchema = z.string().trim().min(2, 'Enter your full name.').max(100, 'Name must be 100 characters or fewer.');
const emailSchema = z.string().trim().email('Enter a valid email address.').transform((value) => value.toLowerCase());
const phoneSchema = z.string().trim()
  .refine((value) => !value || /^\+?[0-9\s()-]{8,18}$/.test(value), 'Enter a valid phone number.')
  .transform((value) => value.replace(/[\s()-]/g, ''))
  .refine((value) => !value || (value.replace(/\D/g, '').length >= 8 && value.replace(/\D/g, '').length <= 15), 'Enter a valid phone number.');
const dateOfBirthSchema = z.string().refine((value) => {
  if (!value) return true;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  const now = new Date();
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
    && !Number.isNaN(date.getTime())
    && date.getFullYear() === year
    && date.getMonth() === month - 1
    && date.getDate() === day
    && date <= now
    && date >= new Date(now.getFullYear() - 120, now.getMonth(), now.getDate());
}, 'Enter a valid date of birth.');
const annualIncomeSchema = z.number().finite().min(0, 'Income cannot be negative.').max(1_000_000_000, 'Enter a valid annual income.');

export const registrationProfileSchema = z.object({
  name: nameSchema,
  email: emailSchema,
  phone: z.union([phoneSchema, z.literal('')]).optional().default(''),
  dateOfBirth: dateOfBirthSchema.optional().default(''),
  gender: z.string().trim().max(40).optional().default(''),
  userType: z.string().trim().min(2).max(80).optional().default('General Citizen'),
  state: z.string().trim().min(2, 'Enter your state.').max(80),
  district: z.string().trim().max(80).optional().default(''),
  mandal: z.string().trim().max(100).optional().default(''),
  village: z.string().trim().max(100).optional().default(''),
  category: z.string().trim().max(80).optional().default(''),
  occupation: z.string().trim().max(100).optional().default(''),
  education: z.string().trim().max(120).optional().default(''),
  educationLevel: z.string().trim().max(120).optional().default(''),
  course: z.string().trim().max(120).optional().default(''),
  college: z.string().trim().max(160).optional().default(''),
  yearOfStudy: z.string().trim().max(40).optional().default(''),
  employmentStatus: z.string().trim().max(80).optional().default(''),
  isFarmer: z.boolean().optional(),
  landDetails: z.string().trim().max(500).optional().default(''),
  ownsBusiness: z.boolean().optional(),
  businessType: z.string().trim().max(120).optional().default(''),
  familySize: z.union([z.number().int().min(1).max(50), z.string().trim().max(3)]).optional(),
  disabilityStatus: z.string().trim().max(80).optional().default(''),
  annualIncome: z.union([
    annualIncomeSchema,
    z.string().trim().regex(/^\d+(?:\.\d{1,2})?$/, 'Enter a valid annual income.').transform(Number).pipe(annualIncomeSchema),
    z.literal(''),
  ]).optional().default(''),
});

const userProfileUpdateSchema = registrationProfileSchema.partial().extend({
  isFarmer: z.union([z.boolean(), z.literal('')]).optional(),
  ownsBusiness: z.union([z.boolean(), z.literal('')]).optional(),
  ageGroup: z.string().trim().max(80).optional(),
  dependents: z.union([z.number().int().min(0).max(50), z.string().trim().max(3)]).optional(),
  incomeRange: z.string().trim().max(120).optional(),
  age: z.union([z.number().int().min(0).max(120), z.string().trim().max(3)]).optional(),
  photoURL: z.string().url().optional(),
  language: z.string().trim().min(2).max(40).optional(),
  preferredLanguage: z.string().trim().min(2).max(40).optional(),
  voiceLanguage: z.string().trim().min(2).max(40).optional(),
  voiceAssistantEnabled: z.boolean().optional(),
  voiceInputEnabled: z.boolean().optional(),
  voiceResponsesEnabled: z.boolean().optional(),
  autoDetectVoiceLanguage: z.boolean().optional(),
  conversationHistoryEnabled: z.boolean().optional(),
  schemeNotificationsEnabled: z.boolean().optional(),
  eligibilityNotificationsEnabled: z.boolean().optional(),
  applicationNotificationsEnabled: z.boolean().optional(),
  applicationDecisionNotificationsEnabled: z.boolean().optional(),
  documentNotificationsEnabled: z.boolean().optional(),
  documentVerificationNotificationsEnabled: z.boolean().optional(),
  documentReminderEnabled: z.boolean().optional(),
  governmentAlertsEnabled: z.boolean().optional(),
  assistantNotificationsEnabled: z.boolean().optional(),
  aiPersonalizationEnabled: z.boolean().optional(),
});

export type RegistrationProfileInput = z.input<typeof registrationProfileSchema>;
export type ValidRegistrationProfile = z.output<typeof registrationProfileSchema>;
export type ProfileCompletionState = 'missing' | 'incomplete' | 'complete';

export class UserProfilePersistenceError extends Error {
  readonly firebaseCode?: string;

  constructor(
    message: string,
    readonly stage: 'auth' | 'validation' | 'read-before-write' | 'write' | 'read-after-write' | 'verification',
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'UserProfilePersistenceError';
    this.firebaseCode = getFirebaseErrorCode(cause);
  }
}

function getFirebaseErrorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) return undefined;
  const { code } = error;
  if (typeof code !== 'string') return undefined;
  const normalizedCode = code.startsWith('firestore/') ? code.slice('firestore/'.length) : code;
  return /^[a-z-]+$/.test(normalizedCode) ? normalizedCode : undefined;
}

export function isFirestorePermissionError(error: unknown): boolean {
  return getFirebaseErrorCode(error) === 'permission-denied';
}

const requiredProfileFields = [
  'name',
  'email',
  'state',
] as const;

const requiredProfileSchema = z.object({
  name: nameSchema,
  email: emailSchema,
  state: z.string().trim().min(2, 'Enter your state.').max(80),
});

export function isUserProfileComplete(profile: UserProfile | null | undefined): boolean {
  if (!profile) return false;
  const requiredValuesPresent = requiredProfileFields.every((field) => (
    typeof profile[field] === 'string' && profile[field].trim().length > 0
  ));
  const parsed = requiredProfileSchema.safeParse({
    name: profile.name,
    email: profile.email,
    state: profile.state,
  });
  return requiredValuesPresent && parsed.success && profile.profileCompleted === true;
}

export function getProfileCompletionState(profile: UserProfile | null | undefined, expectedUid?: string): ProfileCompletionState {
  if (!profile) return 'missing';
  if (expectedUid && profile.uid !== expectedUid) return 'incomplete';
  return isUserProfileComplete(profile) ? 'complete' : 'incomplete';
}

export async function saveRegistrationProfile(input: RegistrationProfileInput): Promise<UserProfile> {
  const currentUser = auth.currentUser;
  if (!currentUser?.uid) throw new UserProfilePersistenceError('You must be signed in to save your profile.', 'auth');

  const parsed = registrationProfileSchema.safeParse(input);
  if (!parsed.success) throw new UserProfilePersistenceError(parsed.error.issues[0]?.message ?? 'Check the registration details and try again.', 'validation');
  if (parsed.data.email !== currentUser.email?.trim().toLowerCase()) {
    throw new UserProfilePersistenceError('The email address must match your signed-in account.', 'validation');
  }

  const profileRef = doc(db, 'users', currentUser.uid);
  if (import.meta.env.DEV) {
    console.info('[PROFILE] Authenticated:', Boolean(auth.currentUser));
    console.info('[PROFILE] Authenticated UID:', auth.currentUser?.uid ?? 'none');
    console.info('[PROFILE] Reading user document:', `users/${currentUser.uid}`);
  }
  let existing;
  try {
    existing = await getDoc(profileRef);
  } catch (error) {
    throw new UserProfilePersistenceError('Could not check the existing profile. Verify Firestore access and try again.', 'read-before-write', error);
  }
  const payload = {
    ...parsed.data,
    uid: currentUser.uid,
    email: currentUser.email,
    profileCompleted: true,
    createdAt: existing.exists() ? existing.data().createdAt ?? serverTimestamp() : serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
  try {
    await setDoc(profileRef, payload, { merge: true });
  } catch (error) {
    throw new UserProfilePersistenceError('Could not write the profile. Check Firestore rules and App Check configuration.', 'write', error);
  }

  let saved;
  try {
    saved = await getDoc(profileRef);
  } catch (error) {
    throw new UserProfilePersistenceError('Profile was written, but could not be read back. Check Firestore rules and App Check configuration.', 'read-after-write', error);
  }
  if (!saved.exists()) throw new UserProfilePersistenceError('Profile save could not be verified. Please try again.', 'verification');
  const savedProfile = saved.data() as UserProfile;
  if (savedProfile.uid !== currentUser.uid || !isUserProfileComplete(savedProfile)) {
    throw new UserProfilePersistenceError('Your profile did not pass verification. Please review the required information and try again.', 'verification');
  }
  if (import.meta.env.DEV) console.info('[PROFILE] Profile saved and verified');
  return savedProfile;
}

export async function updateCurrentUserProfile(updates: UserProfile): Promise<void> {
  const currentUser = auth.currentUser;
  if (!currentUser?.uid) throw new Error('You must be signed in to update your profile.');

  const profileRef = doc(db, 'users', currentUser.uid);
  const snapshot = await getDoc(profileRef);
  if (!snapshot.exists()) throw new Error('Complete your BharatSathi registration before updating this profile.');
  const normalizedEmail = currentUser.email?.trim().toLowerCase() ?? '';
  if (updates.email && updates.email.trim().toLowerCase() !== normalizedEmail) {
    throw new Error('The email address must match your signed-in account.');
  }

  const validation = userProfileUpdateSchema.safeParse(updates);
  if (!validation.success) {
    throw new Error(validation.error.issues[0]?.message ?? 'Check your profile information and try again.');
  }
  await setDoc(profileRef, {
    ...updates,
    uid: currentUser.uid,
    email: normalizedEmail,
    profileCompleted: true,
    updatedAt: serverTimestamp(),
  }, { merge: true });
}

export async function getCurrentUserProfile(): Promise<UserProfile | null> {
  const currentUser = auth.currentUser;
  if (!currentUser?.uid) throw new Error('You must be signed in to read your profile.');
  const profilePath = `users/${currentUser.uid}`;
  if (import.meta.env.DEV) {
    console.info('[PROFILE] Authenticated:', true);
    console.info('[PROFILE] Authenticated UID:', currentUser.uid);
    console.info('[PROFILE] Reading user document:', profilePath);
  }
  const snapshot = await getDoc(doc(db, 'users', currentUser.uid));
  if (import.meta.env.DEV) {
    console.info(snapshot.exists() ? '[PROFILE] Profile document exists' : '[PROFILE] Profile document is missing');
  }
  return snapshot.exists() ? snapshot.data() as UserProfile : null;
}
