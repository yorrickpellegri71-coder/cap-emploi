-- Cap Emploi — « Offres reçues » : offres arrivées par alerte e-mail (Gmail ou Outlook, en option),
-- collectées par la recherche quotidienne ou ajoutées à la main ; lecture, analyse IA et liste de vérification.

-- status : new → analyzed → preparing → ready → sent ; ou dismissed.
-- checks : horodatage de chaque case cochée : offer_read, conditions_ok (avant la préparation), docs_reviewed (avant l'envoi).
create table cap_emploi.received_offers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  origin text not null check (origin in ('gmail', 'outlook', 'collected', 'manual')),
  source text not null default '',
  title text not null default '',
  company text not null default '',
  location text not null default '',
  link text not null default '',
  offer_text text not null default '' check (length(offer_text) <= 30000),
  received_at timestamptz not null default now(),
  seen_at timestamptz,
  status text not null default 'new' check (status in ('new', 'analyzed', 'preparing', 'ready', 'sent', 'dismissed')),
  analysis jsonb not null default '{}',
  checks jsonb not null default '{}',
  target_id uuid references cap_emploi.targets (id) on delete set null,
  document_id uuid references cap_emploi.documents (id) on delete set null,
  application_id uuid references cap_emploi.applications (id) on delete set null,
  dedupe_key text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, dedupe_key),
  -- La liste de vérification est imposée par la base, pas seulement par l'interface.
  constraint checks_before_prepare check (status not in ('preparing', 'ready', 'sent') or (checks ? 'offer_read' and checks ? 'conditions_ok')),
  constraint checks_before_send check (status <> 'sent' or checks ? 'docs_reviewed')
);
create index received_offers_user_idx on cap_emploi.received_offers (user_id, status, received_at desc);
alter table cap_emploi.received_offers enable row level security;
create policy "offres reçues : tout sur les siennes" on cap_emploi.received_offers for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create trigger received_offers_touch before update on cap_emploi.received_offers for each row execute function cap_emploi.touch_updated_at();

alter table cap_emploi.ai_usage
  add column analyses int not null default 0,
  add column alert_imports int not null default 0;
