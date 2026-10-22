import { useEffect, useState } from 'react';
import { countNewOffers } from '../lib/api';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { useI18n } from '../i18n';
import { dueFollowups } from '../lib/dates';
import { useApp } from '../lib/session';
import { Brand, LangSwitch } from './ui';

const NAV = [
  { to: '/', key: 'nav.week', icon: 'M3 4h18v17H3zM3 9h18M8 2v4M16 2v4' },
  { to: '/offres', key: 'nav.offers', short: 'nav.offersShort', icon: 'M4 4h16v12H4zM4 4l8 7 8-7M8 20h8' },
  { to: '/opportunites', key: 'nav.opps', icon: 'M12 2l2.9 6.6 7.1.6-5.4 4.7 1.6 7.1L12 17.3 5.8 21l1.6-7.1L2 9.2l7.1-.6z' },
  { to: '/postuler', key: 'nav.apply', icon: 'M3 11 21 3l-8 18-2-8-8-2zM11 13l10-10' },
  { to: '/cibles', key: 'nav.targets', icon: 'M3 5h4v14H3zM10 5h4v9h-4zM17 5h4v6h-4z' },
  { to: '/historique', key: 'nav.history', icon: 'M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5M12 7v5l3 3', desktopOnly: true },
  { to: '/messages', key: 'nav.messages', icon: 'M4 5h16v11H8l-4 4z', desktopOnly: true },
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
  const [fresh, setFresh] = useState(0);
  // Compteur des nouvelles offres reçues, rafraîchi à chaque changement de page.
  useEffect(() => { countNewOffers().then(setFresh).catch(() => undefined); }, [pathname]);
  const badge = (to: string) => (to === '/' ? due : to === '/offres' ? fresh : 0);

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
              {badge(n.to) > 0 && <span className="pill">{badge(n.to)}</span>}
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
              <Link to="/historique">{t('nav.history')}</Link>
              <Link to="/messages">{t('nav.messages')}</Link>
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
        {NAV.filter((n) => !n.desktopOnly).map((n) => (
          <NavLink key={n.to} to={n.to} end={n.to === '/'}>
            <Icon d={n.icon} />
            <span>{t(n.short ?? n.key)}</span>
            {badge(n.to) > 0 && <span className="pill">{badge(n.to)}</span>}
          </NavLink>
        ))}
      </nav>
    </>
  );
}
