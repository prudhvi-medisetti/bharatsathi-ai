import { auth } from '../lib/firebaseApp';
import type { Scheme } from '../types';
import type { UserProfile } from './dashboard';
import { evaluateSchemeEligibility } from './eligibility';

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000').replace(/\/$/, '');

export type ChatMessage = { role: 'user' | 'assistant'; content: string };
export type ChatResult = {
  answer: string;
  language: string;
  scheme_ids: string[];
  mode: string;
  disclaimer: string;
};

export async function askBharatSathiAI(input: {
  message: string;
  language: string;
  profile?: UserProfile | null;
  schemes: Scheme[];
  history?: ChatMessage[];
}): Promise<ChatResult> {
  const token = auth.currentUser ? await auth.currentUser.getIdToken() : undefined;
  const groundedSchemes = input.schemes.map((scheme) => {
    const match = evaluateSchemeEligibility(scheme, input.profile, []);
    return {
      ...scheme,
      profileMatch: match.label,
      matchReasons: match.factors.map((factor) => `${factor.label}: ${factor.status}`),
    };
  });
  const response = await fetch(`${API_BASE_URL}/api/v1/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({
      message: input.message,
      language: input.language,
      profile: {},
      schemes: groundedSchemes,
      history: input.history ?? [],
    }),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(detail || `AI service returned ${response.status}`);
  }
  return response.json() as Promise<ChatResult>;
}

export async function checkAIGateway(): Promise<{ ok: boolean; geminiConfigured?: boolean; model?: string }> {
  try {
    const response = await fetch(`${API_BASE_URL}/health`, { signal: AbortSignal.timeout(3000) });
    if (!response.ok) return { ok: false };
    return { ok: true, ...(await response.json()) };
  } catch {
    return { ok: false };
  }
}
