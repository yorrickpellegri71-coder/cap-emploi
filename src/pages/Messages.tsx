import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CopyButton, ErrorState, Loading } from '../components/ui';
import { useI18n } from '../i18n';
import { fetchMessages } from '../lib/api';
import { fillTemplate } from '../lib/dates';
import { useApp } from '../lib/session';
import { LANGS, type Lang, type MessageKind, type MessageTemplates } from '../lib/types';

const KINDS: MessageKind[] = ['first_contact', 'followup', 'thanks'];

export function Messages() {
  const { t } = useI18n();
  const { profile, targets } = useApp();
  const [params, setParams] = useSearchParams();
  const kind = (KINDS.includes(params.get('type') as MessageKind) ? params.get('type') : 'first_contact') as MessageKind;
  const targetId = params.get('cible') ?? '';
  const [lang, setLang] = useState<Lang>(profile.doc_lang);
  const [templates, setTemplates] = useState<MessageTemplates | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');

  const update = (k: string, v: string) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v); else next.delete(k);
    setParams(next, { replace: true });
  };

  useEffect(() => {
    setTemplates(null);
    setError(null);
    fetchMessages(lang, profile.trade).then(setTemplates).catch(setError);
  }, [lang, profile.trade]);

  const target = targets.find((x) => x.id === targetId);
  const vars = useMemo(() => ({
    contact: target?.contact_name ?? '',
    company: target?.company ?? '',
    me: profile.profile_data.full_name || profile.display_name,
    headline: profile.profile_data.headline ?? '',
  }), [target, profile]);

  // Le texte est régénéré à chaque changement de cible, de type ou de langue, puis modifiable librement.
  useEffect(() => {
    if (!templates) return;
    setSubject(fillTemplate(templates[kind].subject, vars));
    setBody(fillTemplate(templates[kind].body, vars));
  }, [templates, kind, vars]);

  const missing = [...new Set(`${subject} ${body}`.match(/\{\w+\}/g) ?? [])];

  return (
    <div className="page stack-xl">
      <header className="page-head">
        <div>
          <p className="eyebrow">{t('messages.eyebrow')}</p>
          <h1 className="h1">{t('messages.title')}</h1>
        </div>
      </header>

      <div className="tabs" role="tablist">
        {KINDS.map((k) => (
          <button key={k} type="button" role="tab" aria-selected={kind === k} className={kind === k ? 'active' : ''} onClick={() => update('type', k)}>
            {t(`messages.kinds.${k}`)}
          </button>
        ))}
      </div>

      <div className="grid-2">
        <div className="field">
          <label htmlFor="msg-target">{t('messages.target')}</label>
          <select id="msg-target" className="input" value={targetId} onChange={(e) => update('cible', e.target.value)}>
            <option value="">{t('messages.noTarget')}</option>
            {targets.map((x) => <option key={x.id} value={x.id}>{x.company}{x.contact_name ? ` · ${x.contact_name}` : ''}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor="msg-lang">{t('messages.lang')}</label>
          <select id="msg-lang" className="input" value={lang} onChange={(e) => setLang(e.target.value as Lang)}>
            {LANGS.map((l) => <option key={l} value={l}>{t(`langs.${l}`)}</option>)}
          </select>
        </div>
      </div>

      {error != null ? <ErrorState error={error} /> : !templates ? <Loading rows={3} /> : (
        <div className="card stack-lg">
          {missing.length > 0 && <p className="small muted">{t('messages.missing', { list: missing.join(', ') })}</p>}
          <div className="field">
            <label htmlFor="msg-subject">{t('messages.subject')}</label>
            <div className="row-end">
              <input id="msg-subject" className="input grow" value={subject} onChange={(e) => setSubject(e.target.value)} />
              <CopyButton text={subject} className="btn" />
            </div>
          </div>
          <div className="field">
            <label htmlFor="msg-body">{t('messages.body')}</label>
            <textarea id="msg-body" className="input" rows={12} value={body} onChange={(e) => setBody(e.target.value)} />
          </div>
          <div className="row-end"><CopyButton text={body} label={t('messages.copyBody')} /></div>
        </div>
      )}
    </div>
  );
}
