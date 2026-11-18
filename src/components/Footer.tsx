import { Heart } from 'lucide-react';
import { Link } from 'react-router-dom';
import BrandLogo from './BrandLogo';

const productLinks = [
  { label: 'Home', to: '/' },
  { label: 'Schemes', to: '/schemes' },
  { label: 'Eligibility', to: '/eligibility' },
  { label: 'AI Assistant', to: '/assistant' },
  { label: 'My Schemes', to: '/dashboard' },
];

export default function Footer() {
  return (
    <footer className="site-footer">
      <div className="mx-auto max-w-7xl px-5 py-10 sm:px-8 sm:py-12">
        <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-[1.4fr_.8fr_.8fr]">
          <div>
            <Link to="/" className="inline-flex items-center gap-2.5">
              <BrandLogo className="brand-emblem brand-emblem-footer" />
              <span className="text-lg font-black tracking-tight text-white">BharatSathi <span className="text-emerald-300">AI</span></span>
            </Link>
            <p className="mt-2 text-sm text-emerald-50/75">Your Government Benefits Companion</p>
            <p className="mt-4 max-w-sm text-xs leading-5 text-emerald-50/65">Understand your options, prepare for the next step, and find official government scheme information in one place.</p>
          </div>
          <div>
            <h2 className="text-xs font-bold uppercase tracking-[.15em] text-white">Explore</h2>
            <div className="mt-4 grid gap-2.5">
              {productLinks.map(({ label, to }) => <Link key={to} to={to} className="w-fit text-xs text-emerald-50/75 transition hover:text-white">{label}</Link>)}
            </div>
          </div>
          <div>
            <h2 className="text-xs font-bold uppercase tracking-[.15em] text-white">Official resources</h2>
            <div className="mt-4 grid gap-2.5">
              <a href="https://www.india.gov.in/" target="_blank" rel="noreferrer" className="w-fit text-xs text-emerald-50/75 transition hover:text-white">India.gov.in</a>
              <a href="https://www.myscheme.gov.in/" target="_blank" rel="noreferrer" className="w-fit text-xs text-emerald-50/75 transition hover:text-white">myScheme</a>
              <a href="https://scholarships.gov.in/" target="_blank" rel="noreferrer" className="w-fit text-xs text-emerald-50/75 transition hover:text-white">National Scholarship Portal</a>
            </div>
          </div>
        </div>
        <div className="mt-9 border-t border-white/10 pt-5">
          <p className="max-w-4xl text-[11px] leading-5 text-emerald-50/65">AI guidance is informational and does not guarantee eligibility. Scheme rules may change; always verify eligibility and application requirements with the official government department or portal.</p>
          <div className="mt-4 flex flex-col gap-2 text-[11px] text-emerald-50/55 sm:flex-row sm:items-center sm:justify-between">
            <p>© 2026 BharatSathi AI. Built for citizens of India.</p>
            <p className="inline-flex items-center gap-1.5">Made with <Heart size={12} className="text-orange-300" fill="currentColor" /> for Bharat</p>
          </div>
        </div>
      </div>
    </footer>
  );
}
