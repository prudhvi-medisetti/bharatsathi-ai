import { ArrowRight, BriefcaseBusiness, GraduationCap, Grid2X2, HeartPulse, Home as HomeIcon, Languages, Leaf, ShieldCheck, UsersRound } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Link } from 'react-router-dom';
import { schemes } from '../data/schemes';
import { useTranslation } from 'react-i18next';
import LanguageSwitcher from '../components/LanguageSwitcher';
import BrandLogo from '../components/BrandLogo';

const categories: { title: string; caption: string; icon: LucideIcon; tone: string; category?: string }[] = [
  { title: 'Education', caption: 'Scholarships & more', icon: GraduationCap, tone: 'blue', category: 'Education' },
  { title: 'Employment', caption: 'Jobs & skill training', icon: BriefcaseBusiness, tone: 'orange', category: 'Employment' },
  { title: 'Healthcare', caption: 'Medical & insurance', icon: HeartPulse, tone: 'rose', category: 'Healthcare' },
  { title: 'Housing', caption: 'Home & land support', icon: HomeIcon, tone: 'amber', category: 'Housing' },
  { title: 'Agriculture', caption: 'Farmer welfare', icon: Leaf, tone: 'green', category: 'Agriculture' },
  { title: 'Women & Family', caption: 'Welfare & support', icon: UsersRound, tone: 'pink', category: 'Women & Family' },
  { title: 'More', caption: 'All categories', icon: Grid2X2, tone: 'slate' },
];

const loginPath = '/login';

export default function Home() {
  const { t } = useTranslation();

  return (
    <main className="landing-page">
      <header className="landing-header">
        <div className="landing-header-inner">
          <Link to="/" className="landing-brand">
            <BrandLogo className="landing-logo" />
            <span><strong>BharatSathi <em>AI</em></strong><small>{t('Your Government Benefits Companion')}</small></span>
          </Link>
          <div className="landing-header-actions">
            <LanguageSwitcher className="landing-language" />
            <Link to="/login" className="landing-signin">{t('Sign In')}</Link>
          </div>
        </div>
      </header>
      <section className="landing-hero">
        <div className="landing-hero-inner">
          <div className="landing-copy">
            <div className="landing-badge"><span className="tricolor-mark" /> <strong>{t('AI for Bharat')}</strong><span className="badge-separator" /> {t('AP + Central Government Schemes')}</div>
            <h1>{t('Government Schemes')} <span>{t('Made Simple for Everyone')}</span></h1>
            <p className="landing-lede">{t('Find the right schemes, check your eligibility, get a document checklist, and apply with AI guidance — in English & Telugu.')}</p>
            <div className="landing-actions">
              <Link to={loginPath} className="landing-primary"><span>✦</span> {t('Ask AI Assistant')} <ArrowRight size={17} /></Link>
              <Link to={loginPath} className="landing-secondary"><span className="search-glass" /> {t('Explore Schemes')}</Link>
            </div>
          </div>
          <div className="landing-art" aria-hidden="true">
            <img
              src="/landing-empowering-india.png"
              alt=""
              className="landing-banner"
              fetchPriority="high"
              decoding="async"
            />
          </div>
        </div>
      </section>

      <section className="landing-categories" aria-label={t('Explore scheme categories')}>
        <div className="category-strip">
          {categories.map(({ title, caption, icon: Icon, tone, category }) => (
            <Link
              to={category ? `/schemes?category=${encodeURIComponent(category)}` : '/schemes'}
              className="landing-category"
              key={title}
            >
              <span className={`landing-category-icon category-${tone}`}><Icon size={24} strokeWidth={2.2} /></span>
              <strong>{t(title)}</strong>
              <small>{t(caption)}</small>
            </Link>
          ))}
        </div>
      </section>

      <section className="landing-stats" aria-label={t('BharatSathi AI at a glance')}>
          <div className="landing-stat"><UsersRound className="stat-green" /><strong>{schemes.length}+</strong><span>{t('Scheme Records')}</span></div>
          <div className="landing-stat"><span className="stat-map">◆</span><strong>{t('AP + Central')}</strong><span>{t('Government')}</span></div>
          <div className="landing-stat"><Languages className="stat-orange" /><strong>{t('Telugu + English')}</strong><span>{t('Bilingual Support')}</span></div>
          <div className="landing-stat"><ShieldCheck className="stat-green" /><strong>{t('Official')}</strong><span>{t('Source Links')}</span></div>
          <div className="landing-stat"><span className="stat-bolt">ϟ</span><strong>{t('AI-Powered')}</strong><span>{t('Personal Guidance')}</span></div>
      </section>
    </main>
  );
}
