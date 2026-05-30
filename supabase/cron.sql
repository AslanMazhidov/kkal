-- Расписание напоминаний (pg_cron + pg_net). МСК = UTC+3 (без перехода на лето).
-- <CRON_SECRET> подставляется при применении (тот же, что в секретах функции remind).

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- 14:00 МСК = 11:00 UTC
select cron.schedule('kkal-remind-1400', '0 11 * * *', $$
  select net.http_post(
    url := 'https://tezqdhxeixfwfshppbys.supabase.co/functions/v1/remind',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', '<CRON_SECRET>'),
    body := '{}'::jsonb
  );
$$);

-- 20:00 МСК = 17:00 UTC
select cron.schedule('kkal-remind-2000', '0 17 * * *', $$
  select net.http_post(
    url := 'https://tezqdhxeixfwfshppbys.supabase.co/functions/v1/remind',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', '<CRON_SECRET>'),
    body := '{}'::jsonb
  );
$$);
