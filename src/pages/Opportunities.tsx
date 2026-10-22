import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { DossierEditor } from '../components/DossierEditor';
import { Empty, ErrorState, Loading, Notice, errorMessage, fmtDate } from '../components/ui';
import { useI18n } from '../i18n';
import {
  AiError, discoverOpportunities, fetchDocument, fetchLatestDigest, fetchOpportunities, mailtoLink, markApplied,
  prepareOpportunity, setOpportunityStatus,
} from '../lib/api';
import { aiEnabled } from '../lib/ai';
import { isoDay } from '../lib/dates';
import { useApp } from '../lib/session';
import type { Digest, DocumentRow, Opportunity, OppStatus } from '../lib/types';

type View = 'to_validate' | 'validated' | 'all' | 'sent';
const VIEWS: View[] = ['to_validate', 'validated', 'all', 'sent'];
const inView = (o: Opportunity, v: View) => (v === 'all' ? ['new', 'preparing'].includes(o.status) : o.status === v);

export function Score({ value }: { value: number }) {
  const { t } = useI18n();
  const tone = value >= 80 ? 'high' : value >= 60 ? 'mid' : 'low';
  return <span className={`score score-${tone}`} title={t('opps.scoreTitle')}>{value}</span>;
}

function OppCard({ opp, selected, onSelect, onChange, busy, setBusy }: {
  opp: Opportunity; selected: boolean; onSelect: (v: boolean) => void;
  onChange: (o: Opportunity) => void; busy: boolean; setBusy: (id: string | null) => void;
}) {
  const { t, locale } = useI18n();
  const { profile, targets, setTargets } = useApp();
  const [doc, setDoc] = useState<DocumentRow | null>(null);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sentOn, setSentOn] = useState<string | null>(null);

  const run = async (fn: () => Promise<void>) => {
    setError(null);
    setBusy(opp.id);
    try { await fn(); } catch (e) { setError(e instanceof AiError ? t(`errors.ai.${e.code}`) : errorMessage(e, t)); } finally { setBusy(null); }
  };
  const status = (s: OppStatus) => run(async () => { await setOpportunityStatus([opp.id], s); onChange({ ...opp, status: s }); });
  const prepare = () => run(async () => {
    onChange({ ...opp, status: 'preparing' });
    try {
      const res = await prepareOpportunity(opp.id);
      onChange(res.opportunity);
      if (res.document) setDoc(res.document);
    } catch (e) { onChange({ ...opp, status: 'new' }); throw e; }
  });
  const toggleDoc = () => run(async () => {
    if (!open && !doc && opp.document_id) setDoc(await fetchDocument(opp.document_id));
    setOpen((o) => !o);
  });
  const ensureDoc = async () => doc ?? (opp.document_id ? await fetchDocument(opp.document_id).then((d) => { setDoc(d); return d; }) : null);
  const openMail = () => run(async () => {
    const d = await ensureDoc();
    if (d) window.location.href = mailtoLink(d);
  });
  const sent = () => run(async () => {
    const target = targets.find((x) => x.id === opp.target_id);
    if (target) {
      const d = await ensureDoc();
      const row = await markApplied(target, { document: d, source: opp.source, jobTitle: opp.kind === 'job' ? opp.title : undefined, opportunityId: opp.id, followupDays: profile.followup_days });
      setTargets((list) => list.map((x) => (x.id === row.id ? row : x)));
    }
    await setOpportunityStatus([opp.id], 'sent');
    const d = new Date();
    d.setDate(d.getDate() + profile.followup_days);
    setSentOn(isoDay(d));
    onChange({ ...opp, status: 'sent' });
  });

  return (
    <article className={`card opp ${selected ? 'selected' : ''}`}>
      <div className="opp-head">
        {opp.status === 'to_validate' && (
          <input type="checkbox" className="opp-check" checked={selected} aria-label={t('opps.select', { name: opp.company || opp.title })} onChange={(e) => onSelect(e.target.checked)} />
        )}
        <Score value={opp.score} />
        <div className="grow">
          <strong>{opp.kind === 'job' ? opp.title : opp.company}</strong>
          <div className="small muted">
            {[opp.kind === 'job' ? opp.company : t('opps.kindCompany'), opp.location, opp.sector, opp.source].filter(Boolean).join(' · ')}
          </div>
          <p className="small">{opp.reason}</p>
          <span className="xs muted">{t('opps.found', { date: fmtDate(opp.found_at, locale) })}</span>
        </div>
      </div>
      {error && <Notice tone="error">{error}</Notice>}
      {sentOn && <Notice tone="ok">{t('opps.sentDone', { date: fmtDate(sentOn, locale) })} <Link to="/historique">{t('history.see')}</Link></Notice>}
      <div className="row-end wrap">
        {opp.link && <a className="btn btn-sm" href={opp.link} target="_blank" rel="noopener noreferrer">{t('opps.openAd')}</a>}
        {opp.status === 'new' && (
          <>
            <button type="button" className="btn btn-sm" disabled={busy} onClick={() => void status('dismissed')}>{t('opps.dismiss')}</button>
            <button type="button" className="btn btn-sm btn-primary" disabled={busy} onClick={() => void prepare()}>{t('opps.prepare')}</button>
          </>
        )}
        {opp.status === 'preparing' && <span className="small muted" role="status">{t('opps.preparing')}</span>}
        {opp.status === 'to_validate' && (
          <>
            <button type="button" className="btn btn-sm" disabled={busy} onClick={() => void toggleDoc()}>{open ? t('opps.hideDossier') : t('opps.reviewDossier')}</button>
            <button type="button" className="btn btn-sm" disabled={busy} onClick={() => void status('dismissed')}>{t('opps.dismiss')}</button>
            <button type="button" className="btn btn-sm btn-primary" disabled={busy} onClick={() => void status('validated')}>✓ {t('opps.validate')}</button>
          </>
        )}
        {opp.status === 'validated' && (
          <>
            <button type="button" className="btn btn-sm" disabled={busy} onClick={() => void toggleDoc()}>{open ? t('opps.hideDossier') : t('opps.reviewDossier')}</button>
            <button type="button" className="btn btn-sm" disabled={busy} onClick={() => void openMail()}>{t('opps.mail')}</button>
            <button type="button" className="btn btn-sm btn-accent" disabled={busy} onClick={() => void sent()}>✓ {t('apply.sent.cta')}</button>
          </>
        )}
        {opp.target_id && <Link className="btn btn-sm" to={`/postuler?cible=${opp.target_id}`}>{t('opps.openApply')}</Link>}
      </div>
      {open && doc && <DossierEditor doc={doc} onSaved={setDoc} onDeleted={() => { setDoc(null); setOpen(false); }} />}
      {open && !doc && opp.document_id && <Loading rows={2} />}
    </article>
  );
}

