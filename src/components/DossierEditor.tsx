import { useEffect, useState } from 'react';
import { useI18n } from '../i18n';
import { deleteDocument, updateDocument } from '../lib/api';
import { exportDocx, exportPdf, fileName, type Piece } from '../lib/exportDoc';
import type { DocumentRow } from '../lib/types';
import { CopyButton, Notice, errorMessage } from './ui';

type Tab = 'email' | 'letter' | 'cv' | 'pitch';
const TABS: Tab[] = ['email', 'letter', 'cv', 'pitch'];
type Draft = Pick<DocumentRow, 'email_subject' | 'email_body' | 'letter' | 'cv' | 'pitch'>;
const draftOf = (d: DocumentRow): Draft => ({ email_subject: d.email_subject, email_body: d.email_body, letter: d.letter, cv: d.cv, pitch: d.pitch });

/** Dossier de candidature : quatre pièces modifiables, copiables et exportables une à une ou ensemble. */
export function DossierEditor({ doc, onSaved, onDeleted, footer }: {
  doc: DocumentRow; onSaved: (d: DocumentRow) => void; onDeleted: (id: string) => void; footer?: React.ReactNode;
}) {
  const { t } = useI18n();
  // Les anciens documents n'ont ni e-mail ni présentation : on ouvre alors sur la lettre.
  const [tab, setTab] = useState<Tab>(doc.email_body ? 'email' : 'letter');
  const [draft, setDraft] = useState<Draft>(draftOf(doc));
  const [state, setState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [error, setError] = useState<unknown>(null);
  useEffect(() => { setDraft(draftOf(doc)); setState('idle'); setTab(doc.email_body ? 'email' : 'letter'); }, [doc]);

  const dirty = (Object.keys(draft) as (keyof Draft)[]).some((k) => draft[k] !== doc[k]);
  const field: keyof Draft = tab === 'email' ? 'email_body' : tab;
  const label = (k: Tab) => t(`apply.pieces.${k}`);
  const pieceText = (k: Tab) => (k === 'email' ? `${t('messages.subject')} : ${draft.email_subject}\n\n${draft.email_body}` : draft[k]);
  const pieces = (): Piece[] => TABS.filter((k) => (k === 'email' ? draft.email_body : draft[k]).trim()).map((k, i) => ({ title: `${i + 1}. ${label(k)}`, text: pieceText(k) }));
  const set = (k: keyof Draft, v: string) => { setDraft((d) => ({ ...d, [k]: v })); setState('idle'); };

  const save = async () => {
    setState('saving');
    setError(null);
    try {
      await updateDocument(doc.id, draft);
      onSaved({ ...doc, ...draft });
      setState('saved');
    } catch (e) { setError(e); setState('idle'); }
  };

  const run = async (fn: () => Promise<void> | void) => {
    setError(null);
    try { await fn(); } catch (e) { setError((e as Error).message === 'popup' ? new Error(t('apply.popupBlocked')) : e); }
  };

  return (
    <section className="card stack-lg" aria-labelledby="doc-h">
      <div className="row-between wrap">
        <div>
          <h2 id="doc-h" className="h2">{[doc.job_title, doc.company].filter(Boolean).join(' · ') || t('apply.untitled')}</h2>
          <span className="xs muted">{t(`langs.${doc.lang}`)}</span>
        </div>
        <div className="tabs" role="tablist">
          {TABS.map((k) => (
            <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? 'active' : ''} onClick={() => setTab(k)}>{label(k)}</button>
          ))}
        </div>
      </div>
      {doc.gaps.length > 0 && (
        <Notice tone="warn">
          <strong>{t('apply.gapsTitle')}</strong>
          <ul className="small">{doc.gaps.map((g, i) => <li key={i}>{g}</li>)}</ul>
          <span className="small">{t('apply.gapsHint')}</span>
        </Notice>
      )}
      <p className="small muted">{t('apply.review')}</p>
      {error != null && <Notice tone="error">{errorMessage(error, t)}</Notice>}
      {tab === 'email' && (
        <div className="field">
          <label htmlFor="doc-subject">{t('messages.subject')}</label>
          <div className="row-end">
            <input id="doc-subject" className="input grow" value={draft.email_subject} onChange={(e) => set('email_subject', e.target.value)} />
            <CopyButton text={draft.email_subject} className="btn" />
          </div>
        </div>
      )}
      <label className="sr-only" htmlFor="doc-text">{label(tab)}</label>
      <textarea id="doc-text" className="input doc-text" rows={tab === 'cv' ? 24 : 14} value={draft[field]} onChange={(e) => set(field, e.target.value)} />
      <div className="row-between wrap">
        <span className="row-end wrap" style={{ justifyContent: 'flex-start' }}>
          <CopyButton text={draft[field]} className="btn btn-sm" />
          <button type="button" className="btn btn-sm" onClick={() => void run(() => exportDocx(pieceText(tab), fileName(label(tab), doc.company, 'docx')))}>{t('apply.word')}</button>
          <button type="button" className="btn btn-sm" onClick={() => void run(() => exportPdf(pieceText(tab), fileName(label(tab), doc.company, 'pdf'), doc.lang))}>{t('apply.pdf')}</button>
        </span>
        <button type="button" className="btn btn-sm" disabled={!dirty || state === 'saving'} onClick={() => void save()}>
          {state === 'saving' ? t('common.wait') : state === 'saved' && !dirty ? `✓ ${t('common.saved')}` : t('common.save')}
        </button>
      </div>
      <div className="row-between wrap dossier-bar">
        <button type="button" className="link-btn danger small" onClick={async () => {
          if (!window.confirm(t('apply.confirmDelete'))) return;
          try { await deleteDocument(doc.id); onDeleted(doc.id); } catch (e) { setError(e); }
        }}>{t('common.delete')}</button>
        <span className="row-end wrap">
          <button type="button" className="btn" onClick={() => void run(() => exportDocx(pieces(), fileName(t('apply.dossierName'), doc.company, 'docx')))}>{t('apply.allWord')}</button>
          <button type="button" className="btn" onClick={() => void run(() => exportPdf(pieces(), fileName(t('apply.dossierName'), doc.company, 'pdf'), doc.lang))}>{t('apply.allPdf')}</button>
          {footer}
        </span>
      </div>
    </section>
  );
}
