import {
  addDoc,
  collection,
  doc,
  serverTimestamp,
  updateDoc,
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import type { Scheme } from '../types';

export const applicationStatuses = [
  'Not Started',
  'Applied',
  'Documents Pending',
  'Under Review',
  'Approved',
  'Rejected',
  'Completed',
] as const;

export async function createApplication(uid: string, scheme: Pick<Scheme, 'id' | 'name' | 'category' | 'applicationUrl'>) {
  return addDoc(collection(db, 'applications'), {
    userId: uid,
    schemeId: scheme.id,
    schemeName: scheme.name,
    category: scheme.category,
    officialApplicationUrl: scheme.applicationUrl ?? '',
    appliedDate: null,
    applicationReference: '',
    status: 'Not Started',
    nextAction: 'Review eligibility and required documents.',
    notes: '',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    lastUpdated: serverTimestamp(),
  });
}

export type ApplicationUpdate = {
  status?: string;
  applicationReference?: string;
  notes?: string;
};

export async function updateApplication(applicationId: string, updates: ApplicationUpdate, setAppliedDate = false) {
  if (updates.status && !applicationStatuses.includes(updates.status as (typeof applicationStatuses)[number])) {
    throw new Error('Choose a valid application status.');
  }
  await updateDoc(doc(db, 'applications', applicationId), {
    ...updates,
    ...(setAppliedDate ? { appliedDate: serverTimestamp() } : {}),
    updatedAt: serverTimestamp(),
    lastUpdated: serverTimestamp(),
  });
}
