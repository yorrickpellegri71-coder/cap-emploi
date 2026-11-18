-- Interface en luxembourgeois (lb) et en portugais (pt), en plus du français, de l'anglais et de l'allemand.
-- Les documents (doc_lang) restent en fr, en ou de.
alter table cap_emploi.profiles drop constraint if exists profiles_ui_lang_check;
alter table cap_emploi.profiles add constraint profiles_ui_lang_check check (ui_lang in ('fr', 'en', 'de', 'lb', 'pt'));

-- Profil créé à l'inscription : l'interface garde la langue choisie, les documents prennent la langue la plus proche
-- (allemand pour le luxembourgeois, français pour le portugais).
create or replace function cap_emploi.ensure_profile() returns cap_emploi.profiles
language plpgsql security definer set search_path = '' as $$
declare
  meta jsonb;
  lang text;
  doc text;
  row cap_emploi.profiles;
begin
  if auth.uid() is null then raise exception 'Non connecté'; end if;
  select * into row from cap_emploi.profiles where id = auth.uid();
  if found then return row; end if;
  select coalesce(raw_user_meta_data, '{}') into meta from auth.users where id = auth.uid();
  lang := coalesce(meta ->> 'ui_lang', 'fr');
  if lang not in ('fr', 'en', 'de', 'lb', 'pt') then lang := 'fr'; end if;
  doc := case lang when 'lb' then 'de' when 'pt' then 'fr' else lang end;
  insert into cap_emploi.profiles (id, display_name, ui_lang, doc_lang, consent_at)
  values (auth.uid(), coalesce(meta ->> 'display_name', ''), lang, doc, case when (meta ->> 'consent') = 'true' then now() end)
  on conflict (id) do nothing;
  select * into row from cap_emploi.profiles where id = auth.uid();
  return row;
end $$;
