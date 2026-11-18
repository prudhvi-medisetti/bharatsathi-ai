import {
  deleteUser,
  EmailAuthProvider,
  GoogleAuthProvider,
  reauthenticateWithCredential,
  reauthenticateWithPopup,
} from 'firebase/auth';
import { auth, googleProvider } from '../lib/firebaseApp';

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000').replace(/\/$/, '');

async function reauthenticateCurrentUser() {
  const user = auth.currentUser;
  if (!user) throw new Error('Sign in before deleting your account.');
  const providerIds = user.providerData.map((provider) => provider.providerId);

  if (providerIds.includes(EmailAuthProvider.PROVIDER_ID) && user.email) {
    const password = window.prompt('Enter your password to confirm account deletion.');
    if (!password) throw new Error('Account deletion was cancelled.');
    await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, password));
    return user;
  }
  if (providerIds.includes(GoogleAuthProvider.PROVIDER_ID)) {
    await reauthenticateWithPopup(user, googleProvider);
    return user;
  }
  throw new Error('For your security, sign in again using your account provider before deletion.');
}

export async function deleteCurrentAccountAndData(): Promise<void> {
  const user = await reauthenticateCurrentUser();
  const token = await user.getIdToken(true);
  const response = await fetch(`${API_BASE_URL}/api/v1/account/data`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    const payload = await response.json() as { detail?: unknown };
    throw new Error(
      typeof payload.detail === 'string'
        ? payload.detail
        : `Account data cleanup failed (${response.status}).`,
    );
  }
  await deleteUser(user);
}
