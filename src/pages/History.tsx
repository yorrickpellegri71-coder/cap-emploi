import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Empty, ErrorState, Loading, Modal, Notice, errorMessage, fmtDate } from '../components/ui';
import { useI18n, type TFn } from '../i18n';
import {
  deleteApplication, deleteResponse, exportXlsx, fetchApplications, fetchResponses, saveApplication, saveResponse,
  type ApplicationInput, type ResponseInput,
} from '../lib/api';
import { isoDay } from '../lib/dates';
import { useApp } from '../lib/session';
import { APP_STATUSES, LANGS, PIECES, RESPONSE_TYPES, type Application, type ResponseRow } from '../lib/types';

type Cell = string | number | null;
interface Column<R> { key: string; label: string; value: (r: R) => Cell; render?: (r: R) => ReactNode; date?: boolean }

/** Source lisible : canal de la cible (« channel:linkedin ») ou nom du site. */
export const sourceLabel = (s: string, t: TFn) => (s.startsWith('channel:') ? t(`channels.${s.slice(8)}`) : s);

/** Tableau triable par clic sur l'en-tête. */
function SortableTable<R extends { id: string }>({ rows, columns, sort, onSort, actions }: {
  rows: R[]; columns: Column<R>[]; sort: { key: string; asc: boolean }; onSort: (key: string) => void; actions: (r: R) => ReactNode;
}) {
  const { t } = useI18n();
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} aria-sort={sort.key === c.key ? (sort.asc ? 'ascending' : 'descending') : 'none'}>
                <button type="button" className="th-sort" onClick={() => onSort(c.key)}>
                  {c.label}<span aria-hidden="true">{sort.key === c.key ? (sort.asc ? ' ▲' : ' ▼') : ''}</span>
                </button>
              </th>
            ))}
            <th><span className="sr-only">{t('history.actions')}</span></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              {columns.map((c) => <td key={c.key} data-label={c.label} className={c.date ? 'nowrap' : undefined}>{c.render ? c.render(r) : (c.value(r) ?? '—')}</td>)}
              <td className="row-actions">{actions(r)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function useSorted<R>(rows: R[], columns: Column<R>[], initial: string) {
  const [sort, setSort] = useState({ key: initial, asc: false });
  const sorted = useMemo(() => {
    const col = columns.find((c) => c.key === sort.key) ?? columns[0];
    return [...rows].sort((a, b) => {
      const x = col.value(a), y = col.value(b);
      if (x === y) return 0;
      if (x === null || x === '') return 1;
      if (y === null || y === '') return -1;
      const cmp = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), undefined, { sensitivity: 'base', numeric: true });
      return sort.asc ? cmp : -cmp;
    });
  }, [rows, columns, sort]);
  const onSort = (key: string) => setSort((s) => (s.key === key ? { key, asc: !s.asc } : { key, asc: true }));
  return { sorted, sort, onSort };
}

const inPeriod = (d: string, from: string, to: string) => (!from || d >= from) && (!to || d <= to);
const matches = (q: string, ...fields: string[]) => !q || fields.join(' ').toLowerCase().includes(q.trim().toLowerCase());

/** Exporte les colonnes affichées ; les dates partent en vraies dates Excel. */
function toExcel<R>(sheet: string, columns: Column<R>[], rows: R[], name: string) {
  const data = rows.map((r) => columns.map((c) => {
    const v = c.value(r);
    return c.date && typeof v === 'string' && v ? new Date(`${v}T12:00:00`) : v;
  }));
  return exportXlsx(sheet, columns.map((c) => c.label), data, `${name}-${isoDay()}.xlsx`);
}

