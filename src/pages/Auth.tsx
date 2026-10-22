import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { Brand, LangSwitch, Notice, errorMessage } from '../components/ui';
import { useI18n, type TFn } from '../i18n';
import { useSession } from '../lib/session';
import { supabase } from '../lib/supabase';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const appUrl = (path = '') => `${window.location.origin}${import.meta.env.BASE_URL}${path}`;

function authError(e: unknown, t: TFn): string {
  const msg = errorMessage(e, t);
  if (/Invalid login credentials/i.test(msg)) return t('auth.err.credentials');
  if (/Email not confirmed/i.test(msg)) return t('auth.err.unconfirmed');
  if (/already registered|already been registered/i.test(msg)) return t('auth.err.exists');
  if (/rate limit|too many/i.test(msg)) return t('auth.err.rate');
  if (/password/i.test(msg) && /weak|short|least/i.test(msg)) return t('auth.err.weak');
  return msg;
}

function AuthFrame({ children }: { children: React.ReactNode }) {
  const { t } = useI18n();
  return (
    <div className="center-screen">
      <div className="auth">
        <div className="row-between"><Brand to="/connexion" /><LangSwitch /></div>
        {children}
        <p className="xs muted"><Link to="/confidentialite">{t('nav.privacy')}</Link></p>
      </div>
    </div>
  );
}

function AuthPage({ mode }: { mode: 'login' | 'signup' }) {
  const { t, lang } = useI18n();
  const { expired } = useSession();
  const signup = mode === 'signup';
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [consent, setConsent] = useState(false);
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const emailErr = !EMAIL.test(email.trim()) ? t('auth.err.email') : null;
  const pwdErr = password.length < 8 ? t('auth.err.weak') : null;
  const consentErr = signup && !consent ? t('auth.err.consent') : null;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    setError(null);
    if (emailErr || pwdErr || consentErr) return;
    setBusy(true);
    try {
      if (signup) {
        const { data, error: err } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: { data: { app: 'cap_emploi', display_name: name.trim(), ui_lang: lang, consent: 'true' }, emailRedirectTo: appUrl() },
        });
        if (err) throw err;
        if (!data.session) setSent(true);
      } else {
        const { error: err } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (err) throw err;
      }
    } catch (err) {
      setError(authError(err, t));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthFrame>
      {!signup && <p className="lead">{t('auth.tagline')}</p>}
      {sent ? (
        <div className="stack-lg">
          <Notice tone="ok"><strong>{t('auth.created')}</strong> {t('auth.checkMail', { email: email.trim() })}</Notice>
          <Link className="btn btn-primary" to="/connexion">{t('auth.goLogin')}</Link>
        </div>
      ) : (
        <form onSubmit={submit} noValidate className="stack-lg">
          <h1 className="h1">{signup ? t('auth.signupTitle') : t('auth.loginTitle')}</h1>
          {expired && !signup && !error && <Notice tone="warn">{t('auth.expired')}</Notice>}
          {error && <Notice tone="error">{error}</Notice>}
          {signup && (
            <div className="field">
              <label htmlFor="name">{t('auth.name')} <span className="muted">({t('common.optional')})</span></label>
              <input id="name" className="input" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
          )}
          <div className="field">
            <label htmlFor="email">{t('auth.email')}</label>
            <input id="email" className="input" type="email" autoComplete="email" required value={email}
              aria-invalid={touched && !!emailErr} onChange={(e) => setEmail(e.target.value)} />
            {touched && emailErr && <span className="err">{emailErr}</span>}
          </div>
          <div className="field">
            <label htmlFor="password">{t('auth.password')}</label>
            <input id="password" className="input" type="password" autoComplete={signup ? 'new-password' : 'current-password'} required minLength={8}
              value={password} aria-invalid={touched && !!pwdErr} onChange={(e) => setPassword(e.target.value)} />
            <span className={touched && pwdErr ? 'err' : 'hint'}>{touched && pwdErr ? pwdErr : t('auth.pwdHint')}</span>
            {!signup && <Link to="/mot-de-passe-oublie" className="small">{t('auth.forgot')}</Link>}
          </div>
          {signup && (
            <div className="field">
              <label className="check">
                <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} aria-invalid={touched && !!consentErr} />
                <span>{t('auth.consent')} <Link to="/confidentialite" target="_blank">{t('nav.privacy')}</Link></span>
              </label>
              {touched && consentErr && <span className="err">{consentErr}</span>}
            </div>
          )}
          <button className="btn btn-primary" type="submit" disabled={busy}>
            {busy ? t('common.wait') : signup ? t('auth.signupCta') : t('auth.loginCta')}
          </button>
          <p className="small muted">
            {signup
              ? <>{t('auth.haveAccount')} <Link to="/connexion">{t('auth.loginCta')}</Link></>
              : <>{t('auth.noAccount')} <Link to="/inscription">{t('auth.signupCta')}</Link></>}
          </p>
        </form>
      )}
    </AuthFrame>
  );
}

