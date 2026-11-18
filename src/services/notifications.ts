import { auth } from '../lib/firebaseApp';

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000').replace(/\/$/, '');

async function requestApi<T>(path: string, body?: unknown): Promise<T> {
  const user = auth.currentUser;
  if (!user) throw new Error('Sign in before requesting a document or application notification.');

  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${await user.getIdToken()}`,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!response.ok) {
    const result = await response.json().catch(() => null) as { detail?: string } | null;
    throw new Error(result?.detail || `Notification service returned ${response.status}.`);
  }
  return response.json() as Promise<T>;
}

export async function emailDocumentAccessPin(documentId: string): Promise<void> {
  await requestApi<{ status: string }>(`/api/v1/documents/${encodeURIComponent(documentId)}/access-pin`);
}

export async function emailDocumentUploadNotification(documentId: string): Promise<string> {
  const result = await requestApi<{ status: string }>(
    `/api/v1/documents/${encodeURIComponent(documentId)}/notify-upload`,
  );
  return result.status;
}

export async function getSecureDocumentDownloadUrl(documentId: string, pin: string): Promise<string> {
  const result = await requestApi<{ download_url: string }>(
    `/api/v1/documents/${encodeURIComponent(documentId)}/download-url`,
    { pin },
  );
  if (!result.download_url) throw new Error('The secure download service did not return a link.');
  return result.download_url;
}

export async function emailApplicationStatusUpdate(applicationId: string): Promise<void> {
  await requestApi<{ status: string }>(`/api/v1/applications/${encodeURIComponent(applicationId)}/notify-status`);
}
