import { ArrowRight, CircleHelp, ShieldCheck } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useDashboardData } from '../hooks/useDashboardData';
import { schemes as localSchemes } from '../data/schemes';
import { evaluateSchemeEligibility, getDocumentReadiness } from '../services/eligibility';

export default function Eligibility() {
  const { t } = useTranslation();
  const { data, loading, error } = useDashboardData();
  const catalogue = data?.schemes.length ? data.schemes : localSchemes;
  const results = catalogue.map((scheme) => ({
    scheme,
    match: evaluateSchemeEligibility(
      scheme.eligibilityRules || !localSchemes.find((item) => item.id === scheme.id)?.eligibilityRules
        ? scheme
        : { ...scheme, eligibilityRules: localSchemes.find((item) => item.id === scheme.id)?.eligibilityRules },
      data?.profile,
      data?.documents ?? [],
    ),
  })).sort((left, right) => (
    (right.match.score ?? -1) - (left.match.score ?? -1)
  ));

  return (
    <main className="mx-auto max-w-6xl px-5 py-10">
      <header className="max-w-3xl">
        <div className="text-xs font-black uppercase tracking-[.2em] text-orange-600">{t('Eligibility check')}</div>
        <h1 className="mt-2 text-3xl font-black tracking-tight">{t('Check your eligibility match')}</h1>
        <p className="mt-3 text-sm leading-6 text-slate-500">{t('Scores are calculated only from structured scheme rules and information in your profile. They are not a probability of receiving a benefit or an official decision.')}</p>
        <Link to="/profile" className="mt-4 inline-flex items-center gap-2 rounded-xl bg-emerald-700 px-4 py-2.5 text-sm font-bold text-white">{t('Update my profile')} <ArrowRight size={15} /></Link>
      </header>

      <div className="mt-6 flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-950">
        <ShieldCheck className="mt-0.5 shrink-0" size={18} />
        <p>{t('Based on the information currently available in your profile. Official departments make final eligibility decisions; always review the linked source.')}</p>
      </div>
      <p className="mt-4 text-xs leading-5 text-slate-500">{t('Your uploaded document list is checked against each scheme’s document checklist. Uploaded files are not authenticity-verified.')}</p>
      {error && <p className="mt-4 rounded-xl bg-rose-50 p-4 text-sm text-rose-800" role="alert">{t('Some live dashboard data could not be loaded: {{error}}', { error })}</p>}
      {loading ? <p className="mt-8 text-sm text-slate-500">{t('Loading your profile and scheme rules…')}</p> : results.length ? (
        <div className="mt-6 grid gap-4">
          {results.map(({ scheme, match }) => (
            <article key={scheme.id} className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
              <div className="flex flex-col justify-between gap-4 sm:flex-row">
                <div>
                  <div className="text-[10px] font-black uppercase tracking-wider text-orange-600">{t(scheme.category)} · {t(scheme.state)}</div>
                  <h2 className="mt-1 text-lg font-black">{scheme.name}</h2>
                  <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">{scheme.short}</p>
                </div>
                <div className="shrink-0 rounded-2xl bg-emerald-50 px-4 py-3 text-center">
                  <strong className="block text-2xl font-black text-emerald-800">{match.score === null ? '—' : `${match.score}%`}</strong>
                  <span className="text-[10px] font-bold uppercase tracking-wide text-emerald-800">{t(match.label)}</span>
                </div>
              </div>
              {match.factors.length > 0 && <ul className="mt-4 grid gap-2 sm:grid-cols-2">
                {match.factors.map((factor) => (
                  <li key={factor.label} className={`rounded-xl px-3 py-2 text-xs font-semibold ${factor.status === 'met' ? 'bg-emerald-50 text-emerald-800' : factor.status === 'unmet' ? 'bg-amber-50 text-amber-900' : factor.status === 'uploaded' ? 'bg-blue-50 text-blue-800' : 'bg-slate-50 text-slate-600'}`}>
                    {factor.status === 'met' ? '✓ ' : factor.status === 'unmet' ? '⚠ ' : factor.status === 'uploaded' ? '↑ ' : '• '}{t(factor.label)}{factor.status === 'uploaded' ? ` · ${t('Uploaded; not authenticity-verified')}` : ''}
                  </li>
                ))}
              </ul>}
              {match.score === null && <p className="mt-4 flex items-start gap-2 text-xs leading-5 text-slate-500"><CircleHelp size={15} className="mt-0.5 shrink-0" />{match.requiresVerification
                ? t('There is not enough verified structured eligibility information to calculate a reliable match. Review the official source for current requirements.')
                : t('Structured eligibility rules are not available for this scheme, so BharatSathi cannot calculate a score. Review the official source for current requirements.')}</p>}
              {match.missingRequirements.length > 0 && <p className="mt-3 text-xs text-amber-800">{t('Missing or unmet')}: {match.missingRequirements.map((item) => t(item)).join(', ')}</p>}
              {scheme.documents.length > 0 && <div className="mt-4 border-t border-slate-100 pt-4">
                <h3 className="text-xs font-black text-slate-700">{t('Required document checklist')}</h3>
                <ul className="mt-2 grid gap-2 sm:grid-cols-2">
                  {scheme.documents.map((document) => {
                    const status = getDocumentReadiness(document, data?.documents ?? []);
                    return <li key={document} className={`rounded-xl px-3 py-2 text-xs ${status === 'uploaded' ? 'bg-blue-50 text-blue-800' : 'bg-amber-50 text-amber-900'}`}>
                      {status === 'uploaded' ? '↑ ' : '⚠ '}{document} · {status === 'uploaded' ? t('Uploaded; not authenticity-verified') : t('Not uploaded')}
                    </li>;
                  })}
                </ul>
                <Link to="/documents" className="mt-3 inline-flex items-center gap-1 text-xs font-black text-emerald-700">{t('Manage my documents')} <ArrowRight size={14} /></Link>
              </div>}
              <Link to={`/schemes/${scheme.id}`} className="mt-4 inline-flex items-center gap-2 text-xs font-black text-emerald-700">{t('Review official details')} <ArrowRight size={14} /></Link>
            </article>
          ))}
        </div>
      ) : <div className="mt-6 rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">{t('No schemes have structured rules available for scoring yet.')}</div>}
    </main>
  );
}
