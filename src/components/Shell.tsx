import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { useI18n } from '../i18n';
import { dueFollowups } from '../lib/dates';
import { useApp } from '../lib/session';
import { Brand, LangSwitch } from './ui';

const NAV = [
  { to: '/', key: 'nav.week', icon: 'M3 4h18v17H3zM3 9h18M8 2v4M16 2v4' },
  { to: '/postuler', key: 'nav.apply', icon: 'M3 11 21 3l-8 18-2-8-8-2zM11 13l10-10' },
  { to: '/cibles', key: 'nav.targets', icon: 'M3 5h4v14H3zM10 5h4v9h-4zM17 5h4v6h-4z' },
  { to: '/messages', key: 'nav.messages', icon: 'M4 5h16v11H8l-4 4z' },
  { to: '/profil', key: 'nav.profile', icon: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0' },
];

function Icon({ d }: { d: string }) {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>;
}

export function Shell() {
  const { t } = useI18n();
  const { profile, targets, updateProfile, signOut } = useApp();
  const { pathname } = useLocation();
  const [menu, setMenu] = useState(false);
  const due = dueFollowups(targets, profile.followup_days).length;

  useEffect(() => { window.scrollTo(0, 0); setMenu(false); }, [pathname]);

  return (
    <>
      <a href="#contenu" className="sr-only">{t('nav.skip')}</a>
      <header className="topbar">
        <Brand />
        <nav className="nav" aria-label={t('nav.main')}>
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.to === '/'}>
              {t(n.key)}
              {n.to === '/' && due > 0 && <span className="pill">{due}</span>}
            </NavLink>
          ))}
        </nav>
        <div className="spacer" />
        <LangSwitch onChange={(l) => void updateProfile({ ui_lang: l })} />
        <div style={{ position: 'relative' }}>
          <button type="button" className="icon-btn" aria-haspopup="true" aria-expanded={menu} aria-label={t('nav.account')} onClick={() => setMenu((m) => !m)}>
            {(profile.display_name || '·').slice(0, 1).toUpperCase()}
          </button>
          {menu && (
            <div className="popover menu">
              <Link to="/profil">{t('nav.profile')}</Link>
              <Link to="/confidentialite">{t('nav.privacy')}</Link>
              <button type="button" onClick={() => void signOut()}>{t('nav.signout')}</button>
            </div>
          )}
        </div>
      </header>
      <main id="contenu">
        <Outlet />
      </main>
      <nav className="tabbar" aria-label={t('nav.main')}>
        {NAV.map((n) => (
          <NavLink key={n.to} to={n.to} end={n.to === '/'}>
            <Icon d={n.icon} />
            <span>{t(n.key)}</span>
            {n.to === '/' && due > 0 && <span className="pill">{due}</span>}
          </NavLink>
        ))}
      </nav>
    </>
  );
}
