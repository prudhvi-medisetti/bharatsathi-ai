import {
  ArrowRight,
  ArrowUpRight,
  Award,
  Bell,
  BookOpenCheck,
  Bookmark,
  BriefcaseBusiness,
  Check,
  CheckCircle2,
  CircleHelp,
  Circle,
  Clock3,
  FileCheck2,
  FileText,
  GraduationCap,
  Headset,
  HeartPulse,
  Home,
  Layers3,
  Leaf,
  LoaderCircle,
  Mic,
  MoreHorizontal,
  Search,
  Send,
  ShieldCheck,
  Sparkles,
  UsersRound,
  Wallet,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useMemo, useState, type FormEvent } from 'react';
import type { CSSProperties } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import SchemeCard from '../components/SchemeCard';
import { useAuth } from '../context/AuthContext';
import { useDashboardData } from '../hooks/useDashboardData';
import { schemes as localSchemes } from '../data/schemes';
import { getDashboardTimestamp, type DashboardRecord } from '../services/dashboard';
import { calculateProfileCompletion, getProfileCompletionSections } from '../services/profile';
import { getSchemeRecommendations } from '../services/schemeCategories';
import type { Scheme } from '../types';

type CategoryItem = { name: string; caption: string; icon: LucideIcon; tone: string; filter: string };
const categories: CategoryItem[] = [
  { name: 'Education', caption: 'Scholarships & more', icon: GraduationCap, tone: 'blue', filter: 'education' },
  { name: 'Employment', caption: 'Jobs & skill training', icon: BriefcaseBusiness, tone: 'green', filter: 'employment' },
  { name: 'Healthcare', caption: 'Medical & insurance', icon: HeartPulse, tone: 'rose', filter: 'healthcare' },
  { name: 'Housing', caption: 'Home & land support', icon: Home, tone: 'orange', filter: 'housing' },
  { name: 'Agriculture', caption: 'Farmer welfare', icon: Leaf, tone: 'lime', filter: 'agriculture' },
  { name: 'Women & Family', caption: 'Welfare & support', icon: UsersRound, tone: 'purple', filter: 'women%20%26%20family' },
  { name: 'Business / Entrepreneurship', caption: 'Loans & subsidies', icon: Wallet, tone: 'red', filter: 'business%20%2F%20entrepreneurship' },
  { name: 'More', caption: 'All categories', icon: MoreHorizontal, tone: 'slate', filter: '' },
];

const documentChecklist = [
  { name: 'Aadhaar Card', required: true, icon: ShieldCheck },
  { name: 'Caste Certificate (if applicable)', required: false, icon: FileCheck2 },
  { name: 'Income Certificate', required: true, icon: Wallet },
  { name: 'Bonafide Certificate / ID Card', required: false, icon: BookOpenCheck },
  { name: 'Bank Account Details', required: true, icon: FileText },
];