function Settings() {
  const { t } = useI18n();
  const { profile, updateProfile } = useApp();
  const [error, setError] = useState<unknown>(null);
  const save = async (patch: Parameters<typeof updateProfile>[0]) => {
    setError(null);
    try { await updateProfile(patch); } catch (e) { setError(e); }
  };
  return (
    <details className="card">
      <summary className="strong">{t('opps.settings.title')}</summary>
      <div className="stack-lg" style={{ marginTop: 12 }}>
        {error != null && <Notice tone="error">{errorMessage(error, t)}</Notice>}
        <label className="check"><input type="checkbox" checked={profile.opp_auto_prepare} onChange={(e) => void save({ opp_auto_prepare: e.target.checked })} />
          <span>{t('opps.settings.auto')}</span></label>
        <div className="field" style={{ maxWidth: 260 }}>
          <label htmlFor="opp-min">{t('opps.settings.minScore')}</label>
          <input id="opp-min" className="input" type="number" min={0} max={100} step={5} defaultValue={profile.opp_min_score}
            onBlur={(e) => void save({ opp_min_score: Math.min(100, Math.max(0, Number(e.target.value) || 75)) })} />
        </div>
        <label className="check"><input type="checkbox" checked={profile.opp_daily_email} onChange={(e) => void save({ opp_daily_email: e.target.checked })} />
          <span>{t('opps.settings.email')}</span></label>
        <p className="xs muted">{t('opps.settings.note')}</p>
      </div>
    </details>
  );
}

