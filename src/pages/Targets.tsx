import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { Empty, Modal, Notice, errorMessage, fmtDate } from '../components/ui';
import { useI18n } from '../i18n';
import { deleteTarget, fetchSectors, moveTarget, saveTarget, type TargetInput } from '../lib/api';
import { targetTrades } from '../lib/trades';
import { useApp } from '../lib/session';
import { CHANNELS, STAGES, type Stage, type Target } from '../lib/types';

const EMPTY: TargetInput = {
  company: '', sector: '', priority: 'B', contact_name: '', contact_role: '', channel: 'linkedin',
  stage: 'todo', last_contact_on: null, job_url: '', notes: '', brief: {},
};

function TargetForm({ target, onClose }: { target: Target | null; onClose: () => void }) {
  const { t, lang } = useI18n();
  const { profile, setTargets } = useApp();
  const [form, setForm] = useState<TargetInput>(() => (target ? { ...target } : { ...EMPTY }));
  const [sectors, setSectors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const set = <K extends keyof TargetInput>(k: K, v: TargetInput[K]) => setForm((f) => ({ ...f, [k]: v }));

  const tradesKey = targetTrades(profile).join(',');
  useEffect(() => { fetchSectors(tradesKey.split(','), lang).then(setSectors).catch(() => setSectors([])); }, [tradesKey, lang]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!form.company.trim()) { setError(new Error(t('targets.companyRequired'))); return; }
    setBusy(true);
    setError(null);
    try {
      const row = await saveTarget({ ...form, company: form.company.trim(), last_contact_on: form.last_contact_on || null }, target?.id);
      setTargets((list) => (target ? list.map((x) => (x.id === row.id ? row : x)) : [row, ...list]));
      onClose();
    } catch (err) { setError(err); setBusy(false); }
  };

  const remove = async () => {
    if (!target) return;
    setBusy(true);
    try {
      await deleteTarget(target.id);
      setTargets((list) => list.filter((x) => x.id !== target.id));
      onClose();
    } catch (err) { setError(err); setBusy(false); }
  };

  return (
    <Modal title={target ? target.company : t('targets.new')} onClose={onClose}>
      <form onSubmit={submit} className="stack-lg">
        {error != null && <Notice tone="error">{errorMessage(error, t)}</Notice>}
        <div className="grid-2">
          <div className="field">
            <label htmlFor="tf-company">{t('targets.company')} *</label>
            <input id="tf-company" className="input" required value={form.company} onChange={(e) => set('company', e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="tf-sector">{t('targets.sector')}</label>
            <input id="tf-sector" className="input" list="tf-sectors" value={form.sector} onChange={(e) => set('sector', e.target.value)} />
            <datalist id="tf-sectors">{sectors.map((s) => <option key={s} value={s} />)}</datalist>
          </div>
          <div className="field">
            <label htmlFor="tf-contact">{t('targets.contact')}</label>
            <input id="tf-contact" className="input" value={form.contact_name} onChange={(e) => set('contact_name', e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="tf-role">{t('targets.role')}</label>
            <input id="tf-role" className="input" value={form.contact_role} onChange={(e) => set('contact_role', e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="tf-channel">{t('targets.channel')}</label>
            <select id="tf-channel" className="input" value={form.channel} onChange={(e) => set('channel', e.target.value as TargetInput['channel'])}>
              {CHANNELS.map((c) => <option key={c} value={c}>{t(`channels.${c}`)}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="tf-priority">{t('targets.priority')}</label>
            <select id="tf-priority" className="input" value={form.priority} onChange={(e) => set('priority', e.target.value as TargetInput['priority'])}>
              {(['A', 'B', 'C'] as const).map((p) => <option key={p} value={p}>{t(`priorities.${p}`)}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="tf-stage">{t('targets.stage')}</label>
            <select id="tf-stage" className="input" value={form.stage} onChange={(e) => set('stage', e.target.value as Stage)}>
              {STAGES.map((s) => <option key={s} value={s}>{t(`stages.${s}`)}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="tf-date">{t('targets.lastContact')}</label>
            <input id="tf-date" className="input" type="date" value={form.last_contact_on ?? ''} onChange={(e) => set('last_contact_on', e.target.value || null)} />
          </div>
        </div>
        <div className="field">
          <label htmlFor="tf-url">{t('targets.jobUrl')}</label>
          <input id="tf-url" className="input" type="url" inputMode="url" placeholder="https://" value={form.job_url} onChange={(e) => set('job_url', e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="tf-notes">{t('targets.notes')}</label>
          <textarea id="tf-notes" className="input" rows={4} value={form.notes} onChange={(e) => set('notes', e.target.value)} />
        </div>
        <div className="row-between wrap">
          {target ? (
            confirmDelete ? (
              <span className="row-end">
                <span className="small">{t('targets.confirmDelete')}</span>
                <button type="button" className="btn btn-sm btn-danger" disabled={busy} onClick={() => void remove()}>{t('common.delete')}</button>
                <button type="button" className="btn btn-sm" onClick={() => setConfirmDelete(false)}>{t('common.cancel')}</button>
              </span>
            ) : <button type="button" className="link-btn danger small" onClick={() => setConfirmDelete(true)}>{t('common.delete')}</button>
          ) : <span />}
          <span className="row-end">
            <button type="button" className="btn" onClick={onClose}>{t('common.cancel')}</button>
            <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? t('common.wait') : t('common.save')}</button>
          </span>
        </div>
      </form>
    </Modal>
  );
}

function TargetCard({ target, onOpen }: { target: Target; onOpen: () => void }) {
  const { t, locale } = useI18n();
  const { setTargets } = useApp();
  const [error, setError] = useState<unknown>(null);
  const move = async (stage: Stage) => {
    setError(null);
    try {
      const row = await moveTarget(target, stage);
      setTargets((list) => list.map((x) => (x.id === row.id ? row : x)));
    } catch (e) { setError(e); }
  };
  const idx = STAGES.indexOf(target.stage);
  return (
    <article className="card target-card">
      <button type="button" className="target-open" onClick={onOpen}>
        <span className="row-between">
          <strong>{target.company}</strong>
          <span className={`prio prio-${target.priority}`} title={t(`priorities.${target.priority}`)}>{target.priority}</span>
        </span>
        <span className="small muted">{[target.contact_name, target.contact_role].filter(Boolean).join(', ') || t('targets.noContact')}</span>
        <span className="xs muted">{t(`channels.${target.channel}`)}{target.sector ? ` · ${target.sector}` : ''} · {fmtDate(target.last_contact_on, locale)}</span>
      </button>
      {error != null && <span className="err xs">{errorMessage(error, t)}</span>}
      <div className="row-between">
        <label className="sr-only" htmlFor={`st-${target.id}`}>{t('targets.stage')}</label>
        <select id={`st-${target.id}`} className="input input-sm" value={target.stage} onChange={(e) => void move(e.target.value as Stage)}>
          {STAGES.map((s) => <option key={s} value={s}>{t(`stages.${s}`)}</option>)}
        </select>
        {idx < 4 && (
          <button type="button" className="btn btn-sm" title={t(`stages.${STAGES[idx + 1]}`)} onClick={() => void move(STAGES[idx + 1])}>
            {t(`targets.next.${target.stage}`)} →
          </button>
        )}
      </div>
      <Link className="xs" to={`/postuler?cible=${target.id}`}>{t('targets.tailor')}</Link>
    </article>
  );
}

export function Targets() {
  const { t } = useI18n();
  const { targets } = useApp();
  const [editing, setEditing] = useState<Target | null | 'new'>(null);
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const shown = q ? targets.filter((x) => `${x.company} ${x.contact_name} ${x.sector} ${x.notes}`.toLowerCase().includes(q)) : targets;

  return (
    <div className="page page-wide stack-xl">
      <header className="page-head">
        <div>
          <p className="eyebrow">{t('targets.eyebrow', { n: targets.length })}</p>
          <h1 className="h1">{t('targets.title')}</h1>
        </div>
        <div className="row-end wrap">
          <label className="sr-only" htmlFor="tg-search">{t('common.search')}</label>
          <input id="tg-search" className="input" type="search" placeholder={t('common.search')} value={query} onChange={(e) => setQuery(e.target.value)} />
          <button type="button" className="btn btn-primary" onClick={() => setEditing('new')}>+ {t('targets.new')}</button>
        </div>
      </header>

      {targets.length === 0 ? (
        <Empty title={t('targets.emptyTitle')} action={<button type="button" className="btn btn-primary" onClick={() => setEditing('new')}>+ {t('targets.new')}</button>}>
          {t('targets.emptyHint')}
        </Empty>
      ) : (
        <div className="board" role="list">
          {STAGES.map((s) => {
            const col = shown.filter((x) => x.stage === s).sort((a, b) => a.priority.localeCompare(b.priority));
            return (
              <section key={s} id={s} className={`column st-${s}`} role="listitem" aria-label={t(`stages.${s}`)}>
                <h2 className="column-head"><span>{t(`stages.${s}`)}</span><span className="mono muted">{col.length}</span></h2>
                {col.map((x) => <TargetCard key={x.id} target={x} onOpen={() => setEditing(x)} />)}
              </section>
            );
          })}
        </div>
      )}
      {editing && <TargetForm target={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}
