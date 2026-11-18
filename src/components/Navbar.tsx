import { ChevronDown, Globe2, LogIn, Menu, X } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import BrandLogo from './BrandLogo';

const links = [
  { label: 'Home', to: '/login' },
  { label: 'Explore Schemes', to: '/login' },
  { label: 'How It Works', to: '/login' },
  { label: 'About', to: '/login' },
];

export default function Navbar() {
  const [open, setOpen] = useState(false);

  return (
    <header className="landing-header">
      <div className="landing-header-inner">
        <Link to="/login" className="landing-brand" aria-label="BharatSathi AI">
          <BrandLogo className="landing-logo" />
          <span><strong>BharatSathi <em>AI</em></strong><small>Your Government Benefits Companion</small></span>
        </Link>
        <nav className="landing-nav" aria-label="Main navigation">
          {links.map(({ label, to }, index) => <Link key={label} to={to} className={index === 0 ? 'landing-nav-active' : ''}>{label}</Link>)}
        </nav>
        <div className="landing-header-actions">
          <Link to="/login" className="landing-language"><Globe2 size={14} /> English <ChevronDown size={13} /></Link>
          <Link to="/login" className="landing-signin"><LogIn size={15} /> Sign In</Link>
          <button type="button" className="landing-menu-button" onClick={() => setOpen((value) => !value)} aria-label={open ? 'Close menu' : 'Open menu'} aria-expanded={open}>
            {open ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>
      </div>
      {open && <nav className="landing-mobile-nav" aria-label="Mobile navigation">{links.map(({ label, to }) => <Link key={label} to={to} onClick={() => setOpen(false)}>{label}</Link>)}<Link to="/login" onClick={() => setOpen(false)}>Sign In</Link></nav>}
    </header>
  );
}