export function Opportunities() {
  const { t, locale } = useI18n();
  const { profile } = useApp();
  const [opps, setOpps] = useState<Opportunity[] | null>(null);
  const [digest, setDigest] = useState<Digest | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [view, setView] = useState<View>('to_validate');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [running, setRunning] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: 'ok' | 'info' | 'error'; text: string } | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [list, d] = await Promise.all([fetchOpportunities(), fetchLatestDigest()]);
      setOpps(list);
      setDigest(d);
    } catch (e) { setError(e); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const replace = (o: Opportunity) => setOpps((list) => list?.map((x) => (x.id === o.id ? { ...x, ...o } : x)) ?? null);
  const counts = useMemo(() => Object.fromEntries(VIEWS.map((v) => [v, (opps ?? []).filter((o) => inView(o, v)).length])) as Record<View, number>, [opps]);
  const shown = (opps ?? []).filter((o) => inView(o, view));
  const bySector = useMemo(() => {
    const groups = new Map<string, Opportunity[]>();
    for (const o of shown) {
      const k = o.sector || t('opps.otherSector');
      groups.set(k, [...(groups.get(k) ?? []), o]);
    }
    return [...groups.entries()].sort((a, b) => Math.max(...b[1].map((o) => o.score)) - Math.max(...a[1].map((o) => o.score)));
  }, [shown, t]);

  const hasProfile = Object.keys(profile.profile_data).length > 0 || profile.cv_text.trim().length > 0;

  const discover = async () => {
    setNotice(null);
    setRunning(t('opps.running.search'));
    try {
      const res = await discoverOpportunities();
      await load();
      let prepared = 0;
      for (const [i, id] of res.toPrepare.entries()) {
        setRunning(t('opps.running.prepare', { i: i + 1, n: res.toPrepare.length }));
        setOpps((list) => list?.map((x) => (x.id === id ? { ...x, status: 'preparing' } : x)) ?? null);
        try { const r = await prepareOpportunity(id); replace(r.opportunity); prepared++; } catch (e) {
          setOpps((list) => list?.map((x) => (x.id === id ? { ...x, status: 'new' } : x)) ?? null);
          if (e instanceof AiError && e.code === 'quota_documents') break;
        }
      }
      setNotice({ tone: 'ok', text: `${t('opps.result', { n: res.inserted, p: prepared })}${res.jobsEnabled ? '' : ` ${t('opps.jobsDisabled')}`}` });
      if (prepared) setView('to_validate');
    } catch (e) {
      setNotice({ tone: 'error', text: e instanceof AiError ? t(`errors.ai.${e.code}`) : errorMessage(e, t) });
    } finally { setRunning(null); void load(); }
  };

  const validateSelection = async () => {
    const ids = [...selected];
    setNotice(null);
    try {
      await setOpportunityStatus(ids, 'validated');
      setOpps((list) => list?.map((x) => (selected.has(x.id) ? { ...x, status: 'validated' } : x)) ?? null);
      setSelected(new Set());
      setNotice({ tone: 'ok', text: t('opps.validatedN', { n: ids.length }) });
    } catch (e) { setNotice({ tone: 'error', text: errorMessage(e, t) }); }
  };

  const toValidate = (opps ?? []).filter((o) => o.status === 'to_validate');

  return (
    <div className="page stack-xl">
      <header className="page-head">
        <div>
          <p className="eyebrow">{t('opps.eyebrow')}</p>
          <h1 className="h1">{t('opps.title')}</h1>
          <p className="muted small">{t('opps.intro')}</p>
        </div>
        <button type="button" className="btn btn-primary" disabled={!!running || !hasProfile || !aiEnabled()} onClick={() => void discover()}>{running ? t('common.wait') : t('opps.run')}</button>
      </header>

      {!aiEnabled() && <Notice tone="info">{t('free.oppsOff')} <Link to="/offres">{t('nav.offers')} →</Link></Notice>}
      {!hasProfile && <Notice tone="warn">{t('apply.needProfile')} <Link to="/profil">{t('apply.goProfile')} →</Link></Notice>}
      {running && <Notice tone="info">{running}</Notice>}
      {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}

      {digest && (
        <section className="card digest stack" aria-labelledby="dg-h">
          <h2 id="dg-h" className="h2">{digest.day === isoDay() ? t('opps.digest.today') : t('opps.digest.of', { date: fmtDate(digest.day, locale) })}</h2>
          <p>{t('opps.digest.line', { j: digest.new_jobs, c: digest.new_companies, p: digest.prepared })}</p>
          {digest.top.length > 0 && (
            <ul className="small">{digest.top.slice(0, 3).map((x) => <li key={x.id}><strong>{x.score}</strong> · {x.title ? `${x.title} – ${x.company}` : x.company}</li>)}</ul>
          )}
        </section>
      )}

      <Notice tone="info">{t('opps.rule')}</Notice>

      <div className="tabs" role="tablist">
        {VIEWS.map((v) => (
          <button key={v} type="button" role="tab" aria-selected={view === v} className={view === v ? 'active' : ''} onClick={() => setView(v)}>
            {t(`opps.views.${v}`)} <span className="mono muted">{counts[v]}</span>
          </button>
        ))}
      </div>

      {view === 'to_validate' && toValidate.length > 0 && (
        <div className="bulk-bar">
          <label className="check">
            <input type="checkbox" checked={selected.size === toValidate.length} onChange={(e) => setSelected(e.target.checked ? new Set(toValidate.map((o) => o.id)) : new Set())} />
            <span className="small">{t('opps.selectAll')}</span>
          </label>
          <button type="button" className="btn btn-primary btn-sm" disabled={!selected.size} onClick={() => void validateSelection()}>✓ {t('opps.validateSelection', { n: selected.size })}</button>
        </div>
      )}

      {error != null ? <ErrorState error={error} onRetry={() => void load()} /> : !opps ? <Loading rows={3} /> : shown.length === 0 ? (
        <Empty title={t(`opps.empty.${view}`)}>{view === 'to_validate' || view === 'all' ? t('opps.emptyHint') : undefined}</Empty>
      ) : (
        bySector.map(([sector, list]) => (
          <section key={sector} className="stack" aria-label={sector}>
            <h2 className="h3">{sector} <span className="muted mono">{list.length}</span></h2>
            {list.map((o) => (
              <OppCard key={o.id} opp={o} busy={busy === o.id} setBusy={setBusy} onChange={replace}
                selected={selected.has(o.id)} onSelect={(v) => setSelected((s) => { const n = new Set(s); if (v) n.add(o.id); else n.delete(o.id); return n; })} />
            ))}
          </section>
        ))
      )}

      <Settings />
    </div>
  );
}