export default function Dashboard() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { data, loading, error } = useDashboardData();
  const navigate = useNavigate();
  const [question, setQuestion] = useState('');
  const [questionError, setQuestionError] = useState('');
  const [listening, setListening] = useState(false);

  const profile = data?.profile;
  const catalogue = data?.schemes.length ? data.schemes : localSchemes;
  const recommendations = useMemo(() => getSchemeRecommendations(catalogue, profile), [catalogue, profile]);
  const savedRecords = data?.savedSchemes ?? [];
  const applications = data?.applications ?? [];
  const documents = data?.documents ?? [];
  const profileItems = getProfileCompletionSections(profile, documents, user?.displayName, user?.email);
  const completion = calculateProfileCompletion(profileItems);
  const savedCount = savedRecords.length;
  const inProgressCount = applications.filter((application) => ['applied', 'submitted', 'documents pending', 'under review', 'needs action', 'in progress', 'in_progress'].includes((application.status ?? '').toLowerCase())).length;
  const appliedCount = applications.filter((application) => ['applied', 'submitted', 'under review', 'approved', 'completed'].includes((application.status ?? '').toLowerCase())).length;
  const recentApplications = useMemo(() => [...applications]
    .sort((left, right) => (
      (getDashboardTimestamp(right.updatedAt ?? right.lastUpdated)?.getTime() ?? 0)
      - (getDashboardTimestamp(left.updatedAt ?? left.lastUpdated)?.getTime() ?? 0)
    )).slice(0, 2), [applications]);
  const savedSchemes = savedRecords.map((record) => catalogue.find((scheme) => scheme.id === record.schemeId))
    .filter((scheme): scheme is Scheme => Boolean(scheme)).slice(0, 3);

  const startQuestion = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const prompt = question.trim();
    if (!prompt) {
      setQuestionError('Type a question to start a conversation.');
      return;
    }
    navigate(`/ai-assistant?prompt=${encodeURIComponent(prompt)}`);
  };

  const useVoiceInput = () => {
    const Recognition = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    if (!Recognition) {
      setQuestionError('Voice input is not supported in this browser.');
      return;
    }
    setQuestionError('');
    const recognition = new Recognition();
    recognition.lang = profile?.language === 'తెలుగు' ? 'te-IN' : 'en-IN';
    recognition.onresult = (event) => {
      const transcript = event.results[0]?.[0]?.transcript;
      if (transcript) setQuestion(transcript);
      setListening(false);
    };
    recognition.onerror = () => {
      setQuestionError('Voice input could not be completed. Please try typing your question.');
      setListening(false);
    };
    recognition.onend = () => setListening(false);
    setListening(true);
    recognition.start();
  };

  const displayName = profile?.name || user?.displayName || user?.email?.split('@')[0] || 'Citizen';
  const firstName = displayName.trim().split(/\s+/)[0];

  return (
    <div className="dashboard-page">
      {error && <div className="dashboard-alert" role="status"><Bell size={16} /><span>{t('Some live dashboard data could not be loaded: {{error}}', { error })}</span></div>}
      <WelcomeBanner name={firstName} stats={[
        { value: savedCount, label: t('Saved Schemes'), icon: Bookmark, tone: 'green' },
        { value: inProgressCount, label: t('In Progress'), icon: LoaderCircle, tone: 'blue' },
        { value: appliedCount, label: t('Applied'), icon: FileCheck2, tone: 'orange' },
        { value: recommendations.length, label: t('Recommendations'), icon: Award, tone: 'purple' },
      ]} />

      <div className="dashboard-primary-grid">
        <section className="dashboard-panel assistant-panel">
          <div className="dashboard-panel-heading">
            <span className="assistant-bot-icon"><Sparkles size={21} /></span>
            <div className="panel-heading-copy">
              <div className="heading-with-status"><h2>{t('AI Assistant')}</h2><span className="online-pill"><i /> {t('Online')}</span></div>
              <p>{t('Ask anything about government schemes in English or Telugu.')}</p>
            </div>
          </div>
          <div className="quick-prompts">
            {[
              { label: 'I am a student', icon: GraduationCap },
              { label: 'I am a farmer', icon: Leaf },
              { label: 'I need a job', icon: BriefcaseBusiness },
              { label: 'I am a woman', icon: UsersRound },
              { label: 'I want housing', icon: Home },
            ].map(({ label, icon: Icon }) => (
              <button type="button" key={label} onClick={() => setQuestion(label)}><Icon size={15} />{t(label)}</button>
            ))}
            <button type="button" className="prompt-more" onClick={() => navigate('/ai-assistant')}>{t('More')}</button>
          </div>
          <form className="assistant-question" onSubmit={startQuestion}>
            <input value={question} onChange={(event) => { setQuestion(event.target.value); setQuestionError(''); }} placeholder={t('Ask a question... (e.g., What schemes can I apply for as a student?)')} aria-label={t('AI Assistant')} />
            <button type="button" onClick={useVoiceInput} className={listening ? 'voice-active' : ''} aria-label={t(listening ? 'Listening' : 'Use voice input')}><Mic size={18} /></button>
            <button type="submit" className="assistant-send" aria-label={t('Send question')}><Send size={17} /></button>
          </form>
          {questionError && <p className="assistant-error" role="alert">{questionError}</p>}
        </section>

        <EligibilityProgress completion={completion} items={profileItems} />
      </div>

      <div className="dashboard-content-grid">
        <div className="dashboard-main-column">
          <section className="dashboard-panel recommendations-panel">
            <SectionTitle icon={Award} title={t('Recommended for You')} subtitle={t('Based on your profile; confirm details with official sources')} href="/schemes" action={t('Explore All Schemes')} />
            {loading ? <CardSkeleton count={3} /> : recommendations.length ? (
              <div className="recommended-grid">
                {recommendations.slice(0, 3).map((recommendation) => <RecommendedSchemeCard key={recommendation.scheme.id} {...recommendation} />)}
              </div>
            ) : <EmptyState icon={Search} title={t('No scheme recommendations yet')} text={t('Browse the scheme catalogue to explore current opportunities.')} href="/schemes" action={t('Explore schemes')} />}
            {!data?.schemes.length && <p className="catalogue-note">{t('Showing the local starter catalogue while the Firestore scheme catalogue is empty.')}</p>}
          </section>

          <section className="dashboard-panel recommendations-panel">
            <SectionTitle icon={Sparkles} title={t('Based on Your Profile')} subtitle={t('More schemes connected to your profile details')} href="/schemes" action={t('Explore More')} />
            {recommendations.length > 3 ? (
              <div className="recommended-grid">
                {recommendations.slice(3, 6).map((recommendation) => <RecommendedSchemeCard key={recommendation.scheme.id} {...recommendation} />)}
              </div>
            ) : <p className="mt-4 text-sm text-slate-500">{t('Complete more optional profile details to discover additional relevant schemes.')}</p>}
          </section>

          <div className="grid gap-5 lg:grid-cols-2">
            <section className="dashboard-panel">
              <SectionTitle icon={FileText} title={t('My Applications')} subtitle={t('{{count}} tracked applications', { count: applications.length })} href="/applications" action={t('View all')} compact />
              {recentApplications.length ? <div className="mt-4 space-y-3">
                {recentApplications.map((application) => {
                  const scheme = catalogue.find((item) => item.id === application.schemeId);
                  return <Link key={application.id} to="/applications" className="flex items-center justify-between gap-3 rounded-xl bg-slate-50 p-3 hover:bg-emerald-50">
                    <span className="min-w-0"><strong className="block truncate text-sm">{application.name ?? scheme?.name ?? t('Government scheme')}</strong><small className="text-xs text-slate-500">{t('Status entered manually')}</small></span>
                    <span className="shrink-0 rounded-full bg-white px-3 py-1 text-xs font-bold text-emerald-800">{t(application.status ?? 'Not Started')}</span>
                  </Link>;
                })}
              </div> : <p className="mt-4 text-sm text-slate-500">{t('No applications are being tracked yet.')}</p>}
            </section>
            <section className="dashboard-panel">
              <SectionTitle icon={Bookmark} title={t('Saved Schemes')} subtitle={t('{{count}} saved schemes', { count: savedRecords.length })} href="/saved" action={t('View saved')} compact />
              {savedSchemes.length ? <div className="mt-4 space-y-3">
                {savedSchemes.map((scheme) => <Link key={scheme.id} to={`/schemes/${scheme.id}`} className="flex items-center justify-between gap-3 rounded-xl bg-slate-50 p-3 hover:bg-emerald-50">
                  <strong className="truncate text-sm">{scheme.name}</strong><span className="shrink-0 text-xs text-slate-500">{t(scheme.category)}</span>
                </Link>)}
              </div> : <p className="mt-4 text-sm text-slate-500">{t('Save a scheme to keep it handy here.')}</p>}
            </section>
          </div>

          <div className="dashboard-bottom-grid">
            <section className="dashboard-panel category-panel">
              <SectionTitle icon={Layers3} title={t('Explore Schemes by Category')} subtitle="" href="/schemes" action={t('All schemes')} compact />
              <div className="dashboard-category-grid">
                {categories.map(({ name, caption, icon: Icon, tone, filter }) => (
                  <Link key={name} to={filter ? `/schemes?category=${filter}` : '/schemes'} className={`dashboard-category tone-${tone}`}>
                    <Icon size={20} /><strong>{t(name)}</strong><span>{t(caption)}</span>
                  </Link>
                ))}
              </div>
            </section>

            <section className="dashboard-panel activity-panel">
              <SectionTitle icon={Clock3} title={t('Recent Activity')} subtitle="" href="/notifications" action={t('View All')} compact />
              {loading ? <ActivitySkeleton /> : <ActivityTimeline activities={data?.activities ?? []} catalogue={catalogue} />}
            </section>
          </div>
        </div>

        <aside className="dashboard-side-column">
          <DocumentChecklist records={documents} />
          <SupportCard />
        </aside>
      </div>
    </div>
  );
}