function PeriodFilter({ from, to, setFrom, setTo, id }: { from: string; to: string; setFrom: (v: string) => void; setTo: (v: string) => void; id: string }) {
  const { t } = useI18n();
  return (
    <>
      <div className="field">
        <label htmlFor={`${id}-from`}>{t('history.from')}</label>
        <input id={`${id}-from`} type="date" className="input" value={from} onChange={(e) => setFrom(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor={`${id}-to`}>{t('history.to')}</label>
        <input id={`${id}-to`} type="date" className="input" value={to} onChange={(e) => setTo(e.target.value)} />
      </div>
    </>
  );
}

// ───────────── Mes candidatures ─────────────

function ApplicationForm({ app, onClose, onSaved }: { app: Application | null; onClose: () => void; onSaved: (a: Application) => void }) {
  const { t } = useI18n();
  const { profile } = useApp();
  const [form, setForm] = useState<ApplicationInput>(() => app ? { ...app } : {
    target_id: null, applied_on: isoDay(), company: '', job_title: '', source: '', lang: profile.doc_lang,
    documents: ['email', 'letter', 'cv'], status: 'sent', followup_on: null, notes: '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const set = <K extends keyof ApplicationInput>(k: K, v: ApplicationInput[K]) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!form.company.trim()) { setError(new Error(t('targets.companyRequired'))); return; }
    setBusy(true);
    try {
      onSaved(await saveApplication({ ...form, company: form.company.trim(), followup_on: form.followup_on || null }, app?.id));
      onClose();
    } catch (err) { setError(err); setBusy(false); }
  };

  return (
    <Modal title={app ? app.company : t('history.apps.new')} onClose={onClose}>
      <form onSubmit={submit} className="stack-lg">
        {error != null && <Notice tone="error">{errorMessage(error, t)}</Notice>}
        <div className="grid-2">
          <div className="field">
            <label htmlFor="af-date">{t('history.date')} *</label>
            <input id="af-date" type="date" className="input" required value={form.applied_on} onChange={(e) => set('applied_on', e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="af-company">{t('targets.company')} *</label>
            <input id="af-company" className="input" required value={form.company} onChange={(e) => set('company', e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="af-job">{t('history.job')}</label>
            <input id="af-job" className="input" value={form.job_title} onChange={(e) => set('job_title', e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="af-source">{t('history.source')}</label>
            <input id="af-source" className="input" value={sourceLabel(form.source, t)} onChange={(e) => set('source', e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="af-lang">{t('history.lang')}</label>
            <select id="af-lang" className="input" value={form.lang} onChange={(e) => set('lang', e.target.value as ApplicationInput['lang'])}>
              {LANGS.map((l) => <option key={l} value={l}>{t(`langs.${l}`)}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="af-status">{t('history.status')}</label>
            <select id="af-status" className="input" value={form.status} onChange={(e) => set('status', e.target.value as ApplicationInput['status'])}>
              {APP_STATUSES.map((s) => <option key={s} value={s}>{t(`history.statuses.${s}`)}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="af-follow">{t('history.followup')}</label>
            <input id="af-follow" type="date" className="input" value={form.followup_on ?? ''} onChange={(e) => set('followup_on', e.target.value || null)} />
          </div>
          <fieldset className="field">
            <legend>{t('history.documents')}</legend>
            <div className="row-end wrap" style={{ justifyContent: 'flex-start' }}>
              {PIECES.map((p) => (
                <label key={p} className="check">
                  <input type="checkbox" checked={form.documents.includes(p)}
                    onChange={(e) => set('documents', e.target.checked ? [...form.documents, p] : form.documents.filter((x) => x !== p))} />
                  {t(`apply.pieces.${p}`)}
                </label>
              ))}
            </div>
          </fieldset>
        </div>
        <div className="field">
          <label htmlFor="af-notes">{t('history.notes')}</label>
          <textarea id="af-notes" className="input" rows={3} value={form.notes} onChange={(e) => set('notes', e.target.value)} />
        </div>
        <div className="row-end">
          <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? t('common.wait') : t('common.save')}</button>
          <button type="button" className="btn" onClick={onClose}>{t('common.cancel')}</button>
        </div>
      </form>
    </Modal>
  );
}

function Applications({ apps, setApps, onRespond }: { apps: Application[]; setApps: (f: (a: Application[]) => Application[]) => void; onRespond: (a: Application) => void }) {
  const { t, lang } = useI18n();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [docLang, setDocLang] = useState('');
  const [source, setSource] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [editing, setEditing] = useState<Application | null | 'new'>(null);
  const [error, setError] = useState<unknown>(null);

  const columns = useMemo<Column<Application>[]>(() => [
    { key: 'date', label: t('history.date'), value: (a) => a.applied_on, render: (a) => fmtDate(a.applied_on, lang), date: true },
    { key: 'company', label: t('targets.company'), value: (a) => a.company, render: (a) => <strong>{a.company}</strong> },
    { key: 'job', label: t('history.job'), value: (a) => a.job_title },
    { key: 'source', label: t('history.source'), value: (a) => sourceLabel(a.source, t) },
    { key: 'lang', label: t('history.lang'), value: (a) => t(`langs.${a.lang}`) },
    { key: 'docs', label: t('history.documents'), value: (a) => a.documents.map((d) => t(`apply.pieces.${d}`)).join(', ') },
    { key: 'status', label: t('history.status'), value: (a) => t(`history.statuses.${a.status}`), render: (a) => <span className={`tag status-${a.status}`}>{t(`history.statuses.${a.status}`)}</span> },
    { key: 'followup', label: t('history.followup'), value: (a) => a.followup_on, render: (a) => fmtDate(a.followup_on, lang), date: true },
  ], [t, lang]);

  const sources = useMemo(() => [...new Set(apps.map((a) => a.source).filter(Boolean))].sort(), [apps]);
  const filtered = useMemo(() => apps.filter((a) =>
    (!status || a.status === status) && (!docLang || a.lang === docLang) && (!source || a.source === source)
    && inPeriod(a.applied_on, from, to) && matches(q, a.company, a.job_title, a.notes)), [apps, status, docLang, source, from, to, q]);
  const { sorted, sort, onSort } = useSorted(filtered, columns, 'date');
  const reset = () => { setQ(''); setStatus(''); setDocLang(''); setSource(''); setFrom(''); setTo(''); };

  const remove = async (a: Application) => {
    if (!window.confirm(t('history.confirmDelete'))) return;
    try { await deleteApplication(a.id); setApps((l) => l.filter((x) => x.id !== a.id)); } catch (e) { setError(e); }
  };

  return (
    <section className="stack-lg" aria-labelledby="apps-h">
      <div className="row-between wrap">
        <h2 id="apps-h" className="h2">{t('history.apps.title')} <span className="muted small">({sorted.length}/{apps.length})</span></h2>
        <div className="row-end wrap">
          <button type="button" className="btn" onClick={() => setEditing('new')}>+ {t('history.apps.new')}</button>
          <button type="button" className="btn btn-primary" disabled={!sorted.length}
            onClick={() => void toExcel(t('history.apps.title'), columns, sorted, t('history.apps.file')).catch(setError)}>{t('history.export')}</button>
        </div>
      </div>
      <div className="card filters">
        <div className="field">
          <label htmlFor="ap-q">{t('common.search')}</label>
          <input id="ap-q" type="search" className="input" value={q} placeholder={t('history.searchHint')} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="ap-status">{t('history.status')}</label>
          <select id="ap-status" className="input" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">{t('history.all')}</option>
            {APP_STATUSES.map((s) => <option key={s} value={s}>{t(`history.statuses.${s}`)}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor="ap-lang">{t('history.lang')}</label>
          <select id="ap-lang" className="input" value={docLang} onChange={(e) => setDocLang(e.target.value)}>
            <option value="">{t('history.all')}</option>
            {LANGS.map((l) => <option key={l} value={l}>{t(`langs.${l}`)}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor="ap-source">{t('history.source')}</label>
          <select id="ap-source" className="input" value={source} onChange={(e) => setSource(e.target.value)}>
            <option value="">{t('history.all')}</option>
            {sources.map((s) => <option key={s} value={s}>{sourceLabel(s, t)}</option>)}
          </select>
        </div>
        <PeriodFilter id="ap" from={from} to={to} setFrom={setFrom} setTo={setTo} />
        <button type="button" className="btn btn-sm" onClick={reset}>{t('history.reset')}</button>
      </div>
      {error != null && <Notice tone="error">{errorMessage(error, t)}</Notice>}
      {!apps.length ? <Empty title={t('history.apps.empty')}>{t('history.apps.emptyHint')}</Empty>
        : !sorted.length ? <Empty title={t('history.noMatch')} />
          : (
            <SortableTable rows={sorted} columns={columns} sort={sort} onSort={onSort} actions={(a) => (
              <>
                <button type="button" className="btn btn-sm" onClick={() => onRespond(a)}>{t('history.apps.respond')}</button>
                <button type="button" className="btn btn-sm" onClick={() => setEditing(a)}>{t('history.edit')}</button>
                <button type="button" className="link-btn danger" aria-label={`${t('common.delete')} ${a.company}`} onClick={() => void remove(a)}>×</button>
              </>
            )} />
          )}
      {editing && (
        <ApplicationForm app={editing === 'new' ? null : editing} onClose={() => setEditing(null)}
          onSaved={(row) => setApps((l) => (l.some((x) => x.id === row.id) ? l.map((x) => (x.id === row.id ? row : x)) : [row, ...l]))} />
      )}
    </section>
  );
}

// ───────────── Réponses reçues ─────────────

function ResponseForm({ resp, from, apps, onClose, onSaved }: {
  resp: ResponseRow | null; from: Application | null; apps: Application[]; onClose: () => void; onSaved: (r: ResponseRow, a: Application[] | null) => void;
}) {
  const { t, lang } = useI18n();
  const { setTargets } = useApp();
  const [form, setForm] = useState<ResponseInput>(() => resp ? { ...resp } : {
    application_id: from?.id ?? null, target_id: from?.target_id ?? null, received_on: isoDay(),
    company: from?.company ?? '', job_title: from?.job_title ?? '', type: 'interview', next_step: '', next_step_on: null, notes: '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const set = <K extends keyof ResponseInput>(k: K, v: ResponseInput[K]) => setForm((f) => ({ ...f, [k]: v }));

  const pick = (id: string) => {
    const a = apps.find((x) => x.id === id);
    setForm((f) => ({ ...f, application_id: a?.id ?? null, target_id: a?.target_id ?? null, company: a?.company ?? f.company, job_title: a?.job_title ?? f.job_title }));
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!form.company.trim()) { setError(new Error(t('targets.companyRequired'))); return; }
    setBusy(true);
    try {
      const { response, target } = await saveResponse({ ...form, company: form.company.trim(), next_step_on: form.next_step_on || null }, resp?.id);
      if (target) setTargets((l) => l.map((x) => (x.id === target.id ? target : x)));
      onSaved(response, form.application_id ? await fetchApplications() : null);
      onClose();
    } catch (err) { setError(err); setBusy(false); }
  };

  return (
    <Modal title={resp ? resp.company : t('history.resps.new')} onClose={onClose}>
      <form onSubmit={submit} className="stack-lg">
        {error != null && <Notice tone="error">{errorMessage(error, t)}</Notice>}
        <div className="field">
          <label htmlFor="rf-app">{t('history.resps.application')}</label>
          <select id="rf-app" className="input" value={form.application_id ?? ''} onChange={(e) => pick(e.target.value)}>
            <option value="">{t('history.resps.noApplication')}</option>
            {apps.map((a) => <option key={a.id} value={a.id}>{[a.company, a.job_title, fmtDate(a.applied_on, lang)].filter(Boolean).join(' · ')}</option>)}
          </select>
        </div>
        <div className="grid-2">
          <div className="field">
            <label htmlFor="rf-date">{t('history.date')} *</label>
            <input id="rf-date" type="date" className="input" required value={form.received_on} onChange={(e) => set('received_on', e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="rf-type">{t('history.resps.type')}</label>
            <select id="rf-type" className="input" value={form.type} onChange={(e) => set('type', e.target.value as ResponseInput['type'])}>
              {RESPONSE_TYPES.map((x) => <option key={x} value={x}>{t(`history.types.${x}`)}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="rf-company">{t('targets.company')} *</label>
            <input id="rf-company" className="input" required value={form.company} onChange={(e) => set('company', e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="rf-job">{t('history.job')}</label>
            <input id="rf-job" className="input" value={form.job_title} onChange={(e) => set('job_title', e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="rf-next">{t('history.resps.nextStep')}</label>
            <input id="rf-next" className="input" value={form.next_step} placeholder={t('history.resps.nextHint')} onChange={(e) => set('next_step', e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="rf-next-on">{t('history.resps.nextOn')}</label>
            <input id="rf-next-on" type="date" className="input" value={form.next_step_on ?? ''} onChange={(e) => set('next_step_on', e.target.value || null)} />
          </div>
        </div>
        <div className="field">
          <label htmlFor="rf-notes">{t('history.notes')}</label>
          <textarea id="rf-notes" className="input" rows={4} value={form.notes} onChange={(e) => set('notes', e.target.value)} />
        </div>
        {form.application_id && <p className="small muted">{t('history.resps.effect')}</p>}
        <div className="row-end">
          <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? t('common.wait') : t('common.save')}</button>
          <button type="button" className="btn" onClick={onClose}>{t('common.cancel')}</button>
        </div>
      </form>
    </Modal>
  );
}

function Responses({ resps, setResps, onNew, onEdit }: {
  resps: ResponseRow[]; setResps: (f: (r: ResponseRow[]) => ResponseRow[]) => void; onNew: () => void; onEdit: (r: ResponseRow) => void;
}) {
  const { t, lang } = useI18n();
  const [q, setQ] = useState('');
  const [type, setType] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [error, setError] = useState<unknown>(null);

  const columns = useMemo<Column<ResponseRow>[]>(() => [
    { key: 'date', label: t('history.date'), value: (r) => r.received_on, render: (r) => fmtDate(r.received_on, lang), date: true },
    { key: 'company', label: t('targets.company'), value: (r) => r.company, render: (r) => <strong>{r.company}</strong> },
    { key: 'job', label: t('history.job'), value: (r) => r.job_title },
    { key: 'type', label: t('history.resps.type'), value: (r) => t(`history.types.${r.type}`), render: (r) => <span className={`tag type-${r.type}`}>{t(`history.types.${r.type}`)}</span> },
    { key: 'next', label: t('history.resps.nextStep'), value: (r) => [r.next_step, r.next_step_on ? fmtDate(r.next_step_on, lang) : ''].filter(Boolean).join(' · ') },
    { key: 'notes', label: t('history.notes'), value: (r) => r.notes, render: (r) => <span className="clamp">{r.notes || '—'}</span> },
  ], [t, lang]);

  const filtered = useMemo(() => resps.filter((r) => (!type || r.type === type) && inPeriod(r.received_on, from, to)
    && matches(q, r.company, r.job_title, r.next_step, r.notes)), [resps, type, from, to, q]);
  const { sorted, sort, onSort } = useSorted(filtered, columns, 'date');

  const remove = async (r: ResponseRow) => {
    if (!window.confirm(t('history.confirmDelete'))) return;
    try { await deleteResponse(r.id); setResps((l) => l.filter((x) => x.id !== r.id)); } catch (e) { setError(e); }
  };

  return (
    <section className="stack-lg" aria-labelledby="resps-h">
      <div className="row-between wrap">
        <h2 id="resps-h" className="h2">{t('history.resps.title')} <span className="muted small">({sorted.length}/{resps.length})</span></h2>
        <div className="row-end wrap">
          <button type="button" className="btn" onClick={onNew}>+ {t('history.resps.new')}</button>
          <button type="button" className="btn btn-primary" disabled={!sorted.length}
            onClick={() => void toExcel(t('history.resps.title'), columns, sorted, t('history.resps.file')).catch(setError)}>{t('history.export')}</button>
        </div>
      </div>
      <div className="card filters">
        <div className="field">
          <label htmlFor="rs-q">{t('common.search')}</label>
          <input id="rs-q" type="search" className="input" value={q} placeholder={t('history.searchHint')} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="rs-type">{t('history.resps.type')}</label>
          <select id="rs-type" className="input" value={type} onChange={(e) => setType(e.target.value)}>
            <option value="">{t('history.all')}</option>
            {RESPONSE_TYPES.map((x) => <option key={x} value={x}>{t(`history.types.${x}`)}</option>)}
          </select>
        </div>
        <PeriodFilter id="rs" from={from} to={to} setFrom={setFrom} setTo={setTo} />
        <button type="button" className="btn btn-sm" onClick={() => { setQ(''); setType(''); setFrom(''); setTo(''); }}>{t('history.reset')}</button>
      </div>
      {error != null && <Notice tone="error">{errorMessage(error, t)}</Notice>}
      {!resps.length ? <Empty title={t('history.resps.empty')}>{t('history.resps.emptyHint')}</Empty>
        : !sorted.length ? <Empty title={t('history.noMatch')} />
          : (
            <SortableTable rows={sorted} columns={columns} sort={sort} onSort={onSort} actions={(r) => (
              <>
                <button type="button" className="btn btn-sm" onClick={() => onEdit(r)}>{t('history.edit')}</button>
                <button type="button" className="link-btn danger" aria-label={`${t('common.delete')} ${r.company}`} onClick={() => void remove(r)}>×</button>
              </>
            )} />
          )}
    </section>
  );
}

// ───────────── Page ─────────────

export function History() {
  const { t } = useI18n();
  const [params, setParams] = useSearchParams();
  const tab = params.get('vue') === 'reponses' ? 'resps' : 'apps';
  const [apps, setApps] = useState<Application[] | null>(null);
  const [resps, setResps] = useState<ResponseRow[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [respForm, setRespForm] = useState<{ resp: ResponseRow | null; from: Application | null } | null>(null);

  const load = () => {
    setError(null);
    Promise.all([fetchApplications(), fetchResponses()]).then(([a, r]) => { setApps(a); setResps(r); }).catch(setError);
  };
  useEffect(load, []);

  const setTab = (v: 'apps' | 'resps') => setParams(v === 'resps' ? { vue: 'reponses' } : {}, { replace: true });

  return (
    <div className="page page-wide stack-xl">
      <header className="page-head">
        <div>
          <p className="eyebrow">{t('history.eyebrow')}</p>
          <h1 className="h1">{t('history.title')}</h1>
          <p className="muted small">{t('history.intro')}</p>
        </div>
      </header>
      <div className="tabs" role="tablist" aria-label={t('history.title')}>
        <button type="button" role="tab" aria-selected={tab === 'apps'} className={tab === 'apps' ? 'active' : ''} onClick={() => setTab('apps')}>
          {t('history.apps.title')}{apps ? ` (${apps.length})` : ''}
        </button>
        <button type="button" role="tab" aria-selected={tab === 'resps'} className={tab === 'resps' ? 'active' : ''} onClick={() => setTab('resps')}>
          {t('history.resps.title')}{resps ? ` (${resps.length})` : ''}
        </button>
      </div>
      {error != null ? <ErrorState error={error} onRetry={load} />
        : !apps || !resps ? <Loading rows={4} />
          : tab === 'apps'
            ? <Applications apps={apps} setApps={(f) => setApps((a) => f(a ?? []))} onRespond={(a) => setRespForm({ resp: null, from: a })} />
            : <Responses resps={resps} setResps={(f) => setResps((r) => f(r ?? []))} onNew={() => setRespForm({ resp: null, from: null })} onEdit={(r) => setRespForm({ resp: r, from: null })} />}
      {respForm && apps && (
        <ResponseForm resp={respForm.resp} from={respForm.from} apps={apps} onClose={() => setRespForm(null)}
          onSaved={(r, freshApps) => {
            setResps((l) => (l?.some((x) => x.id === r.id) ? l.map((x) => (x.id === r.id ? r : x)) : [r, ...(l ?? [])]));
            if (freshApps) setApps(freshApps);
            setTab('resps');
          }} />
      )}
    </div>
  );
}
