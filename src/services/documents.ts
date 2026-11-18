import {
  collection,
  deleteDoc,
  doc,
  setDoc,
  serverTimestamp,
  writeBatch,
} from 'firebase/firestore';
import {
  deleteObject,
  getMetadata,
  ref,
  uploadBytesResumable,
} from 'firebase/storage';
import { auth, db, storage } from '../lib/firebase';
import type { DocumentImageCheck } from './documentRecognition';

export const documentCategories = [
  'Aadhaar Card',
  'PAN Card',
  'Income Certificate',
  'Caste Certificate',
  'Residence Certificate',
  'Domicile Certificate',
  'Birth Certificate',
  'Community Certificate',
  'EWS Certificate',
  'Disability Certificate',
  'Education Certificate',
  'Marks Memo',
  'Bonafide Certificate',
  'College ID',
  'Student ID',
  'Bank Account / Passbook',
  'Land Record',
  'Property Document',
  'Ration Card',
  'Driving License',
  'Passport',
  'Voter ID',
  'Employment Certificate',
  'Experience Certificate',
  'Other',
] as const;

const MAX_FILE_SIZE = 10 * 1024 * 1024;
const STORAGE_UPLOAD_STALL_TIMEOUT_MS = 30_000;
const allowedTypes = new Set(['application/pdf', 'image/jpeg', 'image/png']);

export async function hashDocumentFile(file: File): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function validateFileSignature(file: File) {
  const bytes = new Uint8Array(await file.slice(0, 1024).arrayBuffer());
  const extension = file.name.split('.').pop()?.toLowerCase();
  const validExtension = file.type === 'application/pdf'
    ? extension === 'pdf'
    : file.type === 'image/jpeg'
      ? extension === 'jpg' || extension === 'jpeg'
      : extension === 'png';
  if (!validExtension) throw new Error('The file extension does not match its selected file type.');

  const isPdf = file.type === 'application/pdf'
    && new TextDecoder().decode(bytes).includes('%PDF-');
  const isJpeg = file.type === 'image/jpeg' && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const isPng = file.type === 'image/png'
    && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
    && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a;
  if (!isPdf && !isJpeg && !isPng) throw new Error('The file contents do not match a supported PDF, JPEG, or PNG.');
}