function WelcomeBanner({ name, stats }: { name: string; stats: { value: number; label: string; icon: LucideIcon; tone: string }[] }) {
  const { t } = useTranslation();
  return (
    <section className="welcome-banner">
      <div className="welcome-map" aria-hidden="true">भारत</div>
      <div className="welcome-saffron-wave" aria-hidden="true" />
      <div className="welcome-green-wave" aria-hidden="true" />
      <div className="welcome-landmark" aria-hidden="true"><i /><i /><i /><b /></div>
      <div className="welcome-trees" aria-hidden="true"><i /><i /><i /></div>
      <div className="welcome-copy">
        <span className="welcome-label"><span className="tricolor-mark"><i /><i /><i /></span> BharatSathi AI</span>
        <h1>{t('Welcome back, {{name}}!', { name })} <span aria-hidden="true">👋</span></h1>
        <p>{t('Your personal government benefits dashboard')}</p>
      </div>
      <div className="welcome-stats">
        {stats.map(({ value, label, icon: Icon, tone }) => (
          <div className="welcome-stat" key={label}>
            <span className={`welcome-stat-icon stat-tone-${tone}`}><Icon size={20} /></span>
            <span className="welcome-stat-copy"><strong>{value}</strong><small>{t(label)}</small></span>
          </div>
        ))}
      </div>
    </section>
  );
}

