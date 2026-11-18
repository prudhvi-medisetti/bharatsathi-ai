import { ArrowRight, ArrowUpRight, Bot, ImagePlus, Mic, Send, ShieldCheck, Sparkles, Volume2, Square, X } from 'lucide-react';
import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router-dom';
import { schemes } from '../data/schemes';
import { useAuth } from '../context/AuthContext';
import { useDashboardData } from '../hooks/useDashboardData';
import { getSchemeRecommendations } from '../services/schemeCategories';
import { appLanguages, detectLanguageFromScript, getAppLanguage, getLanguageCode } from '../data/languages';
import { askBharatSathiAI, type ChatMessage } from '../services/aiGateway';
import { getAssistantWelcome } from '../services/assistant';
import { loadLatestAssistantConversation, saveAssistantExchange } from '../services/preferences';
import {
  applicationGuidanceSteps,
  getApplicationQuestionReply,
  getApplicationStepMessage,
  getApplicationVoiceMessage,
  getScreenshotGuidanceReply,
  isApplicationStartIntent,
  isApplicationStepConfirmation,
  sanitizeScreenshotText,
} from '../services/applicationGuidance';

export default function Assistant() {
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const [question, setQuestion] = useState(searchParams.get('prompt') ?? '');
  const [answers, setAnswers] = useState<{ question: string; request?: string; answer: string; schemeIds?: string[] }[]>([]);
  const [loading, setLoading] = useState(false);
  const [voiceState, setVoiceState] = useState<'idle' | 'listening' | 'speaking'>('idle');
  const [voiceError, setVoiceError] = useState('');
  const [applicationGuidance, setApplicationGuidance] = useState<{ schemeId: string; step: number } | null>(null);
  const [screenText, setScreenText] = useState('');
  const [recognizingScreen, setRecognizingScreen] = useState(false);
  const [screenError, setScreenError] = useState('');
  const recognitionRef = useRef<any>(null);
  const screenshotInputRef = useRef<HTMLInputElement>(null);
  const { profile, user } = useAuth();
  const { data } = useDashboardData();
  const conversationId = useRef<string | null>(null);
  const loadedConversationUid = useRef('');
  const conversationLoad = useRef<Promise<void>>(Promise.resolve());
  const conversationSaveQueue = useRef<Promise<void>>(Promise.resolve());
  const [selectedLanguageOverride, setSelectedLanguageOverride] = useState<string | null>(null);
  const selectedLanguage = selectedLanguageOverride
    ?? getLanguageCode(data?.profile?.voiceLanguage)
    ?? getLanguageCode(profile?.voiceLanguage)
    ?? getLanguageCode(data?.profile?.preferredLanguage)
    ?? getLanguageCode(profile?.preferredLanguage)
    ?? 'en';
  const voiceWelcomePlayed = useRef(false);
  const catalogue = data?.schemes.length ? data.schemes : schemes;
  const profileContext = data?.profile ?? profile;
  const conversationHistoryEnabled = (data?.profile?.conversationHistoryEnabled
    ?? profile?.conversationHistoryEnabled) !== false;
  const recommendedSchemes = getSchemeRecommendations(catalogue, profileContext).map(({ scheme }) => scheme);
  const recommendedIds = new Set(recommendedSchemes.map((scheme) => scheme.id));
  const assistantSchemes = [...recommendedSchemes, ...catalogue.filter((scheme) => !recommendedIds.has(scheme.id))];
  const guidedScheme = applicationGuidance
    ? assistantSchemes.find((scheme) => scheme.id === applicationGuidance.schemeId)
    : undefined;

  useEffect(() => {
    const prompt = searchParams.get('prompt');
    if (prompt) setQuestion(prompt);
  }, [searchParams]);

  useEffect(() => {
    if (!user?.uid) {
      loadedConversationUid.current = '';
      conversationId.current = null;
      setAnswers([]);
      setApplicationGuidance(null);
      return;
    }
    if (!conversationHistoryEnabled || loadedConversationUid.current === user.uid) return;
    loadedConversationUid.current = user.uid;
    let active = true;
    conversationLoad.current = loadLatestAssistantConversation(user.uid).then((saved) => {
      if (!active) return;
      conversationId.current = saved.id;
      const restored: typeof answers = [];
      for (let index = 0; index + 1 < saved.messages.length; index += 2) {
        const prompt = saved.messages[index];
        const answer = saved.messages[index + 1];
        if (prompt.role === 'user' && answer.role === 'assistant') {
          restored.push({
            question: prompt.content,
            request: prompt.content,
            answer: answer.content,
          });
        }
      }
      const lastAnswer = restored[restored.length - 1];
      if (lastAnswer) lastAnswer.schemeIds = saved.context.schemeIds;
      setAnswers(restored.slice(-10));
      setApplicationGuidance(saved.context.applicationGuidance);
    }).catch((error: unknown) => {
      console.error('Unable to restore assistant context:', error);
      if (active) setVoiceError(t('Conversation context could not be restored. You can continue with a new conversation.'));
    });
    return () => { active = false; };
  }, [conversationHistoryEnabled, t, user?.uid]);

  const persistExchange = (
    questionText: string,
    answerText: string,
    schemeIds: string[] = [],
    guidance: { schemeId: string; step: number } | null = applicationGuidance,
  ) => {
    if (!user?.uid || !conversationHistoryEnabled) return;
    conversationSaveQueue.current = conversationSaveQueue.current
      .then(async () => {
        await conversationLoad.current;
        conversationId.current = await saveAssistantExchange(
          user.uid,
          conversationId.current,
          questionText,
          answerText,
          { schemeIds, applicationGuidance: guidance },
        );
      })
      .catch((error: unknown) => {
        console.error('Unable to save assistant context:', error);
        setVoiceError(t('Your response is ready, but conversation context could not be saved.'));
      });
  };

  const startApplicationGuidance = (scheme: (typeof assistantSchemes)[number], language = selectedLanguage) => {
    const answer = getApplicationStepMessage(scheme, 0, data?.documents ?? [], language);
    setApplicationGuidance({ schemeId: scheme.id, step: 0 });
    const prompt = `I want to apply for ${scheme.name}`;
    setAnswers((current) => [...current, {
      question: prompt,
      answer,
      schemeIds: [scheme.id],
    }]);
    persistExchange(prompt, answer, [scheme.id], { schemeId: scheme.id, step: 0 });
  };

  const recognizeScreenshot = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setScreenError(t('Choose an image of the application page.'));
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setScreenError(t('Choose an image that is 10 MB or smaller.'));
      return;
    }
    setRecognizingScreen(true);
    setScreenError('');
    try {
      const { createWorker } = await import('tesseract.js');
      const worker = await createWorker('eng');
      try {
        const { data: result } = await worker.recognize(file);
        const safeText = sanitizeScreenshotText(result.text);
        if (!safeText) {
          setScreenError(t('No readable page text was found. You can describe the visible field label instead.'));
          return;
        }
        setScreenText(safeText);
      } finally {
        await worker.terminate();
      }
    } catch (error) {
      console.error('Unable to read application screenshot:', error);
      setScreenError(t('The screenshot could not be read. You can type the visible field label instead.'));
    } finally {
      setRecognizingScreen(false);
    }
  };

  const ask = async (spokenQuestion?: string) => {
    const typedQuestion = (spokenQuestion ?? question).trim();
    if ((!typedQuestion && !screenText) || loading) return;
    const userQuestion = typedQuestion || t('Help me understand this application page.');
    const requestMessage = screenText
      ? `${userQuestion}\n\nVisible application-page text (OCR):\n${screenText}`
      : userQuestion;
    const detectedLanguage = detectLanguageFromScript(`${userQuestion} ${screenText}`, selectedLanguage);
    setQuestion('');
    setScreenText('');
    setLoading(true);
    setVoiceError('');
    setScreenError('');
    try {
      const history: ChatMessage[] = answers.flatMap((item) => [
        { role: 'user' as const, content: item.request ?? item.question },
        { role: 'assistant' as const, content: item.answer },
      ]).slice(-8);
      const addLocalAnswer = (
        answer: string,
        schemeIds?: string[],
        voiceAnswer?: string,
        guidance: { schemeId: string; step: number } | null = applicationGuidance,
      ) => {
        setAnswers((current) => [...current, { question: userQuestion, request: requestMessage, answer, schemeIds }]);
        persistExchange(userQuestion, answer, schemeIds, guidance);
        if (spokenQuestion) {
          const shortAnswer = voiceAnswer ?? (answer.length > 240
            ? detectedLanguage === 'te'
              ? 'పూర్తి వివరాలను స్క్రీన్‌పై చూపించాను. వ్యక్తిగత వివరాలను చాట్‌లో పంచుకోవద్దు.'
              : 'I’ve shown the details on screen. Do not share personal information in chat.'
            : answer);
          speak(shortAnswer, detectedLanguage);
        }
      };

      if (guidedScheme && applicationGuidance) {
        if (isApplicationStepConfirmation(userQuestion)) {
          if (applicationGuidance.step < applicationGuidanceSteps.length - 1) {
            const nextStep = applicationGuidance.step + 1;
            setApplicationGuidance({ ...applicationGuidance, step: nextStep });
            addLocalAnswer(
              getApplicationStepMessage(guidedScheme, nextStep, data?.documents ?? [], detectedLanguage),
              [guidedScheme.id],
              getApplicationVoiceMessage(guidedScheme, nextStep, detectedLanguage),
              { schemeId: guidedScheme.id, step: nextStep },
            );
          } else {
            const answer = detectedLanguage === 'te'
              ? 'సరే. అధికారిక పోర్టల్‌లో సమర్పించి ఉంటే acknowledgement number‌ను My Applicationsలో మీరు స్వయంగా నమోదు చేసుకోండి. ఇక్కడి tracker వినియోగదారు నిర్వహించేది మాత్రమే; ప్రభుత్వ స్థితి ఆటోమేటిక్‌గా అందదు.'
              : 'All guidance steps are complete. If you submitted on the official portal, enter the acknowledgement number yourself in My Applications. That tracker is user-managed; government status is not synced automatically.';
            setApplicationGuidance(null);
            addLocalAnswer(answer, [guidedScheme.id], undefined, null);
          }
          return;
        }

        const localReply = (screenText ? getScreenshotGuidanceReply(screenText, detectedLanguage) : undefined)
          ?? getApplicationQuestionReply(
          userQuestion,
          guidedScheme,
          data?.documents ?? [],
          detectedLanguage,
          applicationGuidance.step,
        );
        if (localReply) {
          addLocalAnswer(localReply, [guidedScheme.id]);
          return;
        }
      } else if (screenText) {
        addLocalAnswer(getScreenshotGuidanceReply(screenText, detectedLanguage));
        return;
      }

      if (!guidedScheme && isApplicationStartIntent(userQuestion)) {
        const namedScheme = assistantSchemes.find((scheme) => userQuestion.toLocaleLowerCase().includes(scheme.name.toLocaleLowerCase()));
        const lastSchemeIds = answers[answers.length - 1]?.schemeIds ?? [];
        const previouslyDiscussedScheme = assistantSchemes.find((scheme) => lastSchemeIds.includes(scheme.id));
        const schemeToGuide = namedScheme ?? previouslyDiscussedScheme;
        if (schemeToGuide) {
          startApplicationGuidance(schemeToGuide, detectedLanguage);
          if (spokenQuestion) speak(getApplicationVoiceMessage(schemeToGuide, 0, detectedLanguage), detectedLanguage);
        } else {
          addLocalAnswer(detectedLanguage === 'te'
            ? 'తప్పకుండా సహాయం చేస్తాను. ముందుగా ఏ పథకానికి దరఖాస్తు చేయాలనుకుంటున్నారో దాని పేరును చెప్పండి లేదా పథకాల జాబితాలో ఆ పథకాన్ని ఎంచుకోండి.'
            : 'I can guide you one step at a time. Which scheme do you want to apply for? Choose a scheme from the catalogue or tell me its name.');
        }
        return;
      }

      const result = await askBharatSathiAI({
        message: requestMessage,
        language: detectedLanguage,
        profile: profileContext,
        schemes: guidedScheme ? [guidedScheme] : assistantSchemes,
        history,
      });
      setAnswers((current) => [...current, { question: userQuestion, request: requestMessage, answer: result.answer, schemeIds: result.scheme_ids }]);
      persistExchange(userQuestion, result.answer, result.scheme_ids);
      if (voiceState === 'speaking') setVoiceState('idle');
      if (spokenQuestion) speak(result.answer, detectedLanguage);
    } catch (error) {
      console.error(error);
      if (guidedScheme) {
        const fallbackAnswer = screenText
          ? getScreenshotGuidanceReply(screenText, detectedLanguage)
          : detectedLanguage === 'te'
            ? 'ఈ ప్రశ్నకు ఖచ్చితమైన సమాధానం రికార్డులో లేదు. ఊహించకుండా అధికారిక పోర్టల్ సూచనలను చూడండి; వ్యక్తిగత వివరాలను చాట్‌లో పంపవద్దు.'
            : 'I could not verify an answer from the available records. Check the official portal instructions rather than guessing; do not send personal details in chat.';
        setAnswers((current) => [...current, {
          question: userQuestion,
          request: requestMessage,
          answer: fallbackAnswer,
          schemeIds: [guidedScheme.id],
        }]);
        persistExchange(userQuestion, fallbackAnswer, [guidedScheme.id]);
        if (spokenQuestion) speak(fallbackAnswer, detectedLanguage);
        return;
      }
      const text = userQuestion.toLowerCase();
      const fallbackMatches = assistantSchemes.filter((scheme) => (
        scheme.tags.some((tag) => text.includes(tag.toLowerCase()))
        || text.includes(scheme.category.toLowerCase())
        || text.includes(scheme.name.toLowerCase())
      )).slice(0, 3);
      const fallbackAnswer = fallbackMatches.length
        ? t('I found {{count}} potentially relevant options: {{names}}. This local fallback is grounded in the verified scheme records. You can compare eligibility and documents, then verify the final criteria with the official source.', { count: fallbackMatches.length, names: fallbackMatches.map((scheme) => scheme.name).join(', ') })
        : t('I can help narrow this down. Tell me your state, student/work/family situation, approximate income band, and what support you need (education, job, business, health, housing, etc.).');
      setAnswers((current) => [...current, { question: userQuestion, request: requestMessage, answer: fallbackAnswer, schemeIds: fallbackMatches.map((scheme) => scheme.id) }]);
      persistExchange(userQuestion, fallbackAnswer, fallbackMatches.map((scheme) => scheme.id));
    } finally {
      setLoading(false);
    }
  };

  const speak = (text: string, languageCode = selectedLanguage, onEnd?: () => void) => {
    if (!('speechSynthesis' in window)) {
      onEnd?.();
      return;
    }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = getAppLanguage(languageCode).locale;
    utterance.onstart = () => setVoiceState('speaking');
    utterance.onend = () => {
      setVoiceState('idle');
      onEnd?.();
    };
    utterance.onerror = () => setVoiceState('idle');
    window.speechSynthesis.speak(utterance);
  };

  const beginListening = () => {
    const Recognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!Recognition) {
      setVoiceError(t('Voice input is not supported in this browser. You can still type your question.'));
      return;
    }
    window.speechSynthesis?.cancel();
    const recognition = new Recognition();
    recognition.lang = getAppLanguage(selectedLanguage).locale;
    recognition.interimResults = false;
    recognition.continuous = false;
    recognition.onstart = () => { setVoiceState('listening'); setVoiceError(''); };
    recognition.onresult = (event: any) => {
      const transcript = event.results?.[0]?.[0]?.transcript ?? '';
      setQuestion(transcript);
      void ask(transcript);
    };
    recognition.onerror = () => { setVoiceState('idle'); setVoiceError(t('We could not capture your voice. Please try again.')); };
    recognition.onend = () => setVoiceState('idle');
    recognitionRef.current = recognition;
    recognition.start();
  };

  const toggleVoice = () => {
    if (voiceState === 'listening') {
      recognitionRef.current?.stop();
      return;
    }
    if (!voiceWelcomePlayed.current) {
      voiceWelcomePlayed.current = true;
      speak(getAssistantWelcome(selectedLanguage), selectedLanguage, beginListening);
      return;
    }
    beginListening();
  };

  useEffect(() => () => {
    recognitionRef.current?.stop();
    window.speechSynthesis?.cancel();
  }, []);

  const confirmApplicationStep = () => {
    if (!applicationGuidance || !guidedScheme) return;
    if (applicationGuidance.step === applicationGuidanceSteps.length - 1) {
      setApplicationGuidance(null);
      const prompt = t('Finish application guidance');
      const answer = selectedLanguage === 'te'
          ? 'మీరు అధికారిక పోర్టల్‌లో సమర్పించి ఉంటే acknowledgement number‌ను My Applicationsలో మీరు స్వయంగా నమోదు చేసుకోండి. అక్కడి tracker వినియోగదారు నిర్వహించేది మాత్రమే; ప్రభుత్వ స్థితి ఆటోమేటిక్‌గా అందదు.'
          : 'If you submitted on the official portal, enter the acknowledgement number yourself in My Applications. That tracker is user-managed; government status is not synced automatically.';
      setAnswers((current) => [...current, {
        question: prompt,
        answer,
        schemeIds: [guidedScheme.id],
      }]);
      persistExchange(prompt, answer, [guidedScheme.id], null);
      return;
    }
    const nextStep = applicationGuidance.step + 1;
    setApplicationGuidance({ ...applicationGuidance, step: nextStep });
    const prompt = t('I completed this step. Show me the next step.');
    const answer = getApplicationStepMessage(guidedScheme, nextStep, data?.documents ?? [], selectedLanguage);
    setAnswers((current) => [...current, {
      question: prompt,
      answer,
      schemeIds: [guidedScheme.id],
    }]);
    persistExchange(prompt, answer, [guidedScheme.id], { schemeId: guidedScheme.id, step: nextStep });
  };

  const stopApplicationGuidance = () => {
    setApplicationGuidance(null);
    persistExchange(t('Pause application guidance'), t('Application guidance paused.'), [], null);
  };

  return (
    <main className="mx-auto max-w-6xl px-5 py-10">
      <div className="grid gap-6 lg:grid-cols-[.7fr_1.3fr]">
        <aside className="rounded-3xl bg-slate-950 p-7 text-white">
          <div className="grid h-12 w-12 place-items-center rounded-2xl bg-orange-500"><Bot /></div>
          <h1 className="mt-5 text-3xl font-black">{t('BharatSathi Assistant')}</h1>
          <p className="mt-3 text-sm leading-6 text-slate-300">{t('Describe your situation naturally. We’ll help you identify possible schemes and the information you need next.')}</p>
          <div className="mt-7 grid gap-3 text-xs text-slate-300">
            <div className="flex gap-2"><ShieldCheck className="text-emerald-400" size={16} />{t('Answers are grounded in scheme records')}</div>
            <div className="flex gap-2"><Sparkles className="text-orange-400" size={16} />{t('AI layer can explain, not replace official decisions')}</div>
          </div>
          <div className="mt-8 rounded-2xl border border-white/10 bg-white/5 p-4 text-xs leading-5 text-slate-400">{t('Never enter Aadhaar numbers, bank passwords, OTPs or sensitive certificates into the AI chat.')}</div>
        </aside>
        <section className="flex min-h-[620px] flex-col rounded-3xl border border-slate-200 bg-white shadow-soft">
          <div className="border-b border-slate-100 p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">            <div className="text-xs font-black uppercase tracking-[.18em] text-orange-600">{t('Ask BharatSathi in your language')}</div><select value={selectedLanguage} onChange={(event) => setSelectedLanguageOverride(event.target.value)} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-600 outline-none" aria-label={t('Assistant language')}>{appLanguages.map((language) => <option key={language.code} value={language.code}>{language.nativeName} · {language.name}</option>)}</select></div>
            <div className="mt-1 text-sm text-slate-500">{t('Example: “I am a B.Tech student from AP. What scholarships can I check?”')}</div>
            {applicationGuidance && guidedScheme && (
              <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 p-4" role="status">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="text-xs font-black uppercase tracking-wide text-emerald-800">{t('Application guidance')}</div>
                    <div className="mt-1 text-sm font-bold text-slate-800">{guidedScheme.name} · {t('Step {{current}} of {{total}}', { current: applicationGuidance.step + 1, total: applicationGuidanceSteps.length })}</div>
                    <div className="text-xs text-slate-600">{t(applicationGuidanceSteps[applicationGuidance.step])}</div>
                  </div>
                  <a href={guidedScheme.applicationUrl || guidedScheme.officialUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs font-black text-emerald-800">
                    {t('Open official portal')} <ArrowUpRight size={14} />
                  </a>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button type="button" onClick={confirmApplicationStep} className="rounded-xl bg-emerald-700 px-3 py-2 text-xs font-black text-white hover:bg-emerald-800">
                    {applicationGuidance.step === applicationGuidanceSteps.length - 1
                      ? t('Finish guidance')
                      : t('I completed this step — show the next one')}
                  </button>
                  <button type="button" onClick={stopApplicationGuidance} className="rounded-xl border border-emerald-200 px-3 py-2 text-xs font-bold text-emerald-900">
                    {t('Pause guidance')}
                  </button>
                </div>
                <p className="mt-2 text-[11px] leading-5 text-emerald-900">{t('The official government portal handles the application and final submission. BharatSathi does not submit it for you.')}</p>
              </div>
            )}
          </div>
          <div className="flex-1 space-y-4 overflow-auto p-5">
            {answers.length === 0 ? (
              <div className="grid h-full place-items-center text-center">
                <div>
                  <div className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-orange-50 text-orange-600"><Sparkles /></div>
                  <h2 className="mt-4 text-xl font-black">{t('What do you need help with?')}</h2>
                  <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-500">{t('Ask about scholarships, jobs, farming, health, housing or starting a business.')}</p>
                  <div className="mt-5 flex flex-wrap justify-center gap-2">
                    {['Scholarships for students', 'Support for farmers', 'Business loans', 'Health schemes'].map((prompt) => (
                      <button onClick={() => setQuestion(prompt)} key={prompt} className="rounded-full border border-slate-200 px-3 py-2 text-xs font-bold text-slate-600 hover:border-orange-300 hover:text-orange-600">{t(prompt)}</button>
                    ))}
                  </div>
                </div>
              </div>
            ) : answers.map((item, index) => (
              <div key={index} className="space-y-3">
                <div className="ml-auto max-w-[80%] rounded-2xl rounded-br-sm bg-slate-950 px-4 py-3 text-sm text-white">{item.question}</div>
                <div className="max-w-[90%] rounded-2xl rounded-bl-sm bg-slate-50 px-4 py-4 text-sm leading-6 text-slate-600">
                  {item.answer}
                  <div className="mt-3 flex items-center gap-3"><button type="button" onClick={() => speak(item.answer, selectedLanguage)} className="inline-flex items-center gap-1 text-[11px] font-bold text-slate-500 hover:text-orange-600"><Volume2 size={13} /> {t('Listen')}</button>{item.schemeIds?.length ? <span className="text-[10px] font-bold text-emerald-600">{t('Grounded in verified scheme records')}</span> : null}</div>
                  <div className="mt-3"><Link to="/schemes" className="inline-flex items-center gap-1 text-xs font-black text-orange-600">{t('Explore scheme records')} <ArrowRight size={14} /></Link></div>
                  {!applicationGuidance && item.schemeIds?.map((schemeId) => {
                    const scheme = assistantSchemes.find((candidate) => candidate.id === schemeId);
                    return scheme ? (
                      <div key={schemeId} className="mt-3 flex flex-wrap gap-3">
                        <button type="button" onClick={() => startApplicationGuidance(scheme)} className="text-xs font-black text-emerald-700 hover:text-emerald-900">
                          {t('Guide me through applying')} · {scheme.name}
                        </button>
                        <a href={scheme.applicationUrl || scheme.officialUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs font-bold text-slate-500 hover:text-orange-600">
                          {t('Official application portal')} <ArrowUpRight size={13} />
                        </a>
                      </div>
                    ) : null;
                  })}
                </div>
              </div>
            ))}
          </div>
          <div className="border-t border-slate-100 p-4">
            {screenText && (
              <div className="mb-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
                <div className="flex items-center justify-between gap-2">
                  <label htmlFor="application-screen-text" className="text-xs font-black text-slate-700">{t('Detected screen text — review and edit before sending')}</label>
                  <button type="button" onClick={() => setScreenText('')} aria-label={t('Remove screenshot text')} className="text-slate-400 hover:text-red-600"><X size={15} /></button>
                </div>
                <textarea id="application-screen-text" value={screenText} onChange={(event) => setScreenText(event.target.value)} rows={3} maxLength={3000} className="mt-2 w-full rounded-lg border border-slate-200 bg-white p-2 text-xs text-slate-700 outline-none" />
                <p className="mt-1 text-[10px] leading-4 text-slate-500">{t('Image text is read on this device. Review it and remove personal information; only the text is sent when you ask a question.')}</p>
              </div>
            )}
            {screenError && <p className="mb-2 text-xs text-red-600" role="alert">{screenError}</p>}
            <div className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 p-2">
              <input ref={screenshotInputRef} type="file" accept="image/*" onChange={(event) => void recognizeScreenshot(event)} className="hidden" aria-label={t('Choose application screenshot')} />
              <button type="button" onClick={() => screenshotInputRef.current?.click()} disabled={recognizingScreen || loading} className="rounded-xl p-2 text-slate-400 hover:text-orange-600 disabled:opacity-50" aria-label={t('Understand an application screenshot')} title={t('Read application page screenshot')}>
                {recognizingScreen ? <Sparkles size={17} className="animate-pulse" /> : <ImagePlus size={18} />}
              </button>
              <button type="button" onClick={toggleVoice} className={`rounded-xl p-2 ${voiceState === 'listening' ? 'bg-red-50 text-red-600' : 'text-slate-400 hover:text-orange-600'}`} aria-label={voiceState === 'listening' ? t('Stop voice input') : t('Use voice input')}>{voiceState === 'listening' ? <Square size={16} /> : <Mic size={19} />}</button>
              <input value={question} onChange={(event) => setQuestion(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && ask()} placeholder={t('Tell BharatSathi what you need...')} className="min-w-0 flex-1 bg-transparent px-2 text-sm outline-none" />
              <button onClick={() => void ask()} disabled={loading || (!question.trim() && !screenText)} className="grid h-10 w-10 place-items-center rounded-xl bg-orange-500 text-white hover:bg-orange-600 disabled:cursor-not-allowed disabled:opacity-50" aria-label={t('Send question')}>{loading ? <Sparkles size={17} className="animate-pulse" /> : <Send size={17} />}</button>
            </div>
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2 px-1 text-[10px] text-slate-400"><span>{t('AI answers are grounded in the scheme records • official sources remain the final authority')}</span>{voiceError ? <span className="text-red-500">{voiceError}</span> : <span>{voiceState === 'listening' ? t('Listening…') : voiceState === 'speaking' ? t('Speaking…') : t('Voice ready')}</span>}</div>
          </div>
        </section>
      </div>
    </main>
  );
}
