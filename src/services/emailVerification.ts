import type { User } from 'firebase/auth';

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000').replace(/\/$/, '');
const RESEND_COOLDOWN_SECONDS = 60;

function cooldownStorageKey(uid: string): string {
  return `bharatsathi:email-verification-resend:${uid}`;
}

export function getEmailVerificationCooldownSeconds(user: Pick<User, 'uid'> | null): number {
  if (!user || typeof window === 'undefined') return 0;
  const key = cooldownStorageKey(user.uid);
  let storedValue: string | null;
  try {
    storedValue = window.localStorage.getItem(key);
  } catch (error) {
    console.warn('Could not read the verification email cooldown from browser storage:', error);
    return 0;
  }
  const availableAt = Number(storedValue);
  if (!Number.isFinite(availableAt) || availableAt <= Date.now()) {
    try {
      window.localStorage.removeItem(key);
    } catch (error) {
      console.warn('Could not clear the expired verification email cooldown:', error);
    }
    return 0;
  }
  return Math.ceil((availableAt - Date.now()) / 1000);
}

function startCooldown(user: Pick<User, 'uid'>, seconds = RESEND_COOLDOWN_SECONDS): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(cooldownStorageKey(user.uid), String(Date.now() + seconds * 1000));
  } catch (error) {
    console.warn('Could not save the verification email cooldown in browser storage:', error);
  }
}

export async function sendBharatSathiVerificationEmail(user: User): Promise<'custom'> {
  const remaining = getEmailVerificationCooldownSeconds(user);
  if (remaining > 0) {
    throw new Error(`You can request another verification email in ${remaining} seconds.`);
  }

  const token = await user.getIdToken();
  const response = await fetch(`${API_BASE_URL}/api/v1/auth/verification-email`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { detail?: string } | null;
    if (response.status === 429) {
      const waitSeconds = Number(body?.detail?.match(/\d+/)?.[0]) || RESEND_COOLDOWN_SECONDS;
      startCooldown(user, waitSeconds);
    }
    throw new Error(body?.detail || `Branded verification email delivery failed (${response.status}).`);
  }

  const result = await response.json() as { status?: string };
  if (result.status !== 'sent') {
    throw new Error('The branded verification email service did not confirm delivery.');
  }
  startCooldown(user);
  return 'custom';
}