function EligibilityProgress({ completion, items }: { completion: number; items: { label: string; complete: boolean }[] }) {
  const { t } = useTranslation();
  return (
    <section className="dashboard-panel eligibility-panel">
      <div className="side-panel-heading">
        <span className="side-panel-icon side-orange"><CheckCircle2 size={19} /></span>
        <div><h2>{t('Your Eligibility Progress')}</h2><p>{t('Complete your profile to get more accurate scheme recommendations.')}</p></div>
      </div>
      <div className="progress-content">
        <div className="progress-ring" style={{ '--progress': `${completion}%` } as CSSProperties}>
          <div><strong>{completion}%</strong><span>{t('Profile Complete')}</span></div>
        </div>
        <ul className="progress-checklist">
          {items.map(({ label, complete }) => <li key={label} className={complete ? 'check-complete' : ''}>{complete ? <CheckCircle2 size={14} /> : <Circle size={14} />}<span>{t(label)}</span></li>)}
        </ul>
      </div>
      <Link to="/profile" className="solid-green-button">{t('Complete Profile')} <ArrowRight size={16} /></Link>
    </section>
  );
}

function RecommendedSchemeCard({ scheme, status }: { scheme: Scheme; status: string }) {
  const { t } = useTranslation();
  return (
    <article className="recommended-card">
      <div className="recommended-card-top">
        <SchemeIcon category={scheme.category} />
        <span className="scheme-match-label">{t(scheme.state === 'Andhra Pradesh' ? 'AP Scheme' : 'Central Scheme')}</span>
      </div>
      <div className="recommended-tags"><span>{t(scheme.category)}</span><span>{t(scheme.state)}</span><span>{t(status)}</span></div>
      <h3>{scheme.name}</h3>
      <p>{scheme.short}</p>
      <div className="recommended-card-actions">
        <Link to={`/eligibility?schemeId=${encodeURIComponent(scheme.id)}`} className="check-scheme-button">{t('Check Eligibility')}</Link>
        <Link to={`/schemes/${scheme.id}`} className="view-scheme-button">{t('View Details')} <ArrowRight size={13} /></Link>
      </div>
    </article>
  );
}

function DocumentChecklist({ records }: { records: DashboardRecord[] }) {
  const { t } = useTranslation();
  const documents = documentChecklist.map((template) => {
    const found = records.find((record) => (
      (record.name ?? record.label ?? record.documentType ?? '').toLowerCase().includes(template.name.split(' ')[0].toLowerCase())
    ));
    return { ...template, done: found?.completed === true || ['complete', 'completed', 'verified', 'uploaded', 'needs_confirmation'].includes((found?.status ?? '').toLowerCase()) };
  });
  return (
    <section className="dashboard-panel document-panel">
      <div className="side-panel-heading">
        <span className="side-panel-icon side-green"><FileText size={19} /></span>
        <div><h2>{t('Document Checklist')}</h2><p>{t('Keep your documents ready for faster applications.')}</p></div>
      </div>
      <ul className="document-list">
        {documents.map(({ name, required, icon: Icon, done }) => (
          <li key={name}>
            <span className={`document-type document-tone-${name.split(' ')[0].toLowerCase()}`}><Icon size={14} /></span>
            <span className="document-name">{t(name)}{!required && <small> ({t('if applicable')})</small>}</span>
            <span className={done ? 'document-done' : 'document-pending'} aria-label={done ? 'Complete' : required ? 'Required' : 'Optional'}>{done ? <Check size={11} /> : <Circle size={13} />}</span>
          </li>
        ))}
      </ul>
      <Link to="/documents" className="text-green-link">{t('Manage Documents')} <ArrowRight size={14} /></Link>
    </section>
  );
}

