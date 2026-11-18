import { auth } from '../lib/firebaseApp';

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000').replace(/\/$/, '');

export type EmailChangeState =
  | 'none'
  | 'pending_old'
  | 'pending_new'
  | 'completed'
  | 'cancelled'
  | 'expired'
  | 'delivery_failed'
  | 'recovery_required'
  | 'updating'
  | 'unavailable';

export type EmailChangeStatus = {
  state: EmailChangeState;
  change_type?: 'standard' | 'recovery';
  new_email?: string;
  expires_in?: number;
};

export type RecoveryCodeStatus = {
  state: 'not_issued' | 'active' | 'reserved' | 'used' | 'expired' | 'locked' | 'unavailable';
  expires_in: number;
};

async function request<T>(
  path: string,
  body?: unknown,
  options: { authenticated?: boolean; method?: 'GET' | 'POST' } = {},
): Promise<T> {
  const headers: Record<string, string> = {};
  const authenticated = options.authenticated !== false;
  if (authenticated) {
    const user = auth.currentUser;
    if (!user) throw new Error('Sign in before managing your account email.');
    headers.Authorization = `Bearer ${await user.getIdToken()}`;
  }
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: options.method ?? 'POST',
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!response.ok) {
    const result = await response.json().catch(() => null) as { detail?: string } | null;
    throw new Error(result?.detail || `Email service returned ${response.status}.`);
  }
  return response.json() as Promise<T>;
}

export function getEmailChangeStatus(): Promise<EmailChangeStatus> {
  return request<EmailChangeStatus>('/api/v1/auth/email-change/status', undefined, {
    authenticated: true,
    method: 'GET',
  });
}

export function initiateEmailChange(newEmail: string): Promise<{ status: string; expires_in: number }> {
  return request('/api/v1/auth/email-change/initiate', { new_email: newEmail });
}

export function generateAccountRecoveryCode(): string {
  if (!globalThis.crypto?.getRandomValues) {
    throw new Error('Secure recovery-code generation is unavailable in this browser.');
  }
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export function registerAccountRecoveryCode(recoveryCode: string): Promise<{ status: string; expires_in: number }> {
  return request('/api/v1/auth/recovery-code', { recovery_code: recoveryCode });
}

export function getAccountRecoveryCodeStatus(): Promise<RecoveryCodeStatus> {
  return request('/api/v1/auth/recovery-code/status', undefined, { method: 'GET' });
}

export function initiateEmailRecovery(
  newEmail: string,
  recoveryCode: string,
): Promise<{ status: string; expires_in: number }> {
  return request('/api/v1/auth/email-change/recovery/initiate', {
    new_email: newEmail,
    recovery_code: recoveryCode.trim(),
  });
}

export function resendEmailChangeConfirmation(stage: 'old' | 'new'): Promise<{ status: string; stage: string; expires_in: number }> {
  return request('/api/v1/auth/email-change/resend', { stage });
}

export function cancelEmailChange(): Promise<{ status: string }> {
  return request('/api/v1/auth/email-change/cancel');
}

export function confirmOldEmailChange(token: string): Promise<{ status: string; next_step?: string }> {
  return request('/api/v1/auth/email-change/confirm-old', { token }, { authenticated: false });
}

export function confirmNewEmailChange(token: string): Promise<{ status: string; notification_status?: string }> {
  return request('/api/v1/auth/email-change/confirm-new', { token }, { authenticated: false });
}
