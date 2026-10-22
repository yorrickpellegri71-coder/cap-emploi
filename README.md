# Cap Emploi

Assistant de recherche d’emploi multilingue (français, anglais, allemand) propulsé par l’IA, d’abord pour le Luxembourg.
Référence produit : `PRD_Cap_Emploi_Produit_multilingue.docx` (version 2.0).

Même socle que GeoMarket Live : React 19 + TypeScript + Vite, publié sur GitHub Pages ; Supabase (Auth, PostgreSQL, sécurité par ligne) en région Europe ; Claude appelé depuis une fonction serveur Supabase.

## Fonctions du MVP

- Inscription par e-mail et mot de passe, consentement explicite, mot de passe oublié.
- Profil candidat : import du CV (PDF, Word, texte), extraction par l’IA (expériences, chiffres, compétences, langues), entièrement modifiable.
- Choix du métier (tous métiers, hôtellerie-restauration, événementiel) : secteurs et messages adaptés.
- Cibles et pipeline par étapes : à contacter, contacté, relancé, rendez-vous, offre, pas retenu.
- Relances automatiques après 7 jours (délai réglable), bouton « Relance envoyée ».
- Rythme de la semaine : six compteurs avec objectifs, semaines ISO.
- Messages prêts à copier : premier contact, relance, remerciement, en FR, EN ou DE.
- CV et lettre sur mesure à partir d’une offre, dans la langue choisie, sans invention de faits ; les exigences non couvertes par le profil sont signalées au lieu d’être inventées. Export Word et PDF. 3 documents gratuits par mois.
- RGPD : export de toutes ses données, suppression du compte.

Règles du pipeline (reprises de la V1) : passer « À contacter » → « Contacté » ajoute 1 aux contacts de la semaine et date le contact ; « Relance envoyée » passe la cible en « Relancé », la date du jour et ajoute 1 aux relances.

## Lancer en local

```bash
npm install
cp .env.example .env.local   # renseigner l’URL et la clé publique Supabase
npm run dev                  # http://localhost:3000
npm test                     # dates, règles du pipeline, traductions, rendu de chaque écran dans les 3 langues
npm run build
```

## Traductions

Un fichier par langue : `src/i18n/fr.json`, `en.json`, `de.json`. Un test vérifie que les trois ont les mêmes clés et les mêmes variables. Ajouter une langue : copier `fr.json`, traduire, l’ajouter dans `src/i18n/index.tsx` et dans `LANGS` (`src/lib/types.ts`).

Les modèles de messages et les secteurs par métier sont en base (table `modeles`), générés depuis `scripts/modeles.json` par `npm run seed`.

## Base de données (Supabase)

- `supabase/migrations/0001_schema.sql` : tables `profiles`, `targets`, `weeks`, `documents`, `ai_usage`, `modeles`, règles RLS (chaque utilisateur ne voit que ses lignes), compteur atomique `bump_counter`, suppression de compte `delete_my_account`.
- `supabase/migrations/0002_modeles.sql` : modèles par métier et par langue (généré).

## Fonction IA

`supabase/functions/ai/index.ts` (Edge Function) : vérifie la session, applique le quota (3 documents par mois en gratuit, 20 analyses de CV), appelle Claude avec une sortie JSON contrainte, enregistre le document et la consommation.

Secrets à définir dans Supabase : `ANTHROPIC_API_KEY` ; facultatifs : `CLAUDE_MODEL` (défaut `claude-opus-5-5`), `FREE_DOCS_PER_MONTH`, `ALLOWED_ORIGIN` (URL du site).

## Mise en ligne

1. Projet Supabase en région Europe (Francfort) ; appliquer les deux migrations ; déployer la fonction `ai` ; définir les secrets.
2. Supabase → Authentication → URL Configuration : Site URL et Redirect URLs = adresse GitHub Pages.
3. Dépôt GitHub : variables `VITE_SUPABASE_URL` et `VITE_SUPABASE_PUBLISHABLE_KEY` ; Settings → Pages → Source : GitHub Actions. Chaque push sur `main` teste, construit et publie.

## Hors MVP (feuille de route du PRD)

Plan sur 8 semaines, préparation d’entretien, e-mail du lundi, import d’offres par lien, bilan, offre Premium et paiement, espace conseiller, portugais et luxembourgeois.
