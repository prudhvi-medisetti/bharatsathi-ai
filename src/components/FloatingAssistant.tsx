import { Bot, FileText, MessageCircle, Mic, MicOff, Send, Square, Volume2, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { schemes as localSchemes } from '../data/schemes';
import { getAppLanguage, getLanguageCode, detectLanguageFromScript } from '../data/languages';
import { useAuth } from '../context/AuthContext';
import BrandLogo from './BrandLogo';
import { useDashboardData } from '../hooks/useDashboardData';
import { getAssistantReply, getAssistantWelcome } from '../services/assistant';
import { loadLatestAssistantConversation, saveAssistantExchange } from '../services/preferences';
import i18n from '../i18n';

type ConversationItem = { question: string; answer: string; schemeId?: string };
type RecognitionEvent = { results: ArrayLike<ArrayLike<{ transcript: string }>> };
type RecognitionErrorEvent = { error: string };
type BrowserSpeechRecognition = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((event: RecognitionEvent) => void) | null;
  onerror: ((event: RecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};
type SpeechRecognitionConstructor = new () => BrowserSpeechRecognition;
type SpeechWindow = Omit<Window, 'SpeechRecognition' | 'webkitSpeechRecognition'> & {
  SpeechRecognition?: SpeechRecognitionConstructor;
  webkitSpeechRecognition?: SpeechRecognitionConstructor;
};

const suggestions = [
  ['Find schemes', '/schemes'],
  ['Check eligibility', '/eligibility'],
  ['Complete profile', '/profile'],
  ['Upload documents', '/documents'],
  ['Track applications', '/applications'],
];

export default function FloatingAssistant() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { data } = useDashboardData();
  const location = useLocation();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [question, setQuestion] = useState('');
  const [conversation, setConversation] = useState<ConversationItem[]>([]);
  const [error, setError] = useState('');
  const [voiceState, setVoiceState] = useState<'idle' | 'listening' | 'processing' | 'speaking'>('idle');
  const conversationId = useRef<string | null>(null);
  const loadedConversationUid = useRef('');
  const recognition = useRef<BrowserSpeechRecognition | null>(null);
  const recentRequests = useRef<number[]>([]);
  const catalogue = data?.schemes.length ? data.schemes : localSchemes;
  const preferredLanguage = getLanguageCode(data?.profile?.preferredLanguage)
    ?? getLanguageCode(data?.profile?.language)
    ?? getLanguageCode(i18n.resolvedLanguage)
    ?? 'en';
  const voiceLanguage = getLanguageCode(data?.profile?.voiceLanguage) ?? preferredLanguage;
  const historyEnabled = data?.profile?.conversationHistoryEnabled !== false;
  const assistantEnabled = data?.profile?.voiceAssistantEnabled !== false;
  const voiceInputEnabled = data?.profile?.voiceInputEnabled !== false;
  const voiceResponsesEnabled = data?.profile?.voiceResponsesEnabled !== false;
  const autoDetectVoiceLanguage = data?.profile?.autoDetectVoiceLanguage !== false;
  const currentSchemeId = location.pathname.startsWith('/schemes/')
    ? location.pathname.slice('/schemes/'.length)
    : '';
  const activeScheme = catalogue.find((scheme) => scheme.id === currentSchemeId);

  useEffect(() => {
    if (!open || !user || !historyEnabled || loadedConversationUid.current === user.uid) return;
    loadedConversationUid.current = user.uid;
    void loadLatestAssistantConversation(user.uid).then((saved) => {
      conversationId.current = saved.id;
      const restored: ConversationItem[] = [];
      for (let index = 0; index < saved.messages.length - 1; index += 2) {
        const prompt = saved.messages[index];
        const answer = saved.messages[index + 1];
        if (prompt?.role === 'user' && answer?.role === 'assistant') {
          restored.push({ question: prompt.content, answer: answer.content });
        }
      }
      setConversation(restored.slice(-10));
    }).catch((loadError: unknown) => {
      console.error('Unable to load assistant conversation history:', loadError);
      setError(t('Conversation history could not be loaded. You can continue with a new conversation.'));
    });
  }, [historyEnabled, open, t, user]);

  useEffect(() => () => {
    recognition.current?.abort();
    window.speechSynthesis?.cancel();
  }, []);

  const speak = useCallback((text: string, languageCode: string) => {
    if (!voiceResponsesEnabled || !('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    const language = getAppLanguage(languageCode);
    const voices = window.speechSynthesis.getVoices();
    const voice = voices.find((candidate) => candidate.lang.toLocaleLowerCase() === language.locale.toLocaleLowerCase())
      ?? voices.find((candidate) => candidate.lang.toLocaleLowerCase().startsWith(`${language.code}-`));
    utterance.lang = voice?.lang ?? language.locale;
    if (voice) utterance.voice = voice;
    utterance.onstart = () => setVoiceState('speaking');
    utterance.onend = () => setVoiceState('idle');
    utterance.onerror = () => setVoiceState('idle');
    window.speechSynthesis.speak(utterance);
  }, [voiceResponsesEnabled]);

  const closeAssistant = () => {
    recognition.current?.abort();
    recognition.current = null;
    window.speechSynthesis?.cancel();
    setVoiceState('idle');
    setOpen(false);
  };

  const toggleAssistant = () => {
    if (open) {
      closeAssistant();
      return;
    }
    setOpen(true);
    speak(getAssistantWelcome(voiceLanguage), voiceLanguage);
  };

  const submitQuestion = useCallback(async (prompt: string, detectedLanguage = voiceLanguage) => {
    const text = prompt.trim().slice(0, 500);
    if (!text || !user) return;
    const now = Date.now();
    recentRequests.current = recentRequests.current.filter((timestamp) => now - timestamp < 60_000);
    if (recentRequests.current.length >= 12) {
      setError(t('Please wait a moment before asking another question.'));
      return;
    }
    recentRequests.current.push(now);
    setVoiceState('processing');
    setError('');

    const responseLanguage = autoDetectVoiceLanguage
      ? detectLanguageFromScript(text, detectedLanguage)
      : voiceLanguage;
    try {
      const previousSchemeId = conversation.at(-1)?.schemeId;
      const reply = getAssistantReply(text, {
        path: location.pathname,
        profile: data?.profile,
        documents: data?.documents ?? [],
        applications: data?.applications ?? [],
        schemes: catalogue,
        activeScheme,
        previousSchemeId,
        language: responseLanguage,
      });
      setConversation((items) => [...items, { question: text, answer: reply.text, schemeId: reply.schemeId }].slice(-10));
      setQuestion('');
      if (historyEnabled) {
        try {
          conversationId.current = await saveAssistantExchange(user.uid, conversationId.current, text, reply.text);
        } catch (saveError) {
          console.error('Unable to save assistant conversation history:', saveError);
          setError(t('Your reply is ready, but conversation history could not be saved.'));
        }
      }
      if (voiceResponsesEnabled) speak(reply.text, responseLanguage);
      else setVoiceState('idle');
    } catch (replyError) {
      console.error('The source-based assistant could not prepare a response:', replyError);
      setError(t('Voice assistance is temporarily unavailable. You can continue using the text assistant.'));
      setVoiceState('idle');
    }
  }, [
    activeScheme,
    autoDetectVoiceLanguage,
    catalogue,
    conversation,
    data?.applications,
    data?.documents,
    data?.profile,
    historyEnabled,
    location.pathname,
    speak,
    t,
    user,
    voiceLanguage,
    voiceResponsesEnabled,
  ]);

  const answerQuestion = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void submitQuestion(question, voiceLanguage);
  };

  const startListening = () => {
    if (!voiceInputEnabled || voiceState === 'listening' || !user) return;
    const speechWindow = window as SpeechWindow;
    const SpeechRecognition = speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setError(t('Voice input is not supported in this browser. You can type your question instead.'));
      return;
    }

    window.speechSynthesis?.cancel();
    const instance = new SpeechRecognition();
    instance.lang = getAppLanguage(voiceLanguage).locale;
    instance.interimResults = false;
    instance.continuous = false;
    instance.onresult = (event) => {
      const transcript = event.results[0]?.[0]?.transcript?.trim();
      if (!transcript) {
        setVoiceState('idle');
        setError(t('I could not hear that clearly. Please try again.'));
        return;
      }
      setQuestion(transcript);
      const detected = autoDetectVoiceLanguage ? detectLanguageFromScript(transcript, voiceLanguage) : voiceLanguage;
      void submitQuestion(transcript, detected);
    };
    instance.onerror = () => {
      setVoiceState('idle');
      setError(t('I could not hear that clearly. Please try again.'));
    };
    instance.onend = () => {
      setVoiceState((current) => current === 'listening' ? 'idle' : current);
      recognition.current = null;
    };
    recognition.current = instance;
    setError('');
    setVoiceState('listening');
    try {
      instance.start();
    } catch {
      recognition.current = null;
      setVoiceState('idle');
      setError(t('Voice input could not be completed. Please try typing your question.'));
    }
  };

  const stopSpeaking = () => {
    window.speechSynthesis?.cancel();
    setVoiceState('idle');
  };

  if (!user || !assistantEnabled) return null;

  const statusText = voiceState === 'listening'
    ? t('Listening…')
    : voiceState === 'processing'
      ? t('Checking verified scheme information…')
      : voiceState === 'speaking'
        ? t('BharatSathi is speaking…')
        : t('Ask a question or tap the microphone.');

  return (
    <div className="voice-assistant-dock">
      {open && <section className="voice-assistant-panel" aria-label={t('BharatSathi assistant')} aria-live="polite">
        <header className="voice-assistant-header">
          <div className="voice-assistant-brand">
            <BrandLogo className="voice-assistant-mark" />
            <span><strong>{t('BharatSathi AI')}</strong><small>{t('Your government benefits guide')}</small></span>
          </div>
          <button type="button" className="voice-assistant-close" onClick={closeAssistant} aria-label={t('Close assistant')}><X size={18} /></button>
        </header>
        <div className="voice-assistant-content">
          <p className="voice-assistant-welcome">{t('Namaste {{name}}. I can help you explore scheme information and structured eligibility matches.', {
            name: data?.profile?.name?.split(' ')[0] || user.displayName?.split(' ')[0] || t('there'),
          })}</p>
          <p className={`voice-assistant-status voice-state-${voiceState}`} role="status">
            {voiceState === 'speaking' ? <Volume2 size={15} /> : voiceState === 'listening' ? <Mic size={15} /> : <Bot size={15} />}
            {statusText}
          </p>
          {!conversation.length && <div className="voice-assistant-suggestions">
            <strong>{t('Suggested questions')}</strong>
            {[['Find schemes for me', 'Find schemes'], ['Check my eligibility', 'Check eligibility'], ['What documents do I need?', 'What documents do I need?']].map(([label, prompt]) => (
              <button type="button" key={label} onClick={() => void submitQuestion(prompt, voiceLanguage)}>{t(label)}</button>
            ))}
          </div>}
          <div className="voice-assistant-messages" aria-live="polite">
            {conversation.map((item, index) => <article className="voice-assistant-exchange" key={`${index}-${item.question}`}>
              <p className="voice-assistant-user-message">{item.question}</p>
              <p className="voice-assistant-answer">{item.answer}</p>
              {item.schemeId && <Link to={`/schemes/${item.schemeId}`} onClick={() => setOpen(false)}><FileText size={13} />{t('View scheme source')}</Link>}
            </article>)}
          </div>
        </div>
        {error && <p className="voice-assistant-error" role="alert">{error}</p>}
        <div className="voice-assistant-controls">
          <button type="button" className={`voice-assistant-mic ${voiceState === 'listening' ? 'voice-assistant-mic-active' : ''}`} onClick={voiceState === 'listening' ? () => recognition.current?.stop() : startListening} disabled={!voiceInputEnabled || voiceState === 'processing' || voiceState === 'speaking'} aria-label={voiceState === 'listening' ? t('Stop listening') : t('Start voice question')} title={voiceInputEnabled ? t('Tap to speak') : t('Voice input is turned off in Settings')}>
            {voiceState === 'listening' ? <MicOff size={23} /> : <Mic size={23} />}
          </button>
          <span>{voiceState === 'listening' ? t('Listening…') : t('Tap to speak')}</span>
          {voiceState === 'speaking' && <button type="button" className="voice-assistant-stop-speaking" onClick={stopSpeaking}><Square size={13} />{t('Stop speaking')}</button>}
        </div>
        <form onSubmit={answerQuestion} className="voice-assistant-input">
          <input value={question} maxLength={500} onChange={(event) => { setQuestion(event.target.value); setError(''); }} placeholder={t('Ask a question…')} aria-label={t('Ask BharatSathi')} />
          <button type="submit" disabled={!question.trim() || voiceState === 'processing'} aria-label={t('Send question')}><Send size={16} /></button>
        </form>
        <footer className="voice-assistant-footer">
          <span><Volume2 size={13} />{voiceResponsesEnabled ? t('Voice responses on') : t('Voice responses off')}</span>
          <small>{t('Guidance uses available scheme records. Final eligibility is determined by the relevant government authority.')}</small>
        </footer>
      </section>}
      <button type="button" onClick={toggleAssistant} className="voice-assistant-launcher" aria-label={t(open ? 'Close assistant' : 'Open BharatSathi assistant')} aria-expanded={open}>
        {open ? <X size={23} /> : <MessageCircle size={23} />}
        <span aria-hidden="true" />
      </button>
    </div>
  );
}
