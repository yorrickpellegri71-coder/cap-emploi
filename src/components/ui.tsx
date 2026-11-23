import { useEffect, useRef, useState, type InputHTMLAttributes, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useI18n, type TFn } from '../i18n';
import { UI_LANGS, type UiLang } from '../lib/types';

export function errorMessage(e: unknown, t: TFn): string {
  const msg = (e as { message?: string })?.message ?? String(e);
  if (/Failed to fetch|NetworkError|Load failed/i.test(msg)) return t('errors.network');
  if (/JWT|session/i.test(msg) && /expired|missing/i.test(msg)) return t('errors.expired');
  return msg;
}

export function Brand({ to = '/' }: { to?: string }) {
  return (
    <Link to={to} className="brand" aria-label="Cap Emploi Luxembourg">
      <svg className="brand-mark" width="30" height="30" viewBox="0 0 64 64" aria-hidden="true"><rect width="64" height="64" rx="16" fill="var(--brand)" /><path d="M45 19 L36 36 L28 28 Z" fill="var(--accent)" /><path d="M19 45 L28 28 L36 36 Z" fill="#fff" /></svg>
      <span className="brand-text" aria-hidden="true"><span><b>cap</b>emploi</span><small>Luxembourg</small></span>
    </Link>
  );
}

export function Loading({ rows = 1 }: { rows?: number }) {
  const { t } = useI18n();
  return (
    <div className="stack" role="status" aria-live="polite">
      <span className="sr-only">{t('common.loading')}</span>
      {Array.from({ length: rows }, (_, i) => <div key={i} className="skeleton" />)}
    </div>
  );
}

export function Notice({ tone = 'info', children }: { tone?: 'info' | 'warn' | 'error' | 'ok'; children: ReactNode }) {
  return (
    <div className={`notice ${tone}`} role={tone === 'error' ? 'alert' : 'status'}>
      <div>{children}</div>
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const { t } = useI18n();
  return (
    <Notice tone="error">
      <div className="stack">
        <span><strong>{t('errors.load')}</strong> {errorMessage(error, t)}</span>
        {onRetry && <button type="button" className="btn btn-sm" style={{ alignSelf: 'flex-start' }} onClick={onRetry}>{t('common.retry')}</button>}
      </div>
    </Notice>
  );
}

export function Empty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <strong>{title}</strong>
      {children && <span className="muted">{children}</span>}
      {action}
    </div>
  );
}

/** Copie un texte et confirme pendant deux secondes. */
export function CopyButton({ text, label, className = 'btn btn-primary' }: { text: string; label?: string; className?: string }) {
  const { t } = useI18n();
  const [done, setDone] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Repli pour les navigateurs sans presse-papiers asynchrone.
      const area = document.createElement('textarea');
      area.value = text;
      document.body.appendChild(area);
      area.select();
      document.execCommand('copy');
      area.remove();
    }
    setDone(true);
    window.setTimeout(() => setDone(false), 2000);
  };
  return (
    <button type="button" className={className} onClick={() => void copy()} aria-live="polite">
      {done ? `✓ ${t('common.copied')}` : label ?? t('common.copy')}
    </button>
  );
}

/** Fenêtre modale accessible (fermeture par Échap ou clic sur le fond). */
export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const { t } = useI18n();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    ref.current?.querySelector<HTMLElement>('input, select, textarea, button')?.focus();
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title} ref={ref}>
        <div className="modal-head">
          <h2 className="h2">{title}</h2>
          <button type="button" className="icon-btn" aria-label={t('common.close')} onClick={onClose}>×</button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function LangSwitch({ onChange }: { onChange?: (l: UiLang) => void }) {
  const { lang, setLang, t } = useI18n();
  const pick = (l: UiLang) => { setLang(l); onChange?.(l); };
  // Boutons sur grand écran ; liste déroulante sur téléphone, où cinq boutons ne tiennent pas dans la barre.
  return (
    <>
      <div className="lang-switch" role="group" aria-label={t('common.language')}>
        {UI_LANGS.map((l) => (
          <button key={l} type="button" className={l === lang ? 'active' : ''} aria-pressed={l === lang}
            title={t(`langs.${l}`)} onClick={() => pick(l)}>{l.toUpperCase()}</button>
        ))}
      </div>
      <select className="lang-select" aria-label={t('common.language')} value={lang} onChange={(e) => pick(e.target.value as UiLang)}>
        {UI_LANGS.map((l) => <option key={l} value={l}>{l.toUpperCase()}</option>)}
      </select>
    </>
  );
}

export function fmtDate(iso: string | null, locale: string): string {
  if (!iso) return '—';
  const d = iso.length === 10 ? new Date(`${iso}T12:00:00`) : new Date(iso);
  return d.toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' });
}

/** Champ mot de passe avec bouton œil pour afficher ou masquer la saisie. */
export function PasswordInput(props: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>) {
  const { t } = useI18n();
  const [shown, setShown] = useState(false);
  return (
    <div className="pwd-wrap">
      <input {...props} className={`input ${props.className ?? ''}`.trim()} type={shown ? 'text' : 'password'} autoCapitalize="none" autoCorrect="off" spellCheck={false} />
      <button type="button" className="pwd-toggle" aria-label={shown ? t('auth.hidePwd') : t('auth.showPwd')} aria-pressed={shown} onClick={() => setShown((v) => !v)}>
        {shown ? (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 3l18 18" /><path d="M10.6 5.1A9.8 9.8 0 0 1 12 5c6 0 10 7 10 7a17 17 0 0 1-3.2 3.9M6.6 6.6A17.6 17.6 0 0 0 2 12s4 7 10 7a9.6 9.6 0 0 0 5.4-1.6" /><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" /></svg>
        ) : (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></svg>
        )}
      </button>
    </div>
  );
}
