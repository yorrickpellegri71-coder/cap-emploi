import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { DossierEditor } from '../components/DossierEditor';
import { Empty, ErrorState, Notice, errorMessage, fmtDate } from '../components/ui';
import { useI18n } from '../i18n';
import { AiError, companyBrief, fetchDocuments, fetchUsage, markApplied, searchJobs, tailorDocuments, upsertTargetFromBrief } from '../lib/api';
import { isoDay } from '../lib/dates';
import { sourcesFor, sourceUrl } from '../lib/jobSources';
import { useApp } from '../lib/session';
import { LANGS, type DocumentRow, type JobResult, type Lang, type Target } from '../lib/types';

const FREE_DOCS = 3;
const scrollTo = (id: string) => window.setTimeout(() => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);

function addDays(day: string, n: number) {
  const d = new Date(`${day}T12:00:00`);
  d.setDate(d.getDate() + n);
  return isoDay(d);
}

/** Texte envoyé à l'IA pour une candidature spontanée, construit à partir de la fiche (marquée comme non vérifiée). */
function spontaneousOffer(target: Target, headline: string) {
  const b = target.brief;
  return [
    `Spontaneous application, no job ad. Company: ${target.company}.`,
    headline ? `Target role: ${b.job_title || headline}.` : '',
    b.summary ? `Company brief (unverified): ${b.summary}` : '',
    b.expectations?.length ? `Likely expectations (unverified): ${b.expectations.join('; ')}` : '',
  ].filter(Boolean).join('\n');
}

// ───────────── 1. Recherche ─────────────

function Search({ onUse }: { onUse: (job: JobResult) => void }) {
  const { t, locale } = useI18n();
  const { profile } = useApp();
  const [query, setQuery] = useState(profile.profile_data.headline ?? '');
  const [where, setWhere] = useState('Luxembourg');
  const [jobs, setJobs] = useState<JobResult[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ tone: 'info' | 'error'; text: string } | null>(null);
  const sources = useMemo(() => sourcesFor(profile.trade), [profile.trade]);

  const collect = async (e: FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;
    setBusy(true);
    setNote(null);
    try {
      const res = await searchJobs({ keywords: query, location: where });
      setJobs(res.jobs);
    } catch (err) {
      setJobs(null);
      const code = err instanceof AiError ? err.code : '';
      setNote(code === 'search_disabled' ? { tone: 'info', text: t('apply.search.disabled') } : { tone: 'error', text: err instanceof AiError ? t(`errors.ai.${code}`) : errorMessage(err, t) });
    } finally { setBusy(false); }
  };

  return (
    <section className="card stack-lg" aria-labelledby="s1-h">
      <h2 id="s1-h" className="h2"><span className="step">1</span>{t('apply.search.title')}</h2>
      <form className="search-row" onSubmit={collect}>
        <div className="field grow">
          <label htmlFor="q">{t('apply.search.query')}</label>
          <input id="q" className="input" value={query} placeholder={t('apply.search.queryPlaceholder')} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="where">{t('apply.search.where')}</label>
          <input id="where" className="input" value={where} onChange={(e) => setWhere(e.target.value)} />
        </div>
        <button type="submit" className="btn btn-primary" disabled={busy || !query.trim()}>{busy ? t('common.wait') : t('apply.search.collect')}</button>
      </form>
      <div className="stack">
        <span className="small strong">{t('apply.search.sources')}</span>
        <div className="source-grid">
          {sources.map((s) => (
            <a key={s.id} className="source" href={sourceUrl(s, query, where)} target="_blank" rel="noopener noreferrer">
              <strong>{s.name}</strong>
              <span className="xs muted">{s.tags.includes('hospitality') ? t('apply.search.tagHospitality') : s.tags.includes('public') ? t('apply.search.tagPublic') : t('apply.search.tagGeneral')}{s.search || !query.trim() ? '' : ` · ${t('apply.search.viaWeb')}`}</span>
            </a>
          ))}
        </div>
        <span className="xs muted">{t('apply.search.tos')}</span>
      </div>
      {note && <Notice tone={note.tone}>{note.text}</Notice>}
      {jobs && (
        jobs.length === 0 ? <p className="small muted">{t('apply.search.none')}</p> : (
          <ul className="list" aria-label={t('apply.search.results')}>
            {jobs.map((j, i) => (
              <li key={`${j.link}-${i}`} className="list-item">
                <div className="grow">
                  <strong>{j.title}</strong>
                  <div className="small muted">{[j.company, j.location, j.source].filter(Boolean).join(' · ')}{j.updated ? ` · ${fmtDate(j.updated, locale)}` : ''}</div>
                  {j.snippet && <p className="xs muted clamp">{j.snippet}</p>}
                </div>
                <div className="row-end">
                  {j.link && <a className="btn btn-sm" href={j.link} target="_blank" rel="noopener noreferrer">{t('apply.search.open')}</a>}
                  <button type="button" className="btn btn-sm btn-primary" onClick={() => onUse(j)}>{t('apply.search.use')}</button>
                </div>
              </li>
            ))}
          </ul>
        )
      )}
    </section>
  );
}

