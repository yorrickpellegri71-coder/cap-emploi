import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { CopyButton, Empty, ErrorState, Notice, errorMessage, fmtDate } from '../components/ui';
import { useI18n } from '../i18n';
import { AiError, deleteDocument, fetchDocuments, fetchUsage, tailorDocuments, updateDocument } from '../lib/api';
import { exportDocx, exportPdf, fileName } from '../lib/exportDoc';
import { useApp } from '../lib/session';
import { LANGS, type DocumentRow, type Lang } from '../lib/types';

const FREE_DOCS = 3;

function Editor({ doc, onSaved, onDeleted }: { doc: DocumentRow; onSaved: (d: DocumentRow) => void; onDeleted: (id: string) => void }) {
  const { t } = useI18n();
  const [tab, setTab] = useState<'cv' | 'letter'>('cv');
  const [cv, setCv] = useState(doc.cv);
  const [letter, setLetter] = useState(doc.letter);
  const [state, setState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [error, setError] = useState<unknown>(null);
  useEffect(() => { setCv(doc.cv); setLetter(doc.letter); setState('idle'); }, [doc]);

  const dirty = cv !== doc.cv || letter !== doc.letter;
  const text = tab === 'cv' ? cv : letter;
  const kindLabel = tab === 'cv' ? t('documents.cv') : t('documents.letter');

  const save = async () => {
    setState('saving');
    setError(null);
    try {
      await updateDocument(doc.id, { cv, letter });
      onSaved({ ...doc, cv, letter });
      setState('saved');
    } catch (e) { setError(e); setState('idle'); }
  };

  const exportAs = async (format: 'docx' | 'pdf') => {
    setError(null);
    try {
      if (format === 'docx') await exportDocx(text, fileName(kindLabel, doc.company, 'docx'));
      else exportPdf(text, fileName(kindLabel, doc.company, 'pdf'), doc.lang);
    } catch (e) { setError((e as Error).message === 'popup' ? new Error(t('documents.popupBlocked')) : e); }
  };

  return (
    <section className="card stack-lg" aria-labelledby="doc-h">
      <div className="row-between wrap">
        <div>
          <h2 id="doc-h" className="h2">{[doc.job_title, doc.company].filter(Boolean).join(' · ') || t('documents.untitled')}</h2>
          <span className="xs muted">{t(`langs.${doc.lang}`)}</span>
        </div>
        <div className="tabs" role="tablist">
          <button type="button" role="tab" aria-selected={tab === 'cv'} className={tab === 'cv' ? 'active' : ''} onClick={() => setTab('cv')}>{t('documents.cv')}</button>
          <button type="button" role="tab" aria-selected={tab === 'letter'} className={tab === 'letter' ? 'active' : ''} onClick={() => setTab('letter')}>{t('documents.letter')}</button>
        </div>
      </div>
      {doc.gaps.length > 0 && (
        <Notice tone="warn">
          <strong>{t('documents.gapsTitle')}</strong>
          <ul className="small">{doc.gaps.map((g, i) => <li key={i}>{g}</li>)}</ul>
          <span className="small">{t('documents.gapsHint')}</span>
        </Notice>
      )}
      <p className="small muted">{t('documents.review')}</p>
      {error != null && <Notice tone="error">{errorMessage(error, t)}</Notice>}
      <label className="sr-only" htmlFor="doc-text">{kindLabel}</label>
      <textarea id="doc-text" className="input doc-text" rows={22} value={text}
        onChange={(e) => { (tab === 'cv' ? setCv : setLetter)(e.target.value); setState('idle'); }} />
      <div className="row-between wrap">
        <button type="button" className="link-btn danger small" onClick={async () => {
          if (!window.confirm(t('documents.confirmDelete'))) return;
          try { await deleteDocument(doc.id); onDeleted(doc.id); } catch (e) { setError(e); }
        }}>{t('common.delete')}</button>
        <div className="row-end wrap">
          <button type="button" className="btn" disabled={!dirty || state === 'saving'} onClick={() => void save()}>
            {state === 'saving' ? t('common.wait') : state === 'saved' && !dirty ? `✓ ${t('common.saved')}` : t('common.save')}
          </button>
          <CopyButton text={text} className="btn" />
          <button type="button" className="btn" onClick={() => void exportAs('docx')}>{t('documents.word')}</button>
          <button type="button" className="btn btn-primary" onClick={() => void exportAs('pdf')}>{t('documents.pdf')}</button>
        </div>
      </div>
    </section>
  );
}

export function Documents() {
  const { t, locale } = useI18n();
  const { profile, targets } = useApp();
  const [params] = useSearchParams();
  const [offer, setOffer] = useState('');
  const [targetId, setTargetId] = useState(params.get('cible') ?? '');
  const [lang, setLang] = useState<Lang>(profile.doc_lang);
  const [busy, setBusy] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  const [docs, setDocs] = useState<DocumentRow[] | null>(null);
  const [usage, setUsage] = useState<number | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [current, setCurrent] = useState<DocumentRow | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const [list, u] = await Promise.all([fetchDocuments(), fetchUsage()]);
      setDocs(list);
      setUsage(u.documents);
    } catch (e) { setLoadError(e); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const hasProfile = Object.keys(profile.profile_data).length > 0 || profile.cv_text.trim().length > 0;
  const remaining = profile.plan === 'free' && usage !== null ? Math.max(FREE_DOCS - usage, 0) : null;

  const generate = async (e: FormEvent) => {
    e.preventDefault();
    setGenError(null);
    if (offer.trim().length < 80) { setGenError(t('errors.ai.offer_too_short')); return; }
    setBusy(true);
    try {
      const res = await tailorDocuments({ offer_text: offer, lang, target_id: targetId || null });
      setCurrent(res.document);
      setDocs((d) => [res.document, ...(d ?? [])]);
      setUsage((u) => (u ?? 0) + 1);
      setOffer('');
      window.setTimeout(() => document.getElementById('doc-h')?.scrollIntoView({ behavior: 'smooth' }), 50);
    } catch (err) {
      setGenError(err instanceof AiError ? t(`errors.ai.${err.code}`) : errorMessage(err, t));
    } finally { setBusy(false); }
  };

  return (
    <div className="page stack-xl">
      <header className="page-head">
        <div>
          <p className="eyebrow">{t('documents.eyebrow')}</p>
          <h1 className="h1">{t('documents.title')}</h1>
        </div>
      </header>

      {!hasProfile && (
        <Notice tone="warn">{t('documents.needProfile')} <Link to="/profil">{t('documents.goProfile')} →</Link></Notice>
      )}

      <form className="card stack-lg" onSubmit={generate}>
        <div className="field">
          <label htmlFor="offer">{t('documents.offer')}</label>
          <textarea id="offer" className="input" rows={10} value={offer} placeholder={t('documents.offerPlaceholder')} onChange={(e) => setOffer(e.target.value)} />
        </div>
        <div className="grid-2">
          <div className="field">
            <label htmlFor="doc-target">{t('documents.target')}</label>
            <select id="doc-target" className="input" value={targetId} onChange={(e) => setTargetId(e.target.value)}>
              <option value="">{t('messages.noTarget')}</option>
              {targets.map((x) => <option key={x.id} value={x.id}>{x.company}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="doc-lang">{t('documents.lang')}</label>
            <select id="doc-lang" className="input" value={lang} onChange={(e) => setLang(e.target.value as Lang)}>
              {LANGS.map((l) => <option key={l} value={l}>{t(`langs.${l}`)}</option>)}
            </select>
          </div>
        </div>
        {genError && <Notice tone="error">{genError}</Notice>}
        <div className="row-between wrap">
          <span className="small muted">
            {remaining !== null ? t('documents.remaining', { n: remaining, max: FREE_DOCS }) : ''} {t('documents.noInvention')}
          </span>
          <button type="submit" className="btn btn-primary" disabled={busy || !hasProfile || remaining === 0}>
            {busy ? t('documents.generating') : t('documents.generate')}
          </button>
        </div>
        {busy && <p className="small muted" role="status">{t('documents.generatingHint')}</p>}
      </form>

      {current && (
        <Editor doc={current}
          onSaved={(d) => { setCurrent(d); setDocs((list) => list?.map((x) => (x.id === d.id ? d : x)) ?? null); }}
          onDeleted={(id) => { setCurrent(null); setDocs((list) => list?.filter((x) => x.id !== id) ?? null); }} />
      )}

      <section className="stack" aria-labelledby="hist-h">
        <h2 id="hist-h" className="h2">{t('documents.history')}</h2>
        {loadError != null ? <ErrorState error={loadError} onRetry={() => void load()} />
          : docs && docs.length === 0 ? <Empty title={t('documents.emptyTitle')}>{t('documents.emptyHint')}</Empty>
          : (
            <ul className="list">
              {(docs ?? []).map((d) => (
                <li key={d.id} className={`list-item ${current?.id === d.id ? 'selected' : ''}`}>
                  <button type="button" className="link-row" onClick={() => { setCurrent(d); window.setTimeout(() => document.getElementById('doc-h')?.scrollIntoView({ behavior: 'smooth' }), 50); }}>
                    <strong>{[d.job_title, d.company].filter(Boolean).join(' · ') || t('documents.untitled')}</strong>
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
