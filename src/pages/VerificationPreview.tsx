import {
  ArrowRight,
  ArrowUpRight,
  BadgeCheck,
  BriefcaseBusiness,
  Check,
  ClipboardCheck,
  FileCheck2,
  FileText,
  GraduationCap,
  Landmark,
  LockKeyhole,
  Mail,
  Search,
  ShieldCheck,
  X,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import BrandLogo from '../components/BrandLogo';

export default function VerificationPreview() {
  return (
    <main className="verification-preview-page">
      <header className="verification-preview-heading">
        <span className="verification-preview-eyebrow"><span className="tricolor-mark"><i /><i /><i /></span> AUTHENTICATION DESIGN SYSTEM</span>
        <h1>BharatSathi AI <span>Email verification</span></h1>
        <p>One trusted identity, from inbox to verified account.</p>
      </header>
      <div className="verification-preview-grid">
        <EmailCard />
        <div className="verification-preview-states">
          <SuccessCard />
          <ErrorCard />
        </div>
      </div>
      <p className="verification-preview-caption">A unified, Firebase-powered verification journey · Desktop and mobile ready</p>
    </main>
  );
}

function VerificationBrand({ email = false }: { email?: boolean }) {
  return (
    <div className={`verification-brand ${email ? 'verification-email-brand' : ''}`}>
      <BrandLogo className="verification-brand-logo" />
      <span><strong>BharatSathi <em>AI</em></strong><small>Your Personal AI Government Benefits Assistant</small></span>
    </div>
  );
}

function EmailCard() {
  const features = [
    { title: 'Find Schemes', icon: <Search size={17} /> },
    { title: 'Understand Eligibility', icon: <ShieldCheck size={17} /> },
    { title: 'Prepare Documents', icon: <FileCheck2 size={17} /> },
    { title: 'Apply with Confidence', icon: <ArrowRight size={17} /> },
  ];

  return (
    <article className="verification-email-card">
      <div className="verification-email-ribbon" aria-hidden="true"><i /><i /><i /></div>
      <VerificationBrand email />
      <div className="verification-email-body">
        <div className="verification-email-copy">
          <span className="verification-email-kicker">YOUR NEXT STEP STARTS HERE</span>
          <h2>Welcome to BharatSathi AI <span aria-hidden="true">👋</span></h2>
          <p className="verification-email-greeting">Hi Prudhvi,</p>
          <p>Thanks for creating your BharatSathi AI account. Please verify your email address to activate your account and continue using BharatSathi AI.</p>
        </div>
        <EmailIllustration />
      </div>
      <Link to="/verify?mode=pending" className="verification-email-cta"><Mail size={18} /> VERIFY MY EMAIL <ArrowRight size={17} /></Link>
      <div className="verification-email-features">
        {features.map((feature) => <div key={feature.title}><span>{feature.icon}</span><strong>{feature.title}</strong></div>)}
      </div>
      <div className="verification-email-security"><LockKeyhole size={17} /><span>For your security, never share your verification link, password, or OTP with anyone.</span></div>
      <p className="verification-email-ignore">If you didn&apos;t create a BharatSathi AI account, you can safely ignore this email.</p>
      <footer className="verification-email-footer">
        <IndiaSkyline />
        <strong>BharatSathi AI</strong>
        <span>Your Personal AI Government Benefits Assistant</span>
        <small>© 2026 BharatSathi AI. All rights reserved.</small>
      </footer>
    </article>
  );
}

function EmailIllustration() {
  return (
    <div className="verification-email-illustration" aria-label="Laptop, email and verified check illustration">
      <span className="verification-illustration-orbit" />
      <div className="verification-laptop">
        <div className="verification-laptop-screen">
          <div className="verification-laptop-bar"><i /><i /><i /></div>
          <div className="verification-laptop-content"><span /><span /><b><Check size={15} /></b></div>
        </div>
        <div className="verification-laptop-base" />
      </div>
      <div className="verification-envelope"><Mail size={31} /><span><BadgeCheck size={18} /></span></div>
      <span className="verification-illustration-dot verification-dot-one" />
      <span className="verification-illustration-dot verification-dot-two" />
    </div>
  );
}

function SuccessCard() {
  return (
    <article className="verification-result-card verification-result-success">
      <div className="verification-result-topline"><VerificationBrand /><span className="verification-state-pill">ACCOUNT SECURITY</span></div>
      <div className="verification-result-content">
        <span className="verification-result-icon"><BadgeCheck size={35} /></span>
        <span className="verification-result-eyebrow">IDENTITY CONFIRMED</span>
        <h2>Email Verified Successfully <span aria-hidden="true">🎉</span></h2>
        <p>Your email has been verified. Your BharatSathi AI account is now active. You can explore government schemes, check eligibility, prepare documents, and get step-by-step application guidance.</p>
        <Link to="/login" className="verification-primary-button">Continue to BharatSathi AI <ArrowRight size={17} /></Link>
        <span className="verification-result-redirect"><ArrowUpRight size={14} /> Redirecting to your dashboard in 5 seconds...</span>
      </div>
    </article>
  );
}

function ErrorCard() {
  return (
    <article className="verification-result-card verification-result-error">
      <div className="verification-result-topline"><VerificationBrand /><span className="verification-state-pill">ACCOUNT SECURITY</span></div>
      <div className="verification-error-layout">
        <span className="verification-result-icon"><X size={32} /></span>
        <div>
          <span className="verification-result-eyebrow">LINK NOT CONFIRMED</span>
          <h2>Email Verification Failed</h2>
          <p>The verification link is invalid or has expired.</p>
          <div className="verification-error-actions">
            <Link to="/verify?mode=pending" className="verification-primary-button"><Mail size={16} /> Resend Verification Email</Link>
            <Link to="/login" className="verification-outline-button"><ArrowRight size={15} /> Try Again</Link>
          </div>
        </div>
      </div>
      <p className="verification-error-help"><ShieldCheck size={14} /> Your account stays safe. Request a fresh link to continue.</p>
    </article>
  );
}

function IndiaSkyline() {
  return (
    <div className="verification-india-skyline" aria-hidden="true">
      <Landmark size={26} />
      <span /><span /><span /><span />
      <BriefcaseBusiness size={19} />
      <GraduationCap size={22} />
      <ClipboardCheck size={18} />
      <FileText size={17} />
    </div>
  );
}
