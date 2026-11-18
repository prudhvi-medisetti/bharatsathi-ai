import { getFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';
import { app } from './firebaseApp';

export { app, auth, googleProvider } from './firebaseApp';

export const db = getFirestore(app);
export const storage = getStorage(app);
