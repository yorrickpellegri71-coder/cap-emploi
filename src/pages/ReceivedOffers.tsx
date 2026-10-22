import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { DossierEditor } from '../components/DossierEditor';
import { Empty, ErrorState, Loading, Modal, Notice, errorMessage, fmtDate } from '../components/ui';
import { useI18n } from '../i18n';
import {
  AiError, addManualOffer, analyzeOffer, fetchDocument, fetchReceivedOffers, importAlerts, mailtoLink, markApplied,
  createTemplateDocument, setOfferCheck, tailorDocuments, updateReceivedOffer, upsertTargetFromBrief, type ManualOffer,
} from '../lib/api';
import { aiEnabled } from '../lib/ai';
import { isoDay } from '../lib/dates';
import { fetchAlertEmails, mailConfigured, type MailProvider } from '../lib/mailAlerts';
import { useApp } from '../lib/session';
import { LANGS, type DocumentRow, type Lang, type OfferCheck, type ReceivedOffer } from '../lib/types';
import { Score } from './Opportunities';

type View = 'new' | 'todo' | 'sent' | 'all';
const inView = (o: ReceivedOffer, v: View) =>
  v === 'all' || (v === 'new' ? !o.seen_at : v === 'sent' ? o.status === 'sent' : o.status !== 'sent' && !!o.seen_at);

/** Message d'erreur des appels IA et du relevé des e-mails. */
function useErrText() {
  const { t } = useI18n();
  return (e: unknown) => {
    if (e instanceof AiError) return t(`errors.ai.${e.code}`);
    const m = (e as Error)?.message ?? '';
    if (m === 'popup') return t('offers.mail.errors.popup');
    if (m.startsWith('mail_')) return t(`offers.mail.errors.${m.slice(5)}`);
    return errorMessage(e, t);
  };
}

// ───────────── Ajout manuel ─────────────

