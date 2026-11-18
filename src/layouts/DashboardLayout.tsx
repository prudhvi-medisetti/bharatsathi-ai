import {
  Bell,
  Bookmark,
  Bot,
  ChevronDown,
  FileText,
  Globe2,
  Home,
  Layers3,
  LogOut,
  Menu,
  Search,
  Settings,
  ShieldCheck,
  UserRound,
  X,
} from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../context/AuthContext';
import { DashboardDataProvider, useDashboardData } from '../hooks/useDashboardData';
import FloatingAssistant from '../components/FloatingAssistant';
import { saveUserProfile } from '../services/dashboard';
import { isFirestorePermissionError } from '../services/userProfile';
import i18n from '../i18n';
import { getInterfaceLanguage, interfaceLanguages } from '../data/languages';
import LanguageSwitcher from '../components/LanguageSwitcher';
import BrandLogo from '../components/BrandLogo';

const primaryLinks = [
  { title: 'Dashboard', to: '/dashboard', icon: Home },
  { title: 'AI Assistant', to: '/ai-assistant', icon: Bot },
  { title: 'Explore Schemes', to: '/schemes', icon: Layers3 },
  { title: 'Eligibility Check', to: '/eligibility', icon: ShieldCheck },
  { title: 'My Schemes', to: '/my-schemes', icon: Bookmark },
  { title: 'My Applications', to: '/applications', icon: FileText },
  { title: 'Documents', to: '/documents', icon: FileText },
  { title: 'Notifications', to: '/notifications', icon: Bell, notification: true },
];

const accountLinks = [
  { title: 'Profile', to: '/profile', icon: UserRound },
  { title: 'Settings', to: '/settings', icon: Settings },
];

export default function DashboardLayout() {
  return <DashboardDataProvider><DashboardLayoutContent /></DashboardDataProvider>;
}

