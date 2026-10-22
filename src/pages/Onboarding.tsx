import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Brand, LangSwitch, Notice, errorMessage } from '../components/ui';
import { useI18n } from '../i18n';
import { useApp } from '../lib/session';
import { TradePicker } from '../components/TradePicker';
import { targetTrades } from '../lib/trades';
import { LANGS, type Lang } from '../lib/types';

export function Onboarding() {
  const { t, lang } = useI18n();
  const { profile, updateProfile } = useApp();
  const navigate = useNavigate();
  const [name, setName] = useState(profile.display_name);
  const [trades, setTrades] = useState(targetTrades(profile));
  const [docLang, setDocLang] = useState<Lang>(profile.doc_lang);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await updateProfile({ display_name: name.trim(), trade: trades[0], target_trades: trades, doc_lang: docLang, ui_lang: lang, onboarded: true });
      navigate('/profil?bienvenue=1', { replace: true });
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  };

  return (
    <div className="center-screen">
      <form className="auth auth-wide stack-lg" onSubmit={submit}>
        <div className="row-between"><Brand /><LangSwitch /></div>
        <h1 className="h1">{t('onboarding.title')}</h1>
        <p className="muted">{t('onboarding.intro')}</p>
        {error != null && <Notice tone="error">{errorMessage(error, t)}</Notice>}
        <div className="field">
          <label htmlFor="ob-name">{t('profile.name')}</label>
          <input id="ob-name" className="input" value={name} autoComplete="name" onChange={(e) => setName(e.target.value)} />
        </div>
        <TradePicker value={trades} onChange={setTrades} legend={t('onboarding.trade')} hint={t('onboarding.tradeHint')} />
        <div className="field">
          <label htmlFor="ob-doc">{t('profile.docLang')}</label>
          <select id="ob-doc" className="input" value={docLang} onChange={(e) => setDocLang(e.target.value as Lang)}>
            {LANGS.map((l) => <option key={l} value={l}>{t(`langs.${l}`)}</option>)}
          </select>
          <span className="hint">{t('profile.docLangHint')}</span>
        </div>
        <button className="btn btn-primary" type="submit" disabled={busy}>{busy ? t('common.wait') : t('onboarding.cta')}</button>
      </form>
    </div>
  );
}
