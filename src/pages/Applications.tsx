import { ArrowRight, ArrowUpRight, FileText, Plus, ShieldCheck } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../context/AuthContext';
import { useDashboardData } from '../hooks/useDashboardData';
import { schemes as localSchemes } from '../data/schemes';
import { applicationStatuses, createApplication, updateApplication } from '../services/applications';
import { getDashboardTimestamp } from '../services/dashboard';
import { emailApplicationStatusUpdate } from '../services/notifications';

export default function Applications() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { data, loading, error } = useDashboardData();
  const [schemeId, setSchemeId] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [drafts, setDrafts] = useState<Record<string, { status: string; applicationReference: string; notes: string }>>({});
  const catalogue = data?.schemes.length ? data.schemes : localSchemes;
  const applications = useMemo(
    () => [...(data?.applications ?? [])].sort((a, b) => (
      (getDashboardTimestamp(b.updatedAt)?.getTime() ?? 0)
      - (getDashboardTimestamp(a.updatedAt)?.getTime() ?? 0)
    )),
    [data?.applications],
  );

  const startTracking = async () => {
    const scheme = catalogue.find((item) => item.id === schemeId);
    if (!user || !scheme) return;
    setBusy(true);
    setMessage('');
    try {
      await createApplication(user.uid, scheme);
      setSchemeId('');
      setMessage('Application tracker created. Continue the official application on the government portal.');
    } catch (createError) {
      console.error('Unable to create application tracker:', createError);
      setMessage('Could not create the tracker. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const saveChanges = async (application: (typeof applications)[number]) => {
    const draft = drafts[application.id] ?? {
      status: displayApplicationStatus(application.status),
      applicationReference: application.applicationReference ?? '',
      notes: application.notes ?? '',
    };
    setBusy(true);
    setMessage('');
    try {
      const previousStatus = displayApplicationStatus(application.status);
      const statusChanged = draft.status !== previousStatus;
      await updateApplication(application.id, draft, draft.status === 'Applied' && previousStatus !== 'Applied');
      if (statusChanged && draft.status !== 'Not Started') {
        try {
          await emailApplicationStatusUpdate(application.id);
          setMessage('Your tracker update was saved, and its notification was sent.');
        } catch (notificationError) {
          console.error('Application tracker saved, but its notification could not be sent:', notificationError);
          setMessage('Your tracker update was saved, but an email notification could not be sent. Check notification service configuration.');
        }
      } else {
        setMessage('Your tracker update was saved.');
      }
    } catch (updateError) {
      console.error('Unable to update application tracker:', updateError);
      setMessage('Could not update this application. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="mx-auto max-w-6xl px-5 py-10">
      <header className="max-w-3xl">
        <div className="text-xs font-black uppercase tracking-[.2em] text-orange-600">{t('Application tracking')}</div>
        <h1 className="mt-2 text-3xl font-black tracking-tight">{t('My Applications')}</h1>
        <p className="mt-3 text-sm leading-6 text-slate-500">{t('Track preparation and status updates. BharatSathi does not submit applications to government departments.')}</p>
      </header>

      <section className="mt-7 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <h2 className="flex items-center gap-2 text-base font-black"><Plus size={18} className="text-emerald-700" />{t('Start tracking a scheme')}</h2>
        <div className="mt-4 flex flex-col gap-3 sm:flex-row">
          <select value={schemeId} onChange={(event) => setSchemeId(event.target.value)} className="min-w-0 flex-1 rounded-xl border border-slate-200 px-3 py-3 text-sm">
            <option value="">{t('Choose a scheme')}</option>
            {catalogue.map((scheme) => <option key={scheme.id} value={scheme.id}>{scheme.name}</option>)}
          </select>
          <button type="button" disabled={!schemeId || busy} onClick={() => void startTracking()} className="solid-green-button justify-center disabled:opacity-50">
            {busy ? t('Creating…') : t('Create tracker')}
          </button>
        </div>
        {message && <p className="mt-3 text-sm text-slate-600" role="status">{t(message)}</p>}
      </section>

      {error && <p className="mt-4 rounded-xl bg-rose-50 p-4 text-sm text-rose-800" role="alert">{t('Some live dashboard data could not be loaded: {{error}}', { error })}</p>}
      {loading ? <p className="mt-8 text-sm text-slate-500">{t('Loading your applications…')}</p> : applications.length ? (
        <div className="mt-5 grid gap-4">
          {applications.map((application) => {
            const scheme = catalogue.find((item) => item.id === application.schemeId);
            return (
              <article key={application.id} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                  <div className="flex gap-3">
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-emerald-50 text-emerald-700"><FileText size={19} /></span>
                    <div>
                      <h2 className="font-black">{application.name ?? scheme?.name ?? application.schemeId ?? t('Government scheme')}</h2>
                      <p className="mt-1 text-xs text-slate-500">{t(application.category ?? scheme?.category ?? 'Other')}</p>
                      <p className="mt-1 text-xs text-slate-500">{t('Last updated by you')}: {formatDate(application.lastUpdated ?? application.updatedAt ?? application.createdAt)}</p>
                      {application.appliedDate !== null && application.appliedDate !== undefined && <p className="mt-1 text-xs text-slate-500">{t('Applied')}: {formatDate(application.appliedDate)}</p>}
                      {application.applicationReference && <p className="mt-1 text-xs text-slate-500">{t('Reference')}: {application.applicationReference}</p>}
                      <p className="mt-2 text-sm text-slate-600">{application.nextAction ?? t('Review the official requirements and prepare your documents.')}</p>
                    </div>
                  </div>
                </div>
                <ApplicationTimeline status={displayApplicationStatus(application.status)} />
                <div className="mt-4 grid gap-3 border-t border-slate-100 pt-4 sm:grid-cols-2">
                  <label className="grid gap-1 text-xs font-bold text-slate-500">
                    {t('Status')}
                    <select value={(drafts[application.id]?.status ?? displayApplicationStatus(application.status))} onChange={(event) => setDrafts((current) => ({
                      ...current,
                      [application.id]: { ...getDraft(application, current), status: event.target.value },
                    }))} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800">
                      {applicationStatuses.map((status) => <option key={status}>{t(status)}</option>)}
                    </select>
                  </label>
                  <label className="grid gap-1 text-xs font-bold text-slate-500">
                    {t('Application reference')}
                    <input value={drafts[application.id]?.applicationReference ?? application.applicationReference ?? ''} onChange={(event) => setDrafts((current) => ({
                      ...current,
                      [application.id]: { ...getDraft(application, current), applicationReference: event.target.value },
                    }))} maxLength={100} className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-normal text-slate-800" />
                  </label>
                  <label className="grid gap-1 text-xs font-bold text-slate-500 sm:col-span-2">
                    {t('Notes')}
                    <textarea value={drafts[application.id]?.notes ?? application.notes ?? ''} onChange={(event) => setDrafts((current) => ({
                      ...current,
                      [application.id]: { ...getDraft(application, current), notes: event.target.value },
                    }))} maxLength={2000} rows={2} className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-normal text-slate-800" />
                  </label>
                  <div className="flex flex-wrap items-center justify-between gap-3 sm:col-span-2">
                    <span className="inline-flex items-center gap-1 text-xs text-slate-500"><ShieldCheck size={14} />{t('Personal tracker only. Status entered manually; BharatSathi does not receive official application updates.')}</span>
                    <button type="button" disabled={busy} onClick={() => void saveChanges(application)} className="solid-green-button justify-center disabled:opacity-50">
                      {t('Save tracker update')} <ArrowRight size={15} />
                    </button>
                  </div>
                </div>
                <div className="mt-3 flex justify-end">
                  {(application.officialApplicationUrl || scheme?.officialUrl) && <a href={application.officialApplicationUrl || scheme?.officialUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs font-black text-emerald-700">{application.officialApplicationUrl ? t('Continue to Official Application Portal') : t('View Official Scheme Portal')} <ArrowUpRight size={14} /></a>}
                </div>
                {!application.officialApplicationUrl && !scheme && <p className="mt-3 text-xs text-slate-500">{t('The scheme is no longer in the catalogue. Review your saved tracker details.')}</p>}
              </article>
            );
          })}
        </div>
      ) : <div className="mt-6 rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">{t('No applications are being tracked yet. Choose a scheme above to create a private tracker.')}</div>}
    </main>
  );
}

function getDraft(
  application: { id: string; status?: string; applicationReference?: string; notes?: string },
  drafts: Record<string, { status: string; applicationReference: string; notes: string }>,
) {
  return drafts[application.id] ?? {
    status: displayApplicationStatus(application.status),
    applicationReference: application.applicationReference ?? '',
    notes: application.notes ?? '',
  };
}

function displayApplicationStatus(status?: string) {
  const legacy: Record<string, string> = {
    draft: 'Not Started',
    'ready to apply': 'Not Started',
    submitted: 'Applied',
    'needs action': 'Documents Pending',
    'in progress': 'Applied',
  };
  const value = status ?? 'Not Started';
  return legacy[value.toLocaleLowerCase()] ?? (applicationStatuses.includes(value as (typeof applicationStatuses)[number]) ? value : 'Not Started');
}

function ApplicationTimeline({ status }: { status: string }) {
  const { t } = useTranslation();
  const stages = ['Not Started', 'Applied', 'Documents Pending', 'Under Review', 'Approved'];
  const current = stages.indexOf(status);
  const rejected = status === 'Rejected';
  const completed = status === 'Completed';
  const terminal = rejected || completed;
  return <ol className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-5" aria-label={t('Application status timeline')}>
    {stages.map((stage, index) => {
      const active = completed || (!rejected && current >= index) || (rejected && index <= 1);
      return <li key={stage} className="flex items-center gap-2 text-xs">
        <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-full text-[10px] font-black ${active ? 'bg-emerald-700 text-white' : 'bg-slate-100 text-slate-400'}`}>{active ? '✓' : index + 1}</span>
        <span className={active ? 'font-bold text-emerald-800' : 'text-slate-500'}>{t(stage)}</span>
      </li>;
    })}
    {terminal && <li className="col-span-2 text-xs font-bold text-slate-700 sm:col-span-5">{t(status)}</li>}
  </ol>;
}

function formatDate(value: unknown) {
  const date = getDashboardTimestamp(value);
  return date ? new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium' }).format(date) : 'Recently';
}