function ActivityTimeline({ activities, catalogue }: { activities: DashboardRecord[]; catalogue: Scheme[] }) {
  const sorted = [...activities].sort((a, b) => {
    const left = getDashboardTimestamp(a.createdAt)?.getTime() ?? 0;
    const right = getDashboardTimestamp(b.createdAt)?.getTime() ?? 0;
    return right - left;
  }).slice(0, 4);

  if (!sorted.length) return <EmptyState icon={Clock3} title="Your activity will appear here" text="Save a scheme or check eligibility to start your timeline." href="/schemes" action="Explore schemes" compact />;

  return (
    <div className="activity-timeline">
      {sorted.map((activity, index) => {
        const scheme = catalogue.find((item) => item.id === activity.schemeId);
        const time = formatActivityTime(activity.createdAt);
        const title = activity.message ?? (scheme ? `${activity.type ?? 'Viewed'} ${scheme.name}` : activity.type ?? 'Account activity');
        const subtitle = activitySubtitle(activity.type);
        return (
          <div className="activity-item" key={activity.id}>
            <span className={`activity-marker activity-marker-${index % 3}`}>{index === 0 ? <Check size={14} /> : index === 1 ? <Bookmark size={14} /> : <Search size={14} />}</span>
            <div><strong>{title}</strong><p>{subtitle}{time ? ` · ${time}` : ''}</p></div>
          </div>
        );
      })}
    </div>
  );
}

function SupportCard() {
  const { t } = useTranslation();
  return (
    <section className="support-card">
      <div className="support-landscape" aria-hidden="true"><i /><i /><i /></div>
      <div className="support-copy">
        <span className="support-icon"><CircleHelp size={19} /></span>
        <h2>{t('Need Help?')}</h2>
        <p>{t('Get support with schemes, eligibility or application process.')}</p>
        <Link to="/ai-assistant">{t('Contact Support')} <ArrowRight size={14} /></Link>
      </div>
      <div className="support-person" aria-hidden="true"><span><Headset size={23} /></span><i /><b /></div>
    </section>
  );
}

function SectionTitle({ icon: Icon, title, subtitle, href, action, compact = false }: { icon: LucideIcon; title: string; subtitle: string; href: string; action: string; compact?: boolean }) {
  return (
    <div className={`section-title-row ${compact ? 'section-title-compact' : ''}`}>
      <span className="section-title-icon"><Icon size={18} /></span>
      <div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div>
      <Link to={href}>{action} <ArrowRight size={13} /></Link>
    </div>
  );
}

function SchemeIcon({ category }: { category: string }) {
  const Icon = /educ/i.test(category) ? GraduationCap : /housing/i.test(category) ? Home : /agri/i.test(category) ? Leaf : /health/i.test(category) ? HeartPulse : /business/i.test(category) ? Wallet : BriefcaseBusiness;
  return <span className={`scheme-category-icon ${/educ/i.test(category) ? 'tone-blue' : /hous/i.test(category) ? 'tone-orange' : /agri/i.test(category) ? 'tone-green' : 'tone-purple'}`}><Icon size={22} /></span>;
}

function formatActivityTime(value: unknown) {
  const date = getDashboardTimestamp(value);
  if (!date) return '';
  return new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }).format(date);
}

function activitySubtitle(type?: string) {
  switch (type?.toLowerCase()) {
    case 'scheme_saved':
      return 'Added to your saved schemes';
    case 'application_submitted':
      return 'Application submitted';
    case 'eligibility_checked':
      return 'Eligibility checked';
    default:
      return type?.replaceAll('_', ' ') || 'Account activity';
  }
}

function CardSkeleton({ count }: { count: number }) {
  return <div className="recommended-grid">{Array.from({ length: count }, (_, index) => <div key={index} className="dashboard-skeleton scheme-skeleton" />)}</div>;
}

function ActivitySkeleton() {
  return <div className="activity-skeleton"><i /><i /><i /></div>;
}

function EmptyState({ icon: Icon, title, text, href, action, compact = false }: { icon: LucideIcon; title: string; text: string; href: string; action: string; compact?: boolean }) {
  return <div className={`dashboard-empty ${compact ? 'dashboard-empty-compact' : ''}`}><Icon size={20} /><strong>{title}</strong><p>{text}</p><Link to={href}>{action} <ArrowUpRight size={13} /></Link></div>;
}
