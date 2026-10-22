import { Link, Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import { Shell } from './components/Shell';
import { Brand, Empty, ErrorState, Loading } from './components/ui';
import { useI18n } from './i18n';
import { useSession } from './lib/session';
import { ForgotPassword, Login, NewPassword, Privacy, Signup } from './pages/Auth';
import { Apply } from './pages/Apply';
import { Messages } from './pages/Messages';
import { Onboarding } from './pages/Onboarding';
import { Profile } from './pages/Profile';
import { Targets } from './pages/Targets';
import { Week } from './pages/Week';

function Splash() {
  return <div className="center-screen"><div className="auth"><Brand /><Loading /></div></div>;
}

/** Routes publiques : un utilisateur connecté est renvoyé vers l'application. */
function PublicOnly() {
  const { session, authReady, recovery } = useSession();
  if (!authReady) return <Splash />;
  if (session && recovery) return <Navigate to="/nouveau-mot-de-passe" replace />;
  return session ? <Navigate to="/" replace /> : <Outlet />;
}

/** Routes protégées : session requise, profil chargé. */
function Protected() {
  const { t } = useI18n();
  const { session, authReady, profile, dataError, reload, signOut, recovery } = useSession();
  if (!authReady) return <Splash />;
  if (session && recovery) return <Navigate to="/nouveau-mot-de-passe" replace />;
  if (!session) return <Navigate to="/connexion" replace />;
  if (dataError) {
    return (
      <div className="center-screen">
        <div className="auth stack-lg">
          <Brand />
          <ErrorState error={dataError} onRetry={() => void reload()} />
          <button type="button" className="link-btn" onClick={() => void signOut()}>{t('nav.signout')}</button>
        </div>
      </div>
    );
  }
  if (!profile) return <Splash />;
  return <Outlet />;
}

function Onboarded({ want }: { want: boolean }) {
  const { profile } = useSession();
  if (profile && profile.onboarded !== want) return <Navigate to={want ? '/bienvenue' : '/'} replace />;
  return <Outlet />;
}

/** Ancienne adresse des documents : renvoie vers « Postuler » en gardant la cible. */
function ToApply() {
  const { search } = useLocation();
  return <Navigate to={`/postuler${search}`} replace />;
}

function NotFound() {
  const { t } = useI18n();
  return (
    <div className="page stack-lg">
      <h1 className="h1">{t('errors.notFound')}</h1>
      <Empty title="404" action={<Link className="btn" to="/">{t('nav.week')}</Link>} />
    </div>
  );
}

export function App() {
  return (
    <Routes>
      <Route element={<PublicOnly />}>
        <Route path="/connexion" element={<Login />} />
        <Route path="/inscription" element={<Signup />} />
        <Route path="/mot-de-passe-oublie" element={<ForgotPassword />} />
      </Route>
      <Route path="/nouveau-mot-de-passe" element={<NewPassword />} />
      <Route path="/confidentialite" element={<Privacy />} />
      <Route element={<Protected />}>
        <Route element={<Onboarded want={false} />}>
          <Route path="/bienvenue" element={<Onboarding />} />
        </Route>
        <Route element={<Onboarded want />}>
          <Route element={<Shell />}>
            <Route index element={<Week />} />
            <Route path="/cibles" element={<Targets />} />
            <Route path="/messages" element={<Messages />} />
            <Route path="/postuler" element={<Apply />} />
            <Route path="/documents" element={<ToApply />} />
            <Route path="/profil" element={<Profile />} />
            <Route path="*" element={<NotFound />} />
          </Route>
        </Route>
      </Route>
    </Routes>
  );
}
