# Cap Emploi

Assistant de recherche d’emploi multilingue (français, anglais, allemand) propulsé par l’IA, d’abord pour le Luxembourg.
Référence produit : `PRD_Cap_Emploi_Produit_multilingue.docx` (version 2.0).

Même socle que GeoMarket Live : React 19 + TypeScript + Vite, publié sur GitHub Pages ; Supabase (Auth, PostgreSQL, sécurité par ligne) en région Europe ; Claude appelé depuis une fonction serveur Supabase.

## Fonctions

- Inscription par e-mail et mot de passe, consentement explicite, mot de passe oublié.
- Profil candidat : import du CV (PDF, Word, texte), extraction par l’IA, entièrement modifiable. Choix du métier (tous métiers, hôtellerie-restauration, événementiel).
- Cibles et pipeline par étapes, relances automatiques après 7 jours (délai réglable), rythme de la semaine avec objectifs, messages prêts à copier en FR, EN ou DE.
- **Offres reçues** : offres arrivées par les alertes e-mail des sites d’emploi (Gmail ou Outlook, en option), par la recherche quotidienne ou ajoutées à la main. Alerte et compteur des nouvelles offres. Avant de postuler : lecture de l’offre, analyse détaillée par l’IA (poste, entreprise, lieu, contrat, salaire, langues, missions, exigences, points forts, manques, score, recommandation), puis une liste de vérification imposée par la base : « offre lue » et « conditions acceptées » avant la préparation des documents, « documents relus » avant l’envoi.
- **Opportunités pour moi** : offres collectées et entreprises probables, notées avec la raison, par secteur ; préparation automatique des dossiers dans une file « À valider » ; résumé quotidien.
- **Postuler en direct** : liens de recherche vers 12 sources du Luxembourg, collecte par l’API officielle de Jooble, fiche entreprise et cible créée automatiquement, dossier complet en un clic (e-mail, lettre, CV adapté, présentation), export Word et PDF, bouton « J’ai envoyé ».
- **Historique** : « Mes candidatures » et « Réponses reçues », avec filtres, tri par colonne et export Excel. Une réponse met à jour la candidature et l’étape de la cible.
- Aucun envoi automatique : l’utilisateur envoie toujours lui-même, après validation.
- IA sans invention de faits : les exigences non couvertes par le profil sont signalées, jamais inventées.
- RGPD : export de toutes ses données, suppression du compte.

## Lancer en local

```bash
npm install
cp .env.example .env.local   # URL et clé publique Supabase, schéma (cap_emploi par défaut)
npm run dev                  # http://localhost:3000
npm test                     # dates, règles du pipeline, traductions, alertes e-mail, rendu de chaque écran dans les 3 langues
npm run build
```

## Traductions

Un fichier par langue : `src/i18n/fr.json`, `en.json`, `de.json`. Un test vérifie que les trois ont les mêmes clés et les mêmes variables, et que chaque clé utilisée dans le code existe.

Les modèles de messages et les secteurs par métier sont en base (table `modeles`), générés depuis `scripts/modeles.json` par `npm run seed`.

## Base de données : un schéma à part dans un projet existant

Cap Emploi est conçu pour être hébergé dans un projet Supabase déjà utilisé par une autre application, sans toucher à ses tables :

- Tout vit dans le schéma Postgres `cap_emploi` (tables, fonctions, règles RLS : chaque utilisateur ne voit que ses lignes).
- Aucun déclencheur n’est posé sur `auth.users` : le profil est créé à la première connexion par `cap_emploi.ensure_profile()`.
- Les inscriptions Cap Emploi portent la métadonnée `app = cap_emploi`. La suppression de compte efface les données Cap Emploi et ne supprime le compte de connexion que s’il a été créé par Cap Emploi.
- La session est stockée sous une clé propre (`cap-emploi-auth`), pour ne pas se mélanger avec une autre application du même projet sur le même domaine.