function AddOfferForm({ onClose, onAdded }: { onClose: () => void; onAdded: (o: ReceivedOffer) => void }) {
  const { t } = useI18n();
  const [form, setForm] = useState<ManualOffer>({ title: '', company: '', location: '', link: '', source: '', offer_text: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const set = (k: keyof ManualOffer, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!form.title.trim() && !form.company.trim()) { setError(new Error(t('offers.add.required'))); return; }
    if (form.link && !/^https?:\/\//.test(form.link.trim())) { setError(new Error(t('offers.add.badLink'))); return; }
    setBusy(true);
    try {
      onAdded(await addManualOffer({ ...form, link: form.link.trim(), title: form.title.trim(), company: form.company.trim() }));
      onClose();
    } catch (err) { setError(err); setBusy(false); }
  };

  return (
    <Modal title={t('offers.add.title')} onClose={onClose}>
      <form onSubmit={submit} className="stack-lg">
        {error != null && <Notice tone="error">{errorMessage(error, t)}</Notice>}
        <div className="grid-2">
          <div className="field">
            <label htmlFor="of-title">{t('history.job')}</label>
            <input id="of-title" className="input" value={form.title} onChange={(e) => set('title', e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="of-company">{t('targets.company')}</label>
            <input id="of-company" className="input" value={form.company} onChange={(e) => set('company', e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="of-location">{t('offers.location')}</label>
            <input id="of-location" className="input" value={form.location} onChange={(e) => set('location', e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="of-source">{t('history.source')}</label>
            <input id="of-source" className="input" value={form.source} placeholder="jobs.lu, Moovijob…" onChange={(e) => set('source', e.target.value)} />
          </div>
        </div>
        <div className="field">
          <label htmlFor="of-link">{t('offers.link')}</label>
          <input id="of-link" type="url" className="input" value={form.link} placeholder="https://" onChange={(e) => set('link', e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="of-text">{t('offers.text')}</label>
          <textarea id="of-text" className="input" rows={8} value={form.offer_text} placeholder={t('offers.textHint')} onChange={(e) => set('offer_text', e.target.value)} />
        </div>
        <div className="row-end">
          <button type="button" className="btn" onClick={onClose}>{t('common.cancel')}</button>
          <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? t('common.wait') : t('offers.add.cta')}</button>
        </div>
      </form>
    </Modal>
  );
}

// ───────────── Détail : lecture, analyse, vérifications, dossier, envoi ─────────────

function Check({ offer, k, onChange, disabled }: { offer: ReceivedOffer; k: OfferCheck; onChange: (o: ReceivedOffer) => void; disabled?: boolean }) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  return (
    <label className="check">
      <input type="checkbox" checked={Boolean(offer.checks[k])} disabled={busy || disabled}
        onChange={(e) => { setBusy(true); void setOfferCheck(offer, k, e.target.checked).then(onChange).finally(() => setBusy(false)); }} />
      <span>{t(`offers.checks.${k}`)}</span>
    </label>
  );
}

function List({ items }: { items?: string[] }) {
  return items?.length ? <ul className="bullets">{items.map((x, i) => <li key={i}>{x}</li>)}</ul> : <span className="muted">—</span>;
}

function OfferDetail({ offer, onChange, onClose }: { offer: ReceivedOffer; onChange: (o: ReceivedOffer) => void; onClose: () => void }) {
  const { t, lang: uiLang, locale } = useI18n();
  const { profile, targets, setTargets } = useApp();
  const errText = useErrText();
  const [lang, setLang] = useState<Lang>(profile.doc_lang);
  const [doc, setDoc] = useState<DocumentRow | null>(null);
  const [busy, setBusy] = useState<'' | 'analyze' | 'prepare' | 'send' | 'text'>('');
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState(offer.offer_text);
  const a = offer.analysis;
  const analyzed = Boolean(a.analyzed_at);
  const canPrepare = Boolean(offer.checks.offer_read && offer.checks.conditions_ok);
  const canSend = Boolean(doc && offer.checks.docs_reviewed);

  // Ouvrir l'offre la marque comme vue : elle sort du compteur des nouvelles offres.
  useEffect(() => {
    if (!offer.seen_at) void updateReceivedOffer(offer.id, { seen_at: new Date().toISOString() }).then(onChange).catch(() => undefined);
    if (offer.document_id) fetchDocument(offer.document_id).then(setDoc).catch(() => setDoc(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offer.id]);

  const run = async (kind: typeof busy, fn: () => Promise<void>) => {
    setBusy(kind); setError(null);
    try { await fn(); } catch (e) { setError(errText(e)); } finally { setBusy(''); }
  };

  const saveText = () => run('text', async () => onChange(await updateReceivedOffer(offer.id, { offer_text: text.trim() })));
  const analyze = () => run('analyze', async () => onChange((await analyzeOffer(offer.id, uiLang)).offer));

  const prepare = () => run('prepare', async () => {
    const offerText = [a.job_title || offer.title, [a.company || offer.company, a.location || offer.location].filter(Boolean).join(' – '), offer.offer_text].filter(Boolean).join('\n');
    let current = await updateReceivedOffer(offer.id, { status: 'preparing' });
    onChange(current);
    try {
      const target = offer.target_id ? targets.find((x) => x.id === offer.target_id) ?? null : null;
      const row = target ?? await upsertTargetFromBrief({
        company: a.company || offer.company || offer.title, job_title: a.job_title || offer.title, location: a.location || offer.location, offer_text: offerText,
      }, targets, offer.link);
      if (!target) setTargets((l) => (l.some((x) => x.id === row.id) ? l.map((x) => (x.id === row.id ? row : x)) : [row, ...l]));
      const document = aiEnabled()
        ? (await tailorDocuments({ offer_text: offerText.padEnd(80, ' '), lang, target_id: row.id })).document
        : await createTemplateDocument(row, profile, lang, a.job_title || offer.title, offerText);
      setDoc(document);
      current = await updateReceivedOffer(offer.id, { status: 'ready', target_id: row.id, document_id: document.id });
      onChange(current);
    } catch (e) {
      onChange(await updateReceivedOffer(offer.id, { status: analyzed ? 'analyzed' : 'new' }).catch(() => offer));
      throw e;
    }
  });

  const sent = () => run('send', async () => {
    const target = targets.find((x) => x.id === offer.target_id);
    if (!target || !doc) return;
    const row = await markApplied(target, {
      document: doc, source: offer.source || t(`offers.origins.${offer.origin}`), jobTitle: doc.job_title || offer.title, followupDays: profile.followup_days,
    });
    setTargets((l) => l.map((x) => (x.id === row.id ? row : x)));
    onChange(await updateReceivedOffer(offer.id, { status: 'sent', application_id: row.application_id }));
  });

  const followup = useMemo(() => {
    const d = new Date(); d.setDate(d.getDate() + profile.followup_days); return isoDay(d);
  }, [profile.followup_days]);

  return (
    <div className="stack-xl">
      <div className="row-between wrap">
        <button type="button" className="link-btn" onClick={onClose}>← {t('offers.back')}</button>
        <span className="small muted">{t(`offers.origins.${offer.origin}`)}{offer.source ? ` · ${offer.source}` : ''} · {fmtDate(offer.received_at, locale)}</span>
      </div>
      <header className="stack">
        <h1 className="h1">{a.job_title || offer.title || offer.company}</h1>
        <p className="muted">{[a.company || offer.company, a.location || offer.location].filter(Boolean).join(' · ')}</p>
      </header>
      {error && <Notice tone="error">{error}</Notice>}

      {/* 1. Lire l'offre */}
      <section className="card stack-lg" aria-labelledby="st-read">
        <h3 id="st-read" className="h2"><span className="step">1</span> {t('offers.steps.read')}</h3>
        {offer.link && <a className="btn btn-sm" style={{ alignSelf: 'flex-start' }} href={offer.link} target="_blank" rel="noopener noreferrer">{t('offers.openAd')} ↗</a>}
        <div className="field">
          <label htmlFor="od-text">{t('offers.text')}</label>
          <textarea id="od-text" className="input" rows={10} value={text} placeholder={t('offers.textHint')} onChange={(e) => setText(e.target.value)} />
          <span className="small muted">{t('offers.textHelp')}</span>
        </div>
        {text.trim() !== offer.offer_text && (
          <button type="button" className="btn btn-sm" style={{ alignSelf: 'flex-start' }} disabled={busy === 'text'} onClick={() => void saveText()}>{t('common.save')}</button>
        )}
      </section>

      {/* 2. Analyse IA */}
      <section className="card stack-lg" aria-labelledby="st-ai">
        <div className="row-between wrap">
          <h3 id="st-ai" className="h2"><span className="step">2</span> {t('offers.steps.analyze')}</h3>
          {aiEnabled() && (
            <button type="button" className={analyzed ? 'btn btn-sm' : 'btn btn-primary'} disabled={!!busy || text.trim() !== offer.offer_text} onClick={() => void analyze()}>
              {busy === 'analyze' ? t('common.wait') : analyzed ? t('offers.reanalyze') : t('offers.analyze')}
            </button>
          )}
        </div>
        {!analyzed ? <p className="small muted">{aiEnabled() ? t('offers.analyzeHint') : t('free.analyzeOff')}</p> : (
          <div className="stack-lg">
            <div className="row-between wrap analysis-head">
              <div className="row-end" style={{ justifyContent: 'flex-start' }}>
                <Score value={a.score ?? 0} />
                <div>
                  <strong className={`reco reco-${a.recommendation}`}>{t(`offers.reco.${a.recommendation ?? 'apply_with_care'}`)}</strong>
                  <p className="small">{a.recommendation_reason}</p>
                </div>
              </div>
            </div>
            <dl className="facts">
              {(['job_title', 'company', 'location', 'contract', 'salary'] as const).map((k) => (
                <div key={k}><dt>{t(`offers.fields.${k}`)}</dt><dd>{a[k] || <span className="muted">{t('offers.notStated')}</span>}</dd></div>
              ))}
              <div><dt>{t('offers.fields.languages')}</dt><dd>{a.languages?.length ? a.languages.join(', ') : <span className="muted">{t('offers.notStated')}</span>}</dd></div>
            </dl>
            <div className="grid-2">
              <div><h4 className="h3">{t('offers.fields.missions')}</h4><List items={a.missions} /></div>
              <div><h4 className="h3">{t('offers.fields.requirements')}</h4><List items={a.requirements} /></div>
              <div><h4 className="h3">{t('offers.fields.strengths')}</h4><List items={a.strengths} /></div>
              <div><h4 className="h3">{t('offers.fields.gaps')}</h4><List items={a.gaps} /></div>
            </div>
            <p className="xs muted">{t('offers.aiNote')}</p>
          </div>
        )}
      </section>

      {/* 3. Vérifications, puis préparation */}
      <section className="card stack-lg" aria-labelledby="st-prep">
        <h3 id="st-prep" className="h2"><span className="step">3</span> {t('offers.steps.prepare')}</h3>
        <p className="small muted">{t('offers.prepareHint')}</p>
        <div className="stack">
          <Check offer={offer} k="offer_read" onChange={onChange} disabled={!!doc} />
          <Check offer={offer} k="conditions_ok" onChange={onChange} disabled={!!doc} />
        </div>
        {!doc && (
          <div className="row-end wrap" style={{ justifyContent: 'flex-start' }}>
            <label className="small" htmlFor="od-lang">{t('apply.dossier.lang')}</label>
            <select id="od-lang" className="input input-sm" value={lang} onChange={(e) => setLang(e.target.value as Lang)}>
              {LANGS.map((l) => <option key={l} value={l}>{t(`langs.${l}`)}</option>)}
            </select>
            <button type="button" className="btn btn-primary" disabled={!canPrepare || !!busy} onClick={() => void prepare()}>
              {busy === 'prepare' ? t('apply.dossier.busy') : t('offers.prepare')}
            </button>
          </div>
        )}
        {!canPrepare && !doc && <p className="xs muted">{t('offers.prepareLocked')}</p>}
      </section>

      {/* 4. Dossier et envoi */}
      {doc && (
        <section className="stack-lg" aria-labelledby="st-send">
          <h3 id="st-send" className="h2"><span className="step">4</span> {t('offers.steps.send')}</h3>
          <DossierEditor doc={doc} onSaved={setDoc} onDeleted={() => setDoc(null)} />
          <div className="card stack-lg">
            {offer.status === 'sent' ? (
              <Notice tone="ok">{t('offers.sentDone', { date: fmtDate(followup, locale) })} <Link to="/historique">{t('history.see')}</Link></Notice>
            ) : (
              <>
                <p className="small muted">{t('offers.sendHint')}</p>
                <Check offer={offer} k="docs_reviewed" onChange={onChange} />
                <div className="row-end wrap" style={{ justifyContent: 'flex-start' }}>
                  <a className={`btn ${offer.checks.docs_reviewed ? '' : 'disabled'}`} aria-disabled={!offer.checks.docs_reviewed}
                    href={offer.checks.docs_reviewed ? mailtoLink(doc) : undefined}>{t('opps.mail')}</a>
                  <button type="button" className="btn btn-accent" disabled={!canSend || !!busy} onClick={() => void sent()}>✓ {t('apply.sent.cta')}</button>
                </div>
                {!offer.checks.docs_reviewed && <p className="xs muted">{t('offers.sendLocked')}</p>}
              </>
            )}
          </div>
        </section>
      )}
    </div>
  );
}

// ───────────── Page ─────────────

export function ReceivedOffers() {
  const { t, locale } = useI18n();
  const errText = useErrText();
  const [params, setParams] = useSearchParams();
  const [offers, setOffers] = useState<ReceivedOffer[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [view, setView] = useState<View>('new');
  const [adding, setAdding] = useState(false);
  const [mailBusy, setMailBusy] = useState<MailProvider | null>(null);
  const [note, setNote] = useState<{ tone: 'ok' | 'error' | 'info'; text: string } | null>(null);
  const openId = params.get('offre');

  const load = () => { setError(null); fetchReceivedOffers().then(setOffers).catch(setError); };
  useEffect(load, []);

  const fresh = (offers ?? []).filter((o) => !o.seen_at).length;
  // Sans nouvelle offre, la vue par défaut montre celles à traiter.
  useEffect(() => { if (offers && !fresh && view === 'new') setView('todo'); }, [offers]); // eslint-disable-line react-hooks/exhaustive-deps
  const list = (offers ?? []).filter((o) => inView(o, view));
  const open = offers?.find((o) => o.id === openId) ?? null;
  const change = (o: ReceivedOffer) => setOffers((l) => (l ?? []).map((x) => (x.id === o.id ? o : x)));
  const show = (id: string | null) => { setParams(id ? { offre: id } : {}); window.scrollTo(0, 0); };

  const dismiss = (o: ReceivedOffer) => updateReceivedOffer(o.id, { status: 'dismissed', seen_at: o.seen_at ?? new Date().toISOString() })
    .then(() => setOffers((l) => (l ?? []).filter((x) => x.id !== o.id))).catch((e) => setNote({ tone: 'error', text: errText(e) }));

  const readMail = async (p: MailProvider) => {
    setMailBusy(p); setNote(null);
    try {
      const emails = await fetchAlertEmails(p);
      if (!emails.length) { setNote({ tone: 'info', text: t('offers.mail.none') }); return; }
      const { inserted } = await importAlerts(p, emails);
      setNote({ tone: 'ok', text: t('offers.mail.done', { n: inserted, emails: emails.length }) });
      load();
      setView('new');
    } catch (e) { setNote({ tone: 'error', text: errText(e) }); } finally { setMailBusy(null); }
  };

  if (error != null) return <div className="page"><ErrorState error={error} onRetry={load} /></div>;
  if (!offers) return <div className="page"><Loading rows={4} /></div>;
  if (openId && open) return <div className="page stack-xl"><OfferDetail offer={open} onChange={change} onClose={() => show(null)} /></div>;

  return (
    <div className="page stack-xl">
      <header className="page-head">
        <div>
          <p className="eyebrow">{t('offers.eyebrow')}</p>
          <h1 className="h1">{t('offers.title')} {fresh > 0 && <span className="pill" aria-label={t('offers.newCount', { n: fresh })}>{fresh}</span>}</h1>
          <p className="muted small">{t('offers.intro')}</p>
        </div>
        <button type="button" className="btn btn-primary" onClick={() => setAdding(true)}>+ {t('offers.add.title')}</button>
      </header>

      {fresh > 0 && <Notice tone="info"><strong>{t('offers.alert', { n: fresh })}</strong> {t('offers.alertHint')}</Notice>}

      <section className="card stack" aria-labelledby="mail-h">
        <h2 id="mail-h" className="h3">{t('offers.mail.title')} <span className="xs muted">({t('common.optional')})</span></h2>
        <p className="small muted">{t('offers.mail.intro')}</p>
        <div className="row-end wrap" style={{ justifyContent: 'flex-start' }}>
          {(['gmail', 'outlook'] as const).map((p) => (
            <button key={p} type="button" className="btn btn-sm" disabled={!aiEnabled() || !mailConfigured(p) || !!mailBusy} onClick={() => void readMail(p)}
              title={mailConfigured(p) ? undefined : t('offers.mail.notConfigured')}>
              {mailBusy === p ? t('common.wait') : t(`offers.mail.read_${p}`)}
            </button>
          ))}
        </div>
        {!aiEnabled() ? <p className="xs muted">{t('free.mailOff')}</p>
          : !mailConfigured('gmail') && !mailConfigured('outlook') && <p className="xs muted">{t('offers.mail.notConfigured')}</p>}
        <p className="xs muted">{t('offers.mail.privacy')}</p>
      </section>
      {note && <Notice tone={note.tone}>{note.text}</Notice>}

      <div className="tabs" role="tablist" aria-label={t('offers.title')}>
        {(['new', 'todo', 'sent', 'all'] as const).map((v) => (
          <button key={v} type="button" role="tab" aria-selected={view === v} className={view === v ? 'active' : ''} onClick={() => setView(v)}>
            {t(`offers.views.${v}`)} ({offers.filter((o) => inView(o, v)).length})
          </button>
        ))}
      </div>

      {!offers.length ? <Empty title={t('offers.empty')}>{t('offers.emptyHint')}</Empty>
        : !list.length ? <Empty title={t('offers.emptyView')} />
          : (
            <div className="stack">
              {list.map((o) => (
                <article key={o.id} className={`card opp ${o.seen_at ? '' : 'is-new'}`}>
                  <div className="opp-head">
                    {o.analysis.analyzed_at ? <Score value={o.analysis.score ?? 0} /> : <span className="score score-low" aria-hidden="true">?</span>}
                    <div className="grow">
                      <strong>{o.analysis.job_title || o.title || o.company}</strong>
                      {!o.seen_at && <span className="tag status-interview" style={{ marginLeft: 8 }}>{t('offers.new')}</span>}
                      <div className="small muted">{[o.analysis.company || o.company, o.analysis.location || o.location].filter(Boolean).join(' · ')}</div>
                      <div className="xs muted">{t(`offers.origins.${o.origin}`)}{o.source ? ` · ${o.source}` : ''} · {fmtDate(o.received_at, locale)} · {t(`offers.statuses.${o.status}`)}</div>
                      {o.analysis.recommendation && <p className="small"><span className={`reco reco-${o.analysis.recommendation}`}>{t(`offers.reco.${o.analysis.recommendation}`)}</span></p>}
                    </div>
                  </div>
                  <div className="row-end wrap">
                    {o.status !== 'sent' && <button type="button" className="link-btn danger small" onClick={() => void dismiss(o)}>{t('offers.dismiss')}</button>}
                    <button type="button" className="btn btn-sm btn-primary" onClick={() => show(o.id)}>{o.status === 'sent' ? t('offers.view') : t('offers.read')}</button>
                  </div>
                </article>
              ))}
            </div>
          )}
      {adding && <AddOfferForm onClose={() => setAdding(false)} onAdded={(o) => { setOffers((l) => [o, ...(l ?? [])]); show(o.id); }} />}
    </div>
  );
}
