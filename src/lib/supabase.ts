import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;

/** Faux tant que la base n'est pas branchée (VITE_SUPABASE_URL et VITE_SUPABASE_PUBLISHABLE_KEY) : le site affiche alors une page d'attente. */
export const isConfigured = Boolean(url && key);

/** Schéma Postgres de l'application : Cap Emploi partage un projet Supabase existant, dans son propre schéma. */
export const SCHEMA = (import.meta.env.VITE_SUPABASE_SCHEMA as string | undefined) || 'cap_emploi';

// PKCE : les liens d'e-mail reviennent avec ?code=…, compatible avec un site statique.
// Clé de session propre : un autre site du même projet sur le même domaine (github.io) garde sa propre connexion.
export const supabase = createClient(url || 'https://non-configure.invalid', key || 'non-configure', { db: { schema: SCHEMA }, auth: { flowType: 'pkce', storageKey: 'cap-emploi-auth' } });

export function unwrap<T>(res: { data: T | null; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return res.data as T;
}