Migrations, à appliquer dans l’ordre : `0001_schema.sql` (schéma, profils, cibles, semaines, documents, consommation, modèles), `0002_modeles.sql` (généré), `0003_postuler.sql`, `0004_opportunites.sql`, `0005_historique.sql`, `0006_offres_recues.sql`.

Points à régler côté projet hôte, car ils sont communs à tout le projet :

- Settings → API → Exposed schemas : ajouter `cap_emploi`.
- Authentication → URL Configuration → Redirect URLs : ajouter l’adresse du site Cap Emploi.
- Comptes communs : un inscrit Cap Emploi est aussi un utilisateur connecté du projet hôte. Vérifier que les règles RLS de l’hôte ne donnent pas accès à ses données à tout utilisateur connecté, et que ses déclencheurs sur `auth.users` laissent passer les inscriptions Cap Emploi.
- Envoi des e-mails d’authentification : commun au projet, limité sur le plan gratuit sans SMTP personnalisé.

## Fonction IA

`supabase/functions/cap-emploi-ai/index.ts` (Edge Function) : vérifie la session, applique les quotas, appelle Claude avec une sortie JSON contrainte. Actions : analyse de CV, dossier sur mesure, fiche entreprise, recherche d’offres (Jooble), opportunités, préparation, analyse d’offre reçue, lecture d’alertes e-mail, tâche quotidienne.

Les secrets d’une fonction sont communs à tout le projet : ceux de Cap Emploi sont préfixés `CAP_`.

- Obligatoire : `CAP_ANTHROPIC_API_KEY`.
- Facultatifs : `CAP_CLAUDE_MODEL` (défaut `claude-opus-5-5`), `CAP_FREE_DOCS_PER_MONTH` (défaut 3), `CAP_ALLOWED_ORIGIN` (adresse du site), `CAP_SCHEMA` (défaut `cap_emploi`), `CAP_JOOBLE_API_KEY` et `CAP_JOOBLE_HOST` (collecte d’offres), `CAP_CRON_SECRET` (tâche quotidienne, voir `supabase/cron/daily.sql`), `CAP_RESEND_API_KEY`, `CAP_DIGEST_FROM`, `CAP_APP_URL` (e-mail du résumé quotidien).

## Alertes e-mail (option)

Le relevé se fait dans le navigateur, en lecture seule, le temps du relevé ; le jeton n’est ni stocké ni envoyé au serveur. Seules les alertes des sites d’emploi des 14 derniers jours sont lues, puis transmises à la fonction serveur qui en extrait les offres.

- Gmail : identifiant client OAuth Google (type « Application Web », origine = adresse du site), portée `gmail.readonly`. Variable `VITE_GOOGLE_CLIENT_ID`. Tant que l’application Google reste en mode test, seuls les comptes ajoutés comme testeurs (100 au plus) peuvent se connecter ; une ouverture au public demande la validation de Google, avec un audit de sécurité pour cette portée.
- Outlook : application Microsoft Entra (type « Application monopage », URI de redirection = `<adresse du site>/oauth-callback.html`, comptes personnels et professionnels), permission `Mail.Read`. Variable `VITE_MS_CLIENT_ID`.

Sans ces variables, les boutons de relevé restent désactivés ; l’ajout manuel et la recherche quotidienne fonctionnent.

## Mise en ligne

1. Projet Supabase : appliquer les migrations, exposer le schéma `cap_emploi`, déployer la fonction `cap-emploi-ai` (avec `verify_jwt = false`, voir `supabase/config.toml`), définir les secrets `CAP_…`, ajouter l’adresse du site aux Redirect URLs.
2. Dépôt GitHub : variables `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, et en option `VITE_SUPABASE_SCHEMA`, `VITE_GOOGLE_CLIENT_ID`, `VITE_MS_CLIENT_ID` ; Settings → Pages → Source : GitHub Actions. Chaque push sur `main` teste, construit et publie.

## Hors MVP (feuille de route du PRD)

Plan sur 8 semaines, préparation d’entretien, e-mail du lundi, bilan, offre Premium et paiement, espace conseiller, portugais et luxembourgeois.
