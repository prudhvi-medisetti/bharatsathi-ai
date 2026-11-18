import { ArrowRight, ArrowUpRight, CheckCircle2, ExternalLink, FileText, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../context/AuthContext';
import { useDashboardData } from '../hooks/useDashboardData';
import { schemes as localSchemes } from '../data/schemes';
import { createApplication } from '../services/applications';
import { evaluateSchemeEligibility, getDocumentReadiness } from '../services/eligibility';

export default function SchemeDetail() {
  const { t } = useTranslation();
  const { schemeId, id } = useParams();
  const { data, loading } = useDashboardData();
  const { user } = useAuth();
  const [startingApplication, setStartingApplication] = useState(false);
  const [applicationMessage, setApplicationMessage] = useState('');
  const [applicationStarted, setApplicationStarted] = useState(false);
  const selectedId = schemeId ?? id;
  const scheme = data?.schemes.find((item) => item.id === selectedId) ?? localSchemes.find((item) => item.id === selectedId);

  if (!scheme && loading) return <main className="mx-auto max-w-4xl px-5 py-20 text-center text-slate-500">{t('Loading scheme details…')}</main>;
  if (!scheme) return <main className="mx-auto max-w-4xl px-5 py-20"><h1 className="text-3xl font-black">{t('Scheme not found')}</h1><Link className="mt-4 inline-block text-emerald-700" to="/schemes">{t('Back to schemes')}</Link></main>;

  const localScheme = localSchemes.find((item) => item.id === scheme.id);
  const schemeWithKnownRules = scheme.eligibilityRules || !localScheme?.eligibilityRules
    ? scheme
    : { ...scheme, eligibilityRules: localScheme.eligibilityRules };
  const eligibility = evaluateSchemeEligibility(schemeWithKnownRules, data?.profile, data?.documents ?? []);
  const existingApplication = data?.applications.some((application) => application.schemeId === scheme.id) ?? false;
  const beginApplication = async () => {
    if (!user || startingApplication) return;
    setStartingApplication(true);
    setApplicationMessage('');
    try {
      if (!existingApplication) {
        await createApplication(user.uid, scheme);
      }
      setApplicationStarted(true);
    } catch (error) {
      console.error('Unable to start scheme application preparation:', error);
      setApplicationMessage(t('Could not start your application preparation. Please try again.'));
    } finally {
      setStartingApplication(false);
    }
  };

  return (
    <main className="mx-auto max-w-5xl px-5 py-8 sm:px-7">
      <Link to="/schemes" className="text-sm font-bold text-slate-500">← {t('All schemes')}</Link>
      <div className="mt-4 rounded-3xl bg-emerald-950 p-7 text-white sm:p-10">
        <div className="flex flex-wrap gap-2"><span className="rounded-full bg-white/10 px-3 py-1 text-xs font-bold">{t(scheme.category)}</span><span className="rounded-full bg-emerald-500/15 px-3 py-1 text-xs font-bold text-emerald-200">{t(scheme.state)}</span></div>
        <h1 className="mt-5 text-3xl font-black sm:text-4xl">{scheme.name}</h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-emerald-50/80">{scheme.short}</p>
        <button type="button" onClick={() => void beginApplication()} disabled={startingApplication} className="mt-6 inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-5 py-3 text-sm font-black text-white hover:bg-emerald-500 disabled:opacity-60">
          {startingApplication ? t('Preparing…') : applicationStarted || existingApplication ? t('View application checklist') : t('Apply / Start Application')} <ArrowRight size={17} />
        </button>
        <p className="mt-3 text-xs leading-5 text-emerald-50/70">{t('Prepare and track your application here. Final submission is handled by the official government portal.')}</p>
      </div>
      {applicationMessage && <p className="mt-4 rounded-xl bg-rose-50 p-4 text-sm text-rose-800" role="alert">{applicationMessage}</p>}
      {applicationStarted && (
        <section className="mt-5 rounded-2xl border border-emerald-200 bg-emerald-50 p-5" aria-live="polite">
          <h2 className="font-black text-emerald-950">{t('Before You Apply')}</h2>
          <ul className="mt-3 space-y-2 text-sm text-emerald-950">
            <li>✓ {t('Eligibility checked')} — {eligibility.score === null ? t('Needs Verification') : t('preliminary profile match only')}</li>
            <li>✓ {t('Required documents')} — {scheme.documents.length ? scheme.documents.join(', ') : t('Review the official requirements')}</li>
            <li>✓ {t('Application portal')} — {t('Official government link')}</li>
            <li>✓ {t('Important instructions')} — {t('Check current deadlines and requirements with the department')}</li>
          </ul>
          <p className="mt-3 text-sm leading-6 text-emerald-900">{t('A private tracker was created with status Not Started. BharatSathi does not submit your application or receive official status updates.')}</p>
          <div className="mt-4 flex flex-wrap gap-3">
            <Link to="/applications" className="inline-flex items-center gap-2 rounded-xl bg-emerald-700 px-4 py-2.5 text-sm font-bold text-white">{t('Open my applications')} <ArrowRight size={15} /></Link>
            <a target="_blank" rel="noreferrer" href={scheme.applicationUrl ?? scheme.officialUrl} className="inline-flex items-center gap-2 rounded-xl border border-emerald-300 bg-white px-4 py-2.5 text-sm font-bold text-emerald-900">{scheme.applicationUrl ? t('Start on official application portal') : t('View official scheme portal')} <ArrowUpRight size={15} /></a>
          </div>
        </section>
      )}
      <div className="mt-5 grid gap-4 md:grid-cols-2">
        <Panel title={t('Your preliminary eligibility match')} icon={<ShieldCheck size={18} />}>
          {loading ? (
            <p className="text-sm leading-6 text-slate-600">{t('Checking your profile and uploaded documents…')}</p>
          ) : eligibility.score === null ? (
            <p className="text-sm leading-6 text-slate-600">{eligibility.requiresVerification
              ? t('Verified structured rules are incomplete for a reliable match. Check the official source before applying.')
              : t('Add more profile information to assess the available eligibility rules.')}</p>
          ) : (
            <>
              <div className="flex items-end gap-2">
                <strong className="text-4xl font-black text-emerald-800">{eligibility.score}%</strong>
                <span className="pb-1 text-sm font-semibold text-slate-600">{t('of assessable checks matched')}</span>
                <span className="pb-1 text-xs font-bold text-emerald-800">{t(eligibility.label)}</span>
              </div>
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100" role="progressbar" aria-label={t('Preliminary eligibility match')} aria-valuenow={eligibility.score} aria-valuemin={0} aria-valuemax={100}>
                <div className="h-full rounded-full bg-emerald-600 transition-all" style={{ width: `${eligibility.score}%` }} />
              </div>
              {!loading && eligibility.factors.length > 0 && <ul className="mt-4 space-y-2">
                {eligibility.factors.map((factor) => (
                  <li key={factor.label} className={`rounded-lg px-3 py-2 text-xs font-semibold ${factor.status === 'met' ? 'bg-emerald-50 text-emerald-800' : factor.status === 'unmet' ? 'bg-amber-50 text-amber-900' : factor.status === 'uploaded' ? 'bg-blue-50 text-blue-800' : 'bg-slate-50 text-slate-600'}`}>
                    {factor.status === 'met' ? '✓ ' : factor.status === 'unmet' ? '⚠ ' : factor.status === 'uploaded' ? '↑ ' : '• '}{t(factor.label)}{factor.status === 'uploaded' ? ` · ${t('Uploaded; not authenticity-verified')}` : ''}
                  </li>
                ))}
              </ul>}
            </>
          )}
          <p className="mt-4 text-xs leading-5 text-slate-500">{t('This is the share of available structured checks that match your profile, not a probability or an official eligibility decision. Verify all requirements with the department.')}</p>
          {!loading && eligibility.missingRequirements.length > 0 && <p className="mt-2 text-xs font-semibold text-amber-800">{t('Missing or unmet')}: {eligibility.missingRequirements.map((item) => t(item)).join(', ')}</p>}
          <Link to="/profile" className="mt-4 inline-flex items-center gap-1 text-xs font-black text-emerald-700">{t('Update my profile')} <ArrowRight size={14} /></Link>
        </Panel>
        <Panel title={t('Benefit')} icon={<CheckCircle2 size={18} />}><p className="text-sm leading-6 text-slate-600">{scheme.benefit}</p></Panel>
        <Panel title={t('Important eligibility')} icon={<CheckCircle2 size={18} />}>{scheme.eligibility.length ? <ul className="space-y-3">{scheme.eligibility.map((item) => <li className="flex gap-2 text-sm text-slate-600" key={item}><span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-600" />{item}</li>)}</ul> : <p className="text-sm leading-6 text-slate-600">{t('Check eligibility requirements on the official scheme portal.')}</p>}</Panel>
        <Panel title={t('Application steps')} icon={<ArrowRight size={18} />}>{scheme.applicationSteps?.length ? <ol className="list-decimal space-y-2 pl-5 text-sm leading-6 text-slate-600">{scheme.applicationSteps.map((step) => <li key={step}>{step}</li>)}</ol> : <p className="text-sm leading-6 text-slate-600">{t('Review the current application steps on the official scheme portal.')}</p>}</Panel>
        <Panel title={t('Documents to prepare')} icon={<FileText size={18} />}>
          {loading ? <p className="text-sm leading-6 text-slate-600">{t('Checking your uploaded documents…')}</p> : scheme.documents.length ? <>
            <ul className="space-y-3">{scheme.documents.map((item) => {
              const status = getDocumentReadiness(item, data?.documents ?? []);
              return <li className="flex items-start justify-between gap-3 text-sm" key={item}>
                <span className="text-slate-600">{item}</span>
                <span className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-bold ${status === 'uploaded' ? 'bg-blue-50 text-blue-800' : 'bg-amber-50 text-amber-900'}`}>
                  {status === 'uploaded' ? t('Uploaded; not authenticity-verified') : t('Not uploaded')}
                </span>
              </li>;
            })}</ul>
            <p className="mt-4 text-xs leading-5 text-slate-500">{t('BharatSathi checks whether a document is on your uploaded list. It does not authenticate the document or replace official verification.')}</p>
            <Link to="/documents" className="mt-4 inline-flex items-center gap-1 text-xs font-black text-emerald-700">{t('Manage my documents')} <ArrowRight size={14} /></Link>
          </> : <p className="text-sm leading-6 text-slate-600">{t('Review the official portal for required documents.')}</p>}
        </Panel>
        <Panel title={t('Department & verification')} icon={<ExternalLink size={18} />}><p className="text-sm leading-6 text-slate-600">{scheme.department}</p><p className="mt-2 text-xs text-slate-400">{t('Last verified')}: {scheme.verified}</p><a className="mt-3 inline-block text-xs font-black text-emerald-700" href={scheme.sourceUrl} target="_blank" rel="noreferrer">{t('View source')}</a></Panel>
      </div>
    </main>
  );
}

function Panel({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="flex items-center gap-2 text-sm font-black"><span className="text-emerald-700">{icon}</span>{title}</div><div className="mt-4">{children}</div></section>;
}
