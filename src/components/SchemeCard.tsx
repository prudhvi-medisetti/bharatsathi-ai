import { ArrowUpRight, Bookmark, CheckCircle2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Scheme } from '../types';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useDashboardData } from '../hooks/useDashboardData';
import { removeSavedScheme, saveScheme } from '../services/schemes';

export default function SchemeCard({ scheme }: { scheme: Scheme }) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { data } = useDashboardData();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const saved = data?.savedSchemes.some((record) => record.schemeId === scheme.id) ?? false;

  const toggleSaved = async () => {
    if (!user || busy) return;
    setBusy(true);
    setError(null);
    try {
      if (saved) await removeSavedScheme(user.uid, scheme.id);
      else await saveScheme(user.uid, scheme.id, scheme.name);
    } catch (saveError) {
      console.error('Unable to update saved scheme:', saveError);
      setError('Could not update your saved schemes. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <article className="group rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:-translate-y-1 hover:shadow-soft">
      <div className="flex items-start justify-between gap-3">
        <div className="flex gap-3">
          <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-orange-50 font-black text-orange-600">{scheme.name.slice(0, 1)}</div>
          <div>
            <div className="flex flex-wrap gap-2">
              <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-500">{t(scheme.category)}</span>
              <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[10px] font-bold text-emerald-700">{t(scheme.state)}</span>
            </div>
            <h3 className="mt-2 text-base font-extrabold text-slate-900">{scheme.name}</h3>
          </div>
        </div>
        <button type="button" onClick={toggleSaved} disabled={busy} aria-label={t(saved ? 'Remove saved scheme' : 'Save scheme')} className={`rounded-full p-2 disabled:opacity-50 ${saved ? 'bg-orange-50 text-orange-600' : 'text-slate-400 hover:bg-slate-100'}`}>
          <Bookmark size={18} fill={saved ? 'currentColor' : 'none'} />
        </button>
      </div>
      <p className="mt-4 text-sm leading-6 text-slate-500">{scheme.short}</p>
      <div className="mt-4 flex items-center gap-2 text-xs font-semibold text-slate-700"><CheckCircle2 size={15} className="text-emerald-500" />{scheme.benefit}</div>
      {error && <p className="mt-3 text-xs text-rose-700" role="alert">{t(error)}</p>}
      <div className="mt-5 flex items-center justify-between border-t border-slate-100 pt-4">
        <span className="text-[11px] text-slate-400">{scheme.verified}</span>
        <Link to={`/schemes/${scheme.id}`} className="flex items-center gap-1 text-sm font-extrabold text-orange-600 group-hover:gap-2">{t('View details')} <ArrowUpRight size={16} /></Link>
      </div>
    </article>
  );
}
