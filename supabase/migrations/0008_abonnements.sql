-- Cap Emploi — abonnements payants (Stripe).
-- Formules : gratuit (3 dossiers IA par mois), Premium mensuel (illimité), Pass 3 mois (illimité, paiement unique).
-- Les droits ne sont écrits que par la fonction serveur cap-emploi-billing (clé de service), après vérification
-- de la signature Stripe. L'utilisateur peut les lire, jamais les modifier (mise à jour limitée par colonnes, voir 0001).
-- plan = 'premium' reste possible pour un accès offert à la main.

alter table cap_emploi.profiles
  add column if not exists premium_until timestamptz,          -- fin de la période payée de l'abonnement mensuel
  add column if not exists pass_until timestamptz,             -- fin du Pass 3 mois
  add column if not exists stripe_customer_id text unique,
  add column if not exists stripe_subscription_id text,
  add column if not exists subscription_status text;           -- statut Stripe : active, past_due, canceled…

-- Premium si accès offert, abonnement en cours ou pass encore valable.
create or replace function cap_emploi.is_premium(p cap_emploi.profiles) returns boolean
language sql stable set search_path = '' as $$
  select p.plan = 'premium' or coalesce(p.premium_until > now(), false) or coalesce(p.pass_until > now(), false)
$$;
grant execute on function cap_emploi.is_premium(cap_emploi.profiles) to authenticated, service_role;

-- Journal des événements Stripe déjà traités : un même événement renvoyé n'est appliqué qu'une fois.
create table if not exists cap_emploi.stripe_events (
  id text primary key,
  type text not null,
  user_id uuid,
  received_at timestamptz not null default now()
);
alter table cap_emploi.stripe_events enable row level security;
revoke all on cap_emploi.stripe_events from anon, authenticated;

-- Ajoute un Pass (3 mois) à partir de la fin du pass en cours, ou d'aujourd'hui. Idempotent par événement Stripe.
create or replace function cap_emploi.billing_grant_pass(uid uuid, customer text, event_id text, months int default 3)
returns void language plpgsql security definer set search_path = '' as $$
begin
  insert into cap_emploi.stripe_events (id, type, user_id) values (event_id, 'pass', uid) on conflict (id) do nothing;
  if not found then return; end if;
  update cap_emploi.profiles
     set pass_until = greatest(coalesce(pass_until, now()), now()) + make_interval(months => months),
         stripe_customer_id = coalesce(customer, stripe_customer_id)
   where id = uid;
end $$;

-- Recopie l'état de l'abonnement Stripe (créé, renouvelé, impayé, résilié).
create or replace function cap_emploi.billing_set_subscription(uid uuid, customer text, sub_id text, status text, period_end timestamptz)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update cap_emploi.profiles
     set stripe_customer_id = coalesce(customer, stripe_customer_id),
         stripe_subscription_id = sub_id,
         subscription_status = status,
         premium_until = case when status in ('active', 'trialing', 'past_due') then period_end
                              else least(coalesce(period_end, now()), now()) end
   where id = uid;
end $$;

revoke execute on function cap_emploi.billing_grant_pass(uuid, text, text, int) from public, anon, authenticated;
revoke execute on function cap_emploi.billing_set_subscription(uuid, text, text, text, timestamptz) from public, anon, authenticated;
grant execute on function cap_emploi.billing_grant_pass(uuid, text, text, int) to service_role;
grant execute on function cap_emploi.billing_set_subscription(uuid, text, text, text, timestamptz) to service_role;