export function ForgotPassword() {
  const { t } = useI18n();
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!EMAIL.test(email.trim())) { setError(t('auth.err.email')); return; }
    setBusy(true);
    try {
      const { error: err } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: appUrl('nouveau-mot-de-passe?recovery=1') });
      if (err) throw err;
      setSent(true);
    } catch (err) {
      setError(authError(err, t));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthFrame>
      {sent ? (
        <div className="stack-lg">
          {/* Message identique que le compte existe ou non. */}
          <Notice tone="ok">{t('auth.resetSent', { email: email.trim() })}</Notice>
          <Link className="btn" to="/connexion">{t('auth.backLogin')}</Link>
        </div>
      ) : (
        <form onSubmit={submit} noValidate className="stack-lg">
          <h1 className="h1">{t('auth.forgotTitle')}</h1>
          <p className="muted small">{t('auth.forgotIntro')}</p>
          {error && <Notice tone="error">{error}</Notice>}
          <div className="field">
            <label htmlFor="fp-email">{t('auth.email')}</label>
            <input id="fp-email" className="input" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <button className="btn btn-primary" type="submit" disabled={busy}>{busy ? t('common.wait') : t('auth.sendLink')}</button>
          <Link className="small" to="/connexion">← {t('auth.backLogin')}</Link>
        </form>
      )}
    </AuthFrame>
  );
}

export function NewPassword() {
  const { t } = useI18n();
  const { session, authReady, clearRecovery } = useSession();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password.length < 8) { setError(t('auth.err.weak')); return; }
    if (password !== confirm) { setError(t('auth.err.mismatch')); return; }
    setBusy(true);
    try {
      const { error: err } = await supabase.auth.updateUser({ password });
      if (err) throw err;
      clearRecovery();
      setDone(true);
    } catch (err) {
      setError(authError(err, t));
    } finally {
      setBusy(false);
    }
  };

  let body;
  if (!authReady) body = <p className="muted" role="status">{t('common.loading')}</p>;
  else if (done) body = (
    <div className="stack-lg">
      <Notice tone="ok">{t('auth.pwdChanged')}</Notice>
      <Link className="btn btn-primary" to="/">{t('auth.openApp')}</Link>
    </div>
  );
  else if (!session) body = (
    <div className="stack-lg">
      <Notice tone="error">{t('auth.linkInvalid')}</Notice>
      <Link className="btn btn-primary" to="/mot-de-passe-oublie">{t('auth.sendLink')}</Link>
    </div>
  );
  else body = (
    <form onSubmit={submit} noValidate className="stack-lg">
      <h1 className="h1">{t('auth.newPwdTitle')}</h1>
      <p className="muted small">{session.user.email}</p>
      {error && <Notice tone="error">{error}</Notice>}
      <div className="field">
        <label htmlFor="np1">{t('auth.password')}</label>
        <input id="np1" className="input" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        <span className="hint">{t('auth.pwdHint')}</span>
      </div>
      <div className="field">
        <label htmlFor="np2">{t('auth.confirmPwd')}</label>
        <input id="np2" className="input" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
      </div>
      <button className="btn btn-primary" type="submit" disabled={busy}>{busy ? t('common.wait') : t('common.save')}</button>
    </form>
  );
  return <AuthFrame>{body}</AuthFrame>;
}

export function Privacy() {
  const { t } = useI18n();
  const { session } = useSession();
  return (
    <div className="page page-narrow stack-lg">
      <Brand to={session ? '/' : '/connexion'} />
      <h1 className="h1">{t('privacy.title')}</h1>
      {['who', 'data', 'ai', 'mail', 'where', 'rights', 'contact'].map((k) => (
        <section key={k} className="stack">
          <h2 className="h2">{t(`privacy.${k}.h`)}</h2>
          <p>{t(`privacy.${k}.p`)}</p>
        </section>
      ))}
      <p className="xs muted">{t('privacy.updated')}</p>
    </div>
  );
}

export const Login = () => <AuthPage mode="login" />;
export const Signup = () => <AuthPage mode="signup" />;