export async function uploadCitizenDocument(
  file: File,
  documentType: string,
  assessmentPromise: Promise<DocumentImageCheck>,
  options: {
    customDocumentName?: string;
    application?: {
      applicationId: string;
      schemeId: string;
      schemeName: string;
    };
    existingContentHashes?: readonly string[];
    onProgress?: (progress: number) => void;
    onStorageComplete?: () => void;
  },
) {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error('Sign in before uploading a document to your private vault.');
  if (!documentType.trim() || (documentType === 'Other' && !options.customDocumentName?.trim())) {
    throw new Error(documentType === 'Other' ? 'Enter a document name.' : 'Choose a document type.');
  }
  if (options.application && (
    !options.application.applicationId
    || options.application.applicationId.includes('/')
    || !options.application.schemeId
    || options.application.schemeId.includes('/')
    || !options.application.schemeName.trim()
  )) {
    throw new Error('Choose a valid application or select None.');
  }
  if (!allowedTypes.has(file.type)) {
    throw new Error('Only PDF, JPG and PNG files are supported.');
  }
  if (file.size > MAX_FILE_SIZE) {
    throw new Error('Maximum file size is 10 MB.');
  }
  if (!file.name.trim() || file.name.length > 255) {
    throw new Error('Choose a file with a valid name (255 characters or fewer).');
  }
  await validateFileSignature(file);

  const documentRef = doc(collection(db, 'documents'));
  const documentId = documentRef.id;
  const cleanFileName = file.name
    .replace(/[^\w.-]/g, '_')
    .replace(/_+/g, '_')
    .slice(0, 200);
  if (!cleanFileName || cleanFileName === '.' || cleanFileName === '..') {
    throw new Error('Choose a file with a valid name.');
  }
  const storagePath = `users/${uid}/documents/${documentId}/${cleanFileName}`;
  const storageReference = ref(storage, storagePath);
  const contentHash = await hashDocumentFile(file);
  const uploadTask = uploadBytesResumable(storageReference, file, {
    contentType: file.type,
    customMetadata: {
      ownerUid: uid,
      documentId,
      ...(options.application ? {
        applicationId: options.application.applicationId,
        schemeId: options.application.schemeId,
      } : {}),
    },
  });
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    let bytesTransferred = 0;
    let unsubscribe: (() => void) | undefined;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const onStall = () => {
      if (settled) return;
      settled = true;
      unsubscribe?.();
      uploadTask.cancel();
      reject(new Error('The upload did not reach Firebase Storage within 30 seconds. Confirm the default Storage bucket exists and is linked to this project, then check the Storage rules and connection.'));
    };
    const resetStallTimeout = () => {
      if (timeoutId) clearTimeout(timeoutId);
      timeoutId = setTimeout(onStall, STORAGE_UPLOAD_STALL_TIMEOUT_MS);
    };
    resetStallTimeout();
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      if (timeoutId) clearTimeout(timeoutId);
      unsubscribe?.();
      if (error) reject(error);
      else resolve();
    };
    unsubscribe = uploadTask.on(
      'state_changed',
      (snapshot) => {
        if (settled) return;
        if (snapshot.bytesTransferred > bytesTransferred) {
          bytesTransferred = snapshot.bytesTransferred;
          resetStallTimeout();
        }
        if (bytesTransferred > 0 && snapshot.totalBytes > 0) {
          const progress = Math.min(99, Math.floor((snapshot.bytesTransferred / snapshot.totalBytes) * 100));
          options.onProgress?.(progress);
        }
      },
      (error) => finish(error),
      () => finish(),
    );
  });

  let storedMetadata: Awaited<ReturnType<typeof getMetadata>>;
  try {
    storedMetadata = await getMetadata(storageReference);
    if (storedMetadata.size !== file.size || storedMetadata.contentType !== file.type) {
      throw new Error('The uploaded file could not be confirmed in Firebase Storage.');
    }
  } catch (error) {
    await deleteObject(storageReference).catch((cleanupError: unknown) => {
      console.error('Unable to remove a file whose Firebase Storage upload could not be confirmed:', cleanupError);
    });
    throw error;
  }

  options.onStorageComplete?.();
  const assessment = await assessmentPromise;
  const status = assessment.status === 'mismatch'
    ? 'NEEDS_REUPLOAD'
    : assessment.status === 'uncertain' || assessment.status === 'skipped'
      ? 'NEEDS_REVIEW'
      : 'UPLOADED';
  const duplicateHash = options.existingContentHashes?.includes(contentHash) ?? false;
  const riskSignals = [
    ...assessment.riskSignals,
    ...(duplicateHash ? ['DUPLICATE_FILE_CONTENT'] : []),
  ].slice(0, 12);

  try {
    await setDoc(documentRef, {
      userId: uid,
      documentId,
      ...(options.application ? {
        applicationId: options.application.applicationId,
        schemeId: options.application.schemeId,
        schemeName: options.application.schemeName.slice(0, 160),
      } : {}),
      documentType,
      ...(documentType === 'Other' ? { customDocumentName: options.customDocumentName?.trim().slice(0, 120) } : {}),
      fileName: cleanFileName,
      mimeType: storedMetadata.contentType,
      fileSize: storedMetadata.size,
      contentType: storedMetadata.contentType,
      size: storedMetadata.size,
      contentHash,
      storagePath,
      documentTypeCheck: assessment.status.toUpperCase(),
      ...(assessment.confidence !== undefined ? { ocrConfidence: assessment.confidence } : {}),
      structureSignals: assessment.structureSignals,
      documentRisk: duplicateHash ? 'MEDIUM' : assessment.riskLevel,
      riskSignals,
      officialVerificationStatus: 'UNAVAILABLE',
      uploadedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      status,
      verificationStatus: 'PENDING',
      verificationMessage: assessment.status === 'mismatch'
        ? 'The file may not match the selected document type and needs re-upload.'
        : assessment.status === 'uncertain' || assessment.status === 'skipped'
          ? 'Automated checks could not assess this file; manual review is needed.'
          : 'The file was stored successfully. Authenticity has not been independently verified.',
      storageConsent: true,
    });
    options.onProgress?.(100);
  } catch (error) {
    console.error('Firebase Storage upload succeeded, but the Firestore document record could not be saved:', error);
    try {
      await deleteObject(storageReference);
    } catch (cleanupError) {
      console.error('Unable to remove the uploaded file after its Firestore record failed:', cleanupError);
      throw new Error(`The file uploaded to Firebase Storage, but its document record could not be saved and the file could not be removed. Contact support with document ID ${documentId}.`);
    }
    throw new Error('The file reached Firebase Storage, but its document record could not be saved. The unrecorded file was removed; please try again.');
  }
  return { documentId, status, storagePath };
}

export async function confirmDocumentInformation(documentId: string, profileUpdates: Record<string, string>) {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error('Sign in before confirming document information.');
  const updates = Object.fromEntries(
    Object.entries(profileUpdates).filter(([, value]) => value.trim().length > 0),
  );
  if (!Object.keys(updates).length) throw new Error('Enter at least one profile value to confirm.');

  const batch = writeBatch(db);
  batch.set(doc(db, 'users', uid), {
    ...updates,
    uid,
    updatedAt: serverTimestamp(),
  }, { merge: true });
  await batch.commit();
}

export async function removeCitizenDocument(documentId: string, storagePath: string) {
  await deleteObject(ref(storage, storagePath));
  await deleteDoc(doc(db, 'documents', documentId));
}
