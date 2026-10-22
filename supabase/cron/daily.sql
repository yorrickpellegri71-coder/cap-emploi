-- Résumé quotidien des opportunités : à exécuter une fois dans l'éditeur SQL, après le déploiement de la fonction cap-emploi-ai.
-- Remplacer <PROJECT_REF> et <CRON_SECRET> (même valeur que le secret CAP_CRON_SECRET de la fonction cap-emploi-ai).
-- La fonction traite quelques utilisateurs par appel : elle est appelée toutes les 10 minutes de 5 h à 7 h (UTC).
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'cap-emploi-daily',
  '*/10 5-6 * * *',
  $$
  select net.http_post(
    url := 'https://<PROJECT_REF>.supabase.co/functions/v1/cap-emploi-ai',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', '<CRON_SECRET>'),
    body := '{"action":"daily"}'::jsonb,
    timeout_milliseconds := 150000
  );
  $$
);