function DashboardLayoutContent() {
  const { user, signOut } = useAuth();
  const { data, profilePhotoOverride } = useDashboardData();
  const { t } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [signOutError, setSignOutError] = useState('');
  const [languageError, setLanguageError] = useState('');
  const [query, setQuery] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  const profilePhotoUrl = profilePhotoOverride ?? data?.profile?.photoURL ?? user?.photoURL;

  useEffect(() => {
    const syncLanguage = (locale: string) => {
      localStorage.setItem('bharatsathi-language', getInterfaceLanguage(locale) ?? 'en');
    };
    i18n.on('languageChanged', syncLanguage);
    return () => { i18n.off('languageChanged', syncLanguage); };
  }, []);

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        searchRef.current?.focus();
      }
      if (event.key === 'Escape') {
        setSidebarOpen(false);
        setProfileOpen(false);
      }
    };
    window.addEventListener('keydown', handleShortcut);
    return () => window.removeEventListener('keydown', handleShortcut);
  }, []);

  useEffect(() => {
    setSidebarOpen(false);
    setProfileOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    const savedLanguage = getInterfaceLanguage(localStorage.getItem('bharatsathi-language'))
      ?? getInterfaceLanguage(data?.profile?.preferredLanguage)
      ?? getInterfaceLanguage(data?.profile?.language);
    if (!savedLanguage || i18n.resolvedLanguage === savedLanguage) return;
    localStorage.setItem('bharatsathi-language', savedLanguage);
    void i18n.changeLanguage(savedLanguage);
  }, [data?.profile?.preferredLanguage, data?.profile?.language]);

  const changeLanguage = async (nextLanguage: string) => {
    setLanguageError('');
    if (!user) return;
    try {
      await i18n.changeLanguage(nextLanguage);
    } catch (error) {
      console.error('Unable to apply the selected language:', error);
      setLanguageError('Could not save your preference. Please try again.');
      return;
    }

    let localPreferenceSaved = true;
    try {
      localStorage.setItem('bharatsathi-language', nextLanguage);
    } catch (error) {
      localPreferenceSaved = false;
      console.warn('Unable to cache the selected language on this device:', error);
    }

    try {
      await saveUserProfile({ preferredLanguage: nextLanguage });
    } catch (error) {
      console.error('Unable to persist language preference:', error);
      setLanguageError(localPreferenceSaved
        ? isFirestorePermissionError(error)
          ? 'Language saved on this device, but Firestore denied account sync. Check the deployed rules and App Check authorization.'
          : 'Language saved on this device, but account sync failed. Check your connection and try again.'
        : 'Could not save your preference. Please try again.');
    }
  };

  const search = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    navigate(query.trim() ? `/schemes?q=${encodeURIComponent(query.trim())}` : '/schemes');
  };

  const handleSignOut = async () => {
    setSignOutError('');
    try {
      await signOut();
      navigate('/login', { replace: true });
    } catch (error) {
      console.error('Unable to sign out:', error);
      setSignOutError('Sign out could not be completed. Please try again.');
    }
  };

  const displayName = user?.displayName || user?.email?.split('@')[0] || 'Citizen';

  return (
    <div className="app-shell">
      <aside className={`app-sidebar ${sidebarOpen ? 'app-sidebar-open' : ''}`}>
        <Link to="/dashboard" className="sidebar-brand">
          <BrandLogo className="sidebar-logo" />
          <span><strong>BharatSathi <em>AI</em></strong><small>Your Government Benefits Companion</small></span>
        </Link>
        <nav className="sidebar-navigation" aria-label="Dashboard navigation">
          <p className="sidebar-section-label">{t('MENU')}</p>
          {primaryLinks.map(({ title, to, icon: Icon, notification }) => (
            <NavLink key={to} to={to} end={to === '/dashboard'} className={({ isActive }) => `sidebar-link ${isActive ? 'sidebar-link-active' : ''}`}>
              <span className="sidebar-link-icon"><Icon size={18} /></span>
              <span>{t(title)}</span>
              {notification && <span className="sidebar-notification-dot" aria-label="Unread notifications" />}
            </NavLink>
          ))}
          <p className="sidebar-section-label sidebar-account-label">{t('ACCOUNT')}</p>
          {accountLinks.map(({ title, to, icon: Icon }) => (
            <NavLink key={to} to={to} className={({ isActive }) => `sidebar-link ${isActive ? 'sidebar-link-active' : ''}`}>
              <span className="sidebar-link-icon"><Icon size={18} /></span><span>{t(title)}</span>
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="sidebar-tricolor" aria-hidden="true"><i /><i /><i /></div>
          <p>{t('Government schemes')}<br /><strong>{t('at your fingertips')}</strong></p>
          <span className="sidebar-ashoka" aria-hidden="true">✹</span>
          <div className="sidebar-landscape" aria-hidden="true"><i /><i /><i /></div>
        </div>
      </aside>

      {sidebarOpen && <button className="sidebar-backdrop" onClick={() => setSidebarOpen(false)} aria-label={t('Close menu')} />}

      <div className="app-main">
        <header className="dashboard-topbar">
          <button type="button" className="mobile-sidebar-toggle" onClick={() => setSidebarOpen((open) => !open)} aria-label={t(sidebarOpen ? 'Close menu' : 'Open menu')}>
            {sidebarOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
          <form className="dashboard-search" role="search" onSubmit={search}>
            <Search size={17} />
            <input ref={searchRef} value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('Search for schemes, benefits, or ask a question...')} aria-label={t('Search for schemes, benefits, or ask a question...')} />
            <kbd>Ctrl + K</kbd>
          </form>
          <div className="topbar-actions">
            <label className="dashboard-language"><Globe2 size={15} /><span className="sr-only">{t('Language')}</span><select value={i18n.resolvedLanguage ?? 'en'} onChange={(event) => void changeLanguage(event.target.value)} aria-label={t('Language')}>{interfaceLanguages.map((languageOption) => <option key={languageOption.code} value={languageOption.code}>{languageOption.nativeName}</option>)}</select><ChevronDown size={13} /></label>
            <Link to="/notifications" className="topbar-icon-button" aria-label={t('Notifications')}><Bell size={19} /><i /></Link>
            <div className="profile-menu-wrap">
              <button type="button" className="profile-menu-button" onClick={() => setProfileOpen((open) => !open)} aria-expanded={profileOpen}>
                {profilePhotoUrl ? <img src={profilePhotoUrl} alt="" /> : <span className="profile-avatar-fallback"><UserRound size={17} /></span>}
                <span className="profile-name">{displayName}</span><ChevronDown size={14} />
              </button>
              {profileOpen && <div className="profile-dropdown">
                <Link to="/profile"><UserRound size={15} /> {t('My profile')}</Link>
                <Link to="/settings"><Settings size={15} /> {t('Settings')}</Link>
                <button type="button" onClick={handleSignOut}><LogOut size={15} /> {t('Sign out')}</button>
              </div>}
            </div>
          </div>
        </header>
        {(signOutError || languageError) && <p className="dashboard-alert dashboard-inline-alert" role="alert">{t(signOutError || languageError)}</p>}
        <div className="dashboard-content"><Outlet /></div>
        <nav className="mobile-bottom-nav" aria-label="Quick navigation">
          {primaryLinks.slice(0, 5).map(({ title, to, icon: Icon }) => (
            <NavLink key={to} to={to} className={({ isActive }) => `mobile-bottom-link ${isActive ? 'mobile-bottom-active' : ''}`}>
            <Icon size={18} /><span>{t(title === 'Explore Schemes' ? 'Explore Schemes' : title === 'Eligibility Check' ? 'Eligibility Check' : title)}</span>
            </NavLink>
          ))}
        </nav>
      </div>
      <FloatingAssistant />
    </div>
  );
}
