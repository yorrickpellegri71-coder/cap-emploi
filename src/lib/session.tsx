import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { useI18n } from '../i18n';
import { fetchTargets } from './api';
import { supabase, unwrap } from './supabase';
import type { Profile, Target } from './types';

interface Ctx {
  session: Session | null;
  authReady: boolean;
  profile: Profile | null;
  targets: Target[];
  dataError: unknown;
  expired: boolean;
  recovery: boolean;
  clearRecovery: () => void;
  reload: () => Promise<void>;
  updateProfile: (patch: Partial<Profile>) => Promise<void>;
  setTargets: (fn: (list: Target[]) => Target[]) => void;
  signOut: () => Promise<void>;
}

const SessionContext = createContext<Ctx | null>(null);

// Lien de réinitialisation ouvert : lu avant que Supabase ne nettoie l'adresse.
const recoveryLanding = typeof window !== 'undefined' && /type=recovery|recovery=1/.test(window.location.hash + window.location.search);

export function SessionProvider({ children }: { children: ReactNode }) {
  const { lang, setLang } = useI18n();
  const [session, setSession] = useState<Session | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [targets, setTargetsState] = useState<Target[]>([]);
  const [dataError, setDataError] = useState<unknown>(null);
  const [expired, setExpired] = useState(false);
  const [recovery, setRecovery] = useState(recoveryLanding);
  const clearRecovery = useCallback(() => setRecovery(false), []);
  const voluntary = useRef(false);
  const userId = session?.user.id;

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setAuthReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s);
      if (event === 'SIGNED_OUT') {
        setExpired(!voluntary.current);
        voluntary.current = false;
      }
      if (event === 'SIGNED_IN') setExpired(false);
      if (event === 'PASSWORD_RECOVERY') setRecovery(true);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const reload = useCallback(async () => {
    if (!userId) return;
    try {
      setDataError(null);
      const [p, list] = await Promise.all([supabase.rpc('ensure_profile').single(), fetchTargets()]);
      setProfile(unwrap(p) as Profile);
      setTargetsState(list);
    } catch (e) {
      setDataError(e);
    }
  }, [userId]);

  useEffect(() => {
    if (userId) void reload();
    else { setProfile(null); setTargetsState([]); }
  }, [userId, reload]);

  // La langue enregistrée dans le profil s'applique à l'interface sur tous les appareils.
  useEffect(() => {
    if (profile && profile.ui_lang !== lang) setLang(profile.ui_lang);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.ui_lang]);

  const updateProfile = useCallback(async (patch: Partial<Profile>) => {
    if (!userId) return;
    const row = unwrap(await supabase.from('profiles').update(patch).eq('id', userId).select().single()) as Profile;
    setProfile(row);
  }, [userId]);

  const setTargets = useCallback((fn: (list: Target[]) => Target[]) => setTargetsState(fn), []);

  const signOut = useCallback(async () => {
    voluntary.current = true;
    await supabase.auth.signOut();
  }, []);

  const value = useMemo<Ctx>(
    () => ({ session, authReady, profile, targets, dataError, expired, recovery, clearRecovery, reload, updateProfile, setTargets, signOut }),
    [session, authReady, profile, targets, dataError, expired, recovery, clearRecovery, reload, updateProfile, setTargets, signOut],
  );
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): Ctx {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('SessionProvider manquant');
  return ctx;
}

/** Sous les routes protégées : profil chargé. */
export function useApp() {
  const ctx = useSession();
  if (!ctx.profile) throw new Error('Profil non chargé');
  return { ...ctx, profile: ctx.profile };
}
