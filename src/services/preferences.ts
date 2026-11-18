import {
  collection,
  doc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  writeBatch,
  type DocumentReference,
} from 'firebase/firestore';
import { auth, db } from '../lib/firebase';
import { redactConversationText } from './assistant';

export type SavedAssistantMessage = {
  role: 'user' | 'assistant';
  content: string;
};

export type SavedAssistantContext = {
  schemeIds: string[];
  applicationGuidance: { schemeId: string; step: number } | null;
};

function assertConversationOwner(uid: string): void {
  if (!uid || auth.currentUser?.uid !== uid) {
    throw new Error('You can only access your own assistant conversation history.');
  }
}

export async function loadLatestAssistantConversation(uid: string): Promise<{
  id: string | null;
  messages: SavedAssistantMessage[];
  context: SavedAssistantContext;
}> {
  assertConversationOwner(uid);
  const conversationsRef = collection(db, 'users', uid, 'conversations');
  const latest = await getDocs(query(conversationsRef, orderBy('updatedAt', 'desc'), limit(1)));
  const conversation = latest.docs[0];
  if (!conversation) {
    return {
      id: null,
      messages: [],
      context: { schemeIds: [], applicationGuidance: null },
    };
  }

  const savedMessages = await getDocs(query(
    collection(conversationsRef, conversation.id, 'messages'),
    orderBy('createdAt', 'asc'),
    limit(30),
  ));
  const rawContext = conversation.data();
  const rawGuidance = rawContext.applicationGuidance;
  const applicationGuidance = typeof rawGuidance?.schemeId === 'string'
    && Number.isInteger(rawGuidance.step)
    && rawGuidance.step >= 0
    ? { schemeId: rawGuidance.schemeId, step: rawGuidance.step as number }
    : null;
  return {
    id: conversation.id,
    context: {
      schemeIds: Array.isArray(rawContext.schemeIds)
        ? rawContext.schemeIds.filter((id: unknown): id is string => typeof id === 'string')
        : [],
      applicationGuidance,
    },
    messages: savedMessages.docs.flatMap((message) => {
      const data = message.data();
      return (data.role === 'user' || data.role === 'assistant') && typeof data.content === 'string'
        ? [{ role: data.role, content: data.content }]
        : [];
    }),
  };
}

export async function saveAssistantExchange(
  uid: string,
  conversationId: string | null,
  question: string,
  answer: string,
  context?: Partial<SavedAssistantContext>,
): Promise<string> {
  assertConversationOwner(uid);
  const conversationsRef = collection(db, 'users', uid, 'conversations');
  const conversationRef = conversationId
    ? doc(conversationsRef, conversationId)
    : doc(conversationsRef);
  const messagesRef = collection(conversationRef, 'messages');
  const userMessage = doc(messagesRef);
  const assistantMessage = doc(messagesRef);
  const batch = writeBatch(db);
  batch.set(conversationRef, {
    ...(conversationId ? {} : { createdAt: serverTimestamp() }),
    updatedAt: serverTimestamp(),
    ...(context?.schemeIds ? { schemeIds: context.schemeIds.slice(0, 10) } : {}),
    ...(context?.applicationGuidance !== undefined
      ? { applicationGuidance: context.applicationGuidance }
      : {}),
  }, { merge: true });
  batch.set(userMessage, { role: 'user', content: redactConversationText(question), createdAt: serverTimestamp() });
  batch.set(assistantMessage, { role: 'assistant', content: redactConversationText(answer), createdAt: serverTimestamp() });
  await batch.commit();
  return conversationRef.id;
}

export async function clearAssistantConversations(): Promise<number> {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error('Sign in before managing conversation history.');

  const conversationsRef = collection(db, 'users', uid, 'conversations');
  const conversations = await getDocs(conversationsRef);
  const messageReferences: DocumentReference[] = [];
  for (const conversation of conversations.docs) {
    const messages = await getDocs(collection(conversationsRef, conversation.id, 'messages'));
    messageReferences.push(...messages.docs.map((message) => message.ref));
  }

  const references = [
    ...messageReferences,
    ...conversations.docs.map((conversation) => conversation.ref),
  ];
  for (let index = 0; index < references.length; index += 450) {
    const batch = writeBatch(db);
    references.slice(index, index + 450).forEach((reference) => batch.delete(reference));
    await batch.commit();
  }
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('bharatsathi:assistant-history-cleared'));
  return conversations.size;
}
