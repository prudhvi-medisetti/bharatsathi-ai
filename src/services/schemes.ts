import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  query,
  serverTimestamp,
  where,
} from 'firebase/firestore';
import { db } from '../lib/firebase';

export async function saveScheme(userId: string, schemeId: string, schemeName: string) {
  const [existing, legacyExisting] = await Promise.all([
    getDocs(query(
    collection(db, 'savedSchemes'),
    where('userId', '==', userId),
    )),
    getDocs(collection(db, 'users', userId, 'savedSchemes')),
  ]);
  const existingSaved = existing.docs.find((item) => item.data().schemeId === schemeId)
    ?? legacyExisting.docs.find((item) => item.data().schemeId === schemeId);
  if (existingSaved) return existingSaved.id;
  const savedRecord = await addDoc(collection(db, 'savedSchemes'), {
    userId,
    schemeId,
    savedAt: serverTimestamp(),
    status: 'saved',
  });
  try {
    await addDoc(collection(db, 'activities'), {
      userId,
      schemeId,
      type: 'scheme_saved',
      message: `Saved ${schemeName}`,
      createdAt: serverTimestamp(),
    });
  } catch (error) {
    console.error('The scheme was saved, but its activity could not be recorded:', error);
  }
  return savedRecord.id;
}

export async function removeSavedScheme(userId: string, schemeId: string) {
  const [existing, legacyExisting] = await Promise.all([
    getDocs(query(collection(db, 'savedSchemes'), where('userId', '==', userId))),
    getDocs(collection(db, 'users', userId, 'savedSchemes')),
  ]);
  const matching = [
    ...existing.docs.filter((saved) => saved.data().schemeId === schemeId).map((saved) => doc(db, 'savedSchemes', saved.id)),
    ...legacyExisting.docs.filter((saved) => saved.data().schemeId === schemeId).map((saved) => doc(db, 'users', userId, 'savedSchemes', saved.id)),
  ];
  await Promise.all(matching.map((reference) => deleteDoc(reference)));
}