// ───────────── Page ─────────────

export function Apply() {
  const { t, lang: uiLang, locale } = useI18n();
  const { profile, targets, setTargets } = useApp();
  const [params, setParams] = useSearchParams();
  const targetId = params.get('cible') ?? '';
  const target = targets.find((x) => x.id === targetId) ?? null;
  const setTarget = (id: string) => {
    const next = new URLSearchParams(params);
    if (id) next.set('cible', id); else next.delete('cible');
    setParams(next, { replace: true });
  };

  // 2. Offre ou entreprise → fiche et cible
  const [company, setCompany] = useState('');
  const [offer, setOffer] = useState('');
  const [jobUrl, setJobUrl] = useState('');
  const [briefBusy, setBriefBusy] = useState(false);
  const [briefError, setBriefError] = useState<string | null>(null);
  const [snippetUsed, setSnippetUsed] = useState(false);

  // 3. Dossier
  const [lang, setLang] = useState<Lang>(profile.doc_lang);
  const [genBusy, setGenBusy] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  const [docs, setDocs] = useState<DocumentRow[] | null>(null);
  const [usage, setUsage] = useState<number | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [current, setCurrent] = useState<DocumentRow | null>(null);

  // 4. Envoi
  const [sent, setSent] = useState<string | null>(null);
  const [sendError, setSendError] = useState<unknown>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const [list, u] = await Promise.all([fetchDocuments(), fetchUsage()]);
      setDocs(list);
      setUsage(u.documents);
    } catch (e) { setLoadError(e); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  // Ouvrir une cible affiche son dernier dossier.
  useEffect(() => {
    if (!docs) return;
    setCurrent((c) => (target ? docs.find((d) => d.target_id === target.id) ?? (c?.target_id === target.id ? c : null) : c));
    setSent(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetId, docs === null]);

  const aiText = (e: unknown) => (e instanceof AiError ? t(`errors.ai.${e.code}`) : errorMessage(e, t));
  const hasProfile = Object.keys(profile.profile_data).length > 0 || profile.cv_text.trim().length > 0;
  const remaining = profile.plan === 'free' && usage !== null ? Math.max(FREE_DOCS - usage, 0) : null;

  const useJob = (j: JobResult) => {
    setCompany(j.company);
    setJobUrl(j.link);
    setOffer([j.title, [j.company, j.location].filter(Boolean).join(' – '), j.snippet].filter(Boolean).join('\n'));
    setSnippetUsed(true);
    setTarget('');
    scrollTo('s2-h');
  };

  const analyse = async (e: FormEvent) => {
    e.preventDefault();
    setBriefError(null);
    if (!company.trim() && offer.trim().length < 80) { setBriefError(t('errors.ai.brief_missing')); return; }
    setBriefBusy(true);
    try {
      const { brief } = await companyBrief({ company: company.trim() || undefined, offer_text: offer.trim() || undefined, job_url: jobUrl.trim() || undefined, lang: uiLang });
      if (!brief.company?.trim()) { setBriefError(t('apply.brief.noCompany')); return; }
      const row = await upsertTargetFromBrief({ ...brief, offer_text: offer.trim(), created_at: new Date().toISOString() }, targets, jobUrl.trim());
      setTargets((list) => (list.some((x) => x.id === row.id) ? list.map((x) => (x.id === row.id ? row : x)) : [row, ...list]));
      setTarget(row.id);
      setCompany('');
      setOffer('');
      setJobUrl('');
      setSnippetUsed(false);
      scrollTo('brief-h');
    } catch (err) { setBriefError(aiText(err)); } finally { setBriefBusy(false); }
  };

  const generate = async () => {
    if (!target) return;
    setGenError(null);
    setGenBusy(true);
    try {
      const offerText = target.brief.offer_text?.trim() || spontaneousOffer(target, profile.profile_data.headline ?? '');
      const res = await tailorDocuments({ offer_text: offerText, lang, target_id: target.id });
      setCurrent(res.document);
      setDocs((d) => [res.document, ...(d ?? [])]);
      setUsage((u) => (u ?? 0) + 1);
      scrollTo('doc-h');
    } catch (err) { setGenError(aiText(err)); } finally { setGenBusy(false); }
  };

  const applied = async () => {
    if (!target) return;
    setSendError(null);
    try {
      const row = await markApplied(target, { document: current, followupDays: profile.followup_days });
      setTargets((list) => list.map((x) => (x.id === row.id ? row : x)));
      setSent(addDays(isoDay(), profile.followup_days));
    } catch (e) { setSendError(e); }
  };

  const b = target?.brief ?? {};
  const sentButton = target && (
    <button type="button" className="btn btn-accent" onClick={() => void applied()}>✓ {t('apply.sent.cta')}</button>
  );

  return (
    <div className="page stack-xl">
      <header className="page-head">
        <div>
          <p className="eyebrow">{t('apply.eyebrow')}</p>
          <h1 className="h1">{t('apply.title')}</h1>
          <p className="muted small">{t('apply.intro')}</p>
        </div>
      </header>

      {!hasProfile && <Notice tone="warn">{t('apply.needProfile')} <Link to="/profil">{t('apply.goProfile')} →</Link></Notice>}

      <Search onUse={useJob} />

      <section className="card stack-lg" aria-labelledby="s2-h">
        <h2 id="s2-h" className="h2"><span className="step">2</span>{t('apply.brief.title')}</h2>
        <form className="stack-lg" onSubmit={analyse}>
          <div className="grid-2">
            <div className="field">
              <label htmlFor="ap-company">{t('targets.company')}</label>
              <input id="ap-company" className="input" value={company} onChange={(e) => setCompany(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="ap-url">{t('targets.jobUrl')}</label>
              <input id="ap-url" className="input" type="url" inputMode="url" placeholder="https://" value={jobUrl} onChange={(e) => setJobUrl(e.target.value)} />
            </div>
          </div>
          <div className="field">
            <label htmlFor="ap-offer">{t('apply.brief.offer')} <span className="muted">({t('apply.brief.offerOptional')})</span></label>
            <textarea id="ap-offer" className="input" rows={8} value={offer} placeholder={t('apply.brief.offerPlaceholder')} onChange={(e) => setOffer(e.target.value)} />
            {snippetUsed && <span className="hint">{t('apply.brief.snippetHint')}</span>}
          </div>
          {briefError && <Notice tone="error">{briefError}</Notice>}
          <div className="row-between wrap">
            <span className="small muted">{t('apply.brief.hint')}</span>
            <button type="submit" className="btn btn-primary" disabled={briefBusy}>{briefBusy ? t('apply.brief.busy') : t('apply.brief.cta')}</button>
          </div>
        </form>
        <div className="field">
          <label htmlFor="ap-target">{t('apply.brief.orPick')}</label>
          <select id="ap-target" className="input" value={targetId} onChange={(e) => setTarget(e.target.value)}>
            <option value="">{t('messages.noTarget')}</option>
            {targets.map((x) => <option key={x.id} value={x.id}>{x.company}</option>)}
          </select>
        </div>
      </section>

      {target && (
        <section className="card stack-lg brief" aria-labelledby="brief-h">
          <div className="row-between wrap">
            <div>
              <p className="eyebrow">{t('apply.brief.sheet')}</p>
              <h2 id="brief-h" className="h2">{target.company}{b.job_title ? ` · ${b.job_title}` : ''}</h2>
              <span className="xs muted">{[b.sector || target.sector, b.location, t(`stages.${target.stage}`)].filter(Boolean).join(' · ')}</span>
            </div>
            <Link className="small" to="/cibles">{t('apply.brief.inPipeline')} →</Link>
          </div>
          {Object.keys(b).length === 0 ? <p className="small muted">{t('apply.brief.empty')}</p> : (
            <>
              {b.summary && <p>{b.summary}</p>}
              <div className="grid-2">
                {!!b.expectations?.length && (
                  <div className="stack"><h3 className="h3">{t('apply.brief.expectations')}</h3><ul className="small">{b.expectations.map((x, i) => <li key={i}>{x}</li>)}</ul></div>
                )}
                {!!b.to_check?.length && (
                  <div className="stack"><h3 className="h3">{t('apply.brief.toCheck')}</h3><ul className="small">{b.to_check.map((x, i) => <li key={i}>{x}</li>)}</ul></div>
                )}
              </div>
              {b.digital_idea && <Notice tone="info"><strong>{t('apply.brief.digital')}</strong> {b.digital_idea}</Notice>}
              <p className="xs muted">{t('apply.brief.disclaimer')}</p>
            </>
          )}
        </section>
      )}

      <section className="card stack-lg" aria-labelledby="s3-h">
        <h2 id="s3-h" className="h2"><span className="step">3</span>{t('apply.dossier.title')}</h2>
        {!target ? <p className="small muted">{t('apply.dossier.needTarget')}</p> : (
          <>
            <p className="small muted">{target.brief.offer_text ? t('apply.dossier.fromOffer') : t('apply.dossier.spontaneous')}</p>
            <div className="row-between wrap">
              <div className="field">
                <label htmlFor="ap-lang">{t('apply.dossier.lang')}</label>
                <select id="ap-lang" className="input" value={lang} onChange={(e) => setLang(e.target.value as Lang)}>
                  {LANGS.map((l) => <option key={l} value={l}>{t(`langs.${l}`)}</option>)}
                </select>
              </div>
              <button type="button" className="btn btn-primary" disabled={genBusy || !hasProfile || remaining === 0} onClick={() => void generate()}>
                {genBusy ? t('apply.dossier.busy') : t('apply.dossier.cta')}
              </button>
            </div>
            <span className="small muted">{remaining !== null ? t('apply.dossier.remaining', { n: remaining, max: FREE_DOCS }) : ''} {t('apply.dossier.noInvention')}</span>
            {genBusy && <p className="small muted" role="status">{t('apply.dossier.busyHint')}</p>}
            {genError && <Notice tone="error">{genError}</Notice>}
          </>
        )}
      </section>

      {current && (
        <DossierEditor doc={current}
          onSaved={(d) => { setCurrent(d); setDocs((list) => list?.map((x) => (x.id === d.id ? d : x)) ?? null); }}
          onDeleted={(id) => { setCurrent(null); setDocs((list) => list?.filter((x) => x.id !== id) ?? null); }}
          footer={target && current.target_id === target.id ? sentButton : undefined} />
      )}

      {target && (
        <section className="card stack-lg" aria-labelledby="s4-h">
          <h2 id="s4-h" className="h2"><span className="step">4</span>{t('apply.sent.title')}</h2>
          <p className="small muted">{t('apply.sent.intro', { n: profile.followup_days })}</p>
          {sendError != null && <Notice tone="error">{errorMessage(sendError, t)}</Notice>}
          {sent ? (
            <Notice tone="ok">{t('apply.sent.done', { company: target.company, date: fmtDate(sent, locale) })} <Link to="/historique">{t('history.see')}</Link></Notice>
          ) : <div>{sentButton}</div>}
        </section>
      )}

      <section className="stack" aria-labelledby="hist-h">
        <h2 id="hist-h" className="h2">{t('apply.history')}</h2>
        {loadError != null ? <ErrorState error={loadError} onRetry={() => void load()} />
          : docs && docs.length === 0 ? <Empty title={t('apply.emptyTitle')}>{t('apply.emptyHint')}</Empty>
          : (
            <ul className="list">
              {(docs ?? []).map((d) => (
                <li key={d.id} className={`list-item ${current?.id === d.id ? 'selected' : ''}`}>
                  <button type="button" className="link-row" onClick={() => { setCurrent(d); if (d.target_id) setTarget(d.target_id); scrollTo('doc-h'); }}>
                    <strong>{[d.job_title, d.company].filter(Boolean).join(' · ') || t('apply.untitled')}</strong>
                    <span className="xs muted">{d.lang.toUpperCase()} · {fmtDate(d.created_at, locale)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
      </section>
    </div>
  );
}
