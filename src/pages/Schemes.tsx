import { Search, SlidersHorizontal } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import SchemeCard from '../components/SchemeCard';
import { useDashboardData } from '../hooks/useDashboardData';
import { schemes as localSchemes } from '../data/schemes';
import { canonicalSchemeCategory, schemeCategories } from '../services/schemeCategories';
import type { Scheme } from '../types';

export default function Schemes() {
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const [q, setQ] = useState(searchParams.get('q') ?? '');
  const [cat, setCat] = useState(searchParams.get('category') ?? 'All');
  const { data, loading } = useDashboardData();
  const catalogue = data?.schemes.length ? data.schemes : localSchemes;
  const cats = ['All', ...schemeCategories];

  useEffect(() => {
    setQ(searchParams.get('q') ?? '');
    setCat(searchParams.get('category') ?? 'All');
  }, [searchParams]);

  const filtered = useMemo(() => catalogue.filter((scheme) => (
    categoryMatches(scheme, cat)
      && `${scheme.name} ${scheme.short} ${scheme.tags.join(' ')}`.toLowerCase().includes(q.toLowerCase())
  )), [catalogue, cat, q]);

  return (
    <main className="mx-auto max-w-7xl px-5 py-8 sm:px-7">
      <div className="max-w-3xl">
        <div className="text-xs font-black uppercase tracking-[.2em] text-emerald-700">{t('Scheme finder')}</div>
        <h1 className="mt-2 text-3xl font-black tracking-tight text-slate-950 sm:text-4xl">{t('Find government support that fits your situation.')}</h1>
        <p className="mt-3 text-sm text-slate-500">{t('Browse scheme records and follow each link to verify details with an official source.')}</p>
      </div>
      <div className="mt-6 flex flex-col gap-3 lg:flex-row">
        <div className="relative flex-1">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={19} />
          <input value={q} onChange={(event) => setQ(event.target.value)} placeholder={t('Search scholarships, jobs, farmers, housing...')} className="w-full rounded-xl border border-slate-200 bg-white py-3 pl-11 pr-4 text-sm outline-none ring-emerald-200 focus:ring-4" />
        </div>
        <div className="flex items-center gap-2 overflow-auto rounded-xl border border-slate-200 bg-white p-1">
          <SlidersHorizontal size={17} className="mx-2 shrink-0 text-slate-400" />
          {cats.map((category) => <button key={category} onClick={() => setCat(category)} className={`whitespace-nowrap rounded-lg px-3 py-2 text-xs font-bold ${cat.toLowerCase() === category.toLowerCase() ? 'bg-emerald-700 text-white' : 'text-slate-500 hover:bg-slate-100'}`}>{category === 'All' ? t('All') : t(category)}</button>)}
        </div>
      </div>
      <div className="mt-7 flex flex-wrap items-center justify-between gap-2 text-sm text-slate-500"><span>{loading ? t('Loading scheme catalogue…') : t('{{count}} schemes', { count: filtered.length })}</span><span className="text-xs">{t('Starter catalogue • check current rules with the official source')}</span></div>
      {filtered.length ? <div className="mt-4 grid gap-4 md:grid-cols-2 lg:grid-cols-3">{filtered.map((scheme) => <SchemeCard key={scheme.id} scheme={scheme} />)}</div> : <div className="mt-4 rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center text-sm text-slate-500">{t('No schemes match this category and search.')}</div>}
    </main>
  );
}

function categoryMatches(scheme: Scheme, category: string) {
  if (category === 'All') return true;
  return canonicalSchemeCategory(scheme.category) === canonicalSchemeCategory(category);
}
