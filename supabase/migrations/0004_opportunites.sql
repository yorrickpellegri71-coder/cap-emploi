-- Cap Emploi — « Opportunités pour moi » : offres et entreprises repérées à partir du profil, file « À valider », résumé quotidien.

-- kind : job (offre collectée) | company (entreprise cible probable).
-- status : new → preparing → to_validate → validated → sent ; ou dismissed.
create table cap_emploi.opportunities (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  kind text not null check (kind in ('job', 'company')),
  title text not null default '',
  company text not null default '',
  location text not null default '',
  sector text not null default '',
  source text not null default '',
  link text not null default '',
  snippet text not null default '',
  score int not null default 0 check (score between 0 and 100),
  reason text not null default '',
  status text not null default 'new' check (status in ('new', 'preparing', 'to_validate', 'validated', 'sent', 'dismissed')),
  target_id uuid references cap_emploi.targets (id) on delete set null,
  document_id uuid references cap_emploi.documents (id) on delete set null,
  -- Clé de dédoublonnage : lien de l'offre, ou nom d'entreprise normalisé.
  dedupe_key text not null,
  found_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, dedupe_key)
);
create index opportunities_user_idx on cap_emploi.opportunities (user_id, status, score desc);

alter table cap_emploi.opportunities enable row level security;
create policy "opportunités : tout sur les siennes" on cap_emploi.opportunities for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create trigger opportunities_touch before update on cap_emploi.opportunities for each row execute function cap_emploi.touch_updated_at();

-- Réglages : préparation automatique au-dessus d'un score, résumé quotidien par e-mail.
alter table cap_emploi.profiles
  add column opp_auto_prepare boolean not null default true,
  add column opp_min_score int not null default 75 check (opp_min_score between 0 and 100),
  add column opp_daily_email boolean not null default false,
  add column opp_last_run timestamptz;
grant update (opp_auto_prepare, opp_min_score, opp_daily_email) on cap_emploi.profiles to authenticated;

-- Résumés quotidiens (écrits par la fonction serveur).
create table cap_emploi.digests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  day date not null,
  new_jobs int not null default 0,
  new_companies int not null default 0,
  prepared int not null default 0,
  top jsonb not null default '[]',
  emailed boolean not null default false,
  created_at timestamptz not null default now(),
  unique (user_id, day)
);
alter table cap_emploi.digests enable row level security;
create policy "résumés : lecture" on cap_emploi.digests for select to authenticated using (user_id = (select auth.uid()));

alter table cap_emploi.ai_usage add column discoveries int not null default 0;
