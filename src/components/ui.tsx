import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useI18n, type TFn } from '../i18n';

export function errorMessage(e: unknown, t: TFn): string {
  const msg = (e as { message?: string })?.message ?? String(e);
  if (/Failed to fetch|NetworkError|Load failed/i.test(msg)) return t('errors.network');
  if (/JWT|session/i.test(msg) && /expired|missing/i.test(msg)) return t('errors.expired');
  return msg;
}

export function Brand({ to = '/' }: { to?: string }) {
  return (
    <Link to={to} className="brand" aria-label="Cap Emploi">
      <svg width="22" height="22" viewBox="0 0 64 64" aria-hidden="true"><rect width="64" height="64" rx="14" fill="var(--brand)" /><path d="M32 12 L40 32 L32 52 L24 32 Z" fill="var(--accent)" /></svg>
      Cap Emploi
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

export function LangSwitch({ onChange }: { onChange?: (l: 'fr' | 'en' | 'de') => void }) {
  const { lang, setLang, t } = useI18n();
  return (
    <div className="lang-switch" role="group" aria-label={t('common.language')}>
      {(['fr', 'en', 'de'] as const).map((l) => (
        <button key={l} type="button" className={l === lang ? 'active' : ''} aria-pressed={l === lang}
          onClick={() => { setLang(l); onChange?.(l); }}>{l.toUpperCase()}</button>
      ))}
    </div>
  );
}

export function fmtDate(iso: string | null, locale: string): string {
  if (!iso) return '—';
  const d = iso.length === 10 ? new Date(`${iso}T12:00:00`) : new Date(iso);
  return d.toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' });
}
