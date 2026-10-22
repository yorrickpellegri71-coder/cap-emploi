-- Cap Emploi — « Postuler en direct » : fiche entreprise sur la cible, dossier complet en quatre pièces.

-- Fiche entreprise produite par l'IA (résumé, attentes probables, idée d'outil digital, points à vérifier).
alter table public.targets add column brief jsonb not null default '{}';

-- Dossier : e-mail d'accompagnement et courte présentation globale, en plus du CV et de la lettre.
alter table public.documents
  add column email_subject text not null default '',
  add column email_body text not null default '',
  add column pitch text not null default '';

-- Consommation : fiches entreprise et recherches d'offres.
alter table public.ai_usage
  add column briefs int not null default 0,
  add column searches int not null default 0;
