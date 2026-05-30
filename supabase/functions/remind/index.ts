// Edge Function "remind" — рассылает напоминание «Запиши КБЖУ» подписчикам.
// Вызывается по расписанию (pg_cron → pg_net). Защищена секретом CRON_SECRET,
// поэтому развёртывается с --no-verify-jwt (свой шлагбаум вместо JWT).
//
// Секреты в Supabase (Settings → Edge Functions → Secrets):
//   BOT_TOKEN   = токен бота
//   CRON_SECRET = произвольная длинная строка (та же, что в cron-задании)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const BOT_TOKEN = Deno.env.get("BOT_TOKEN") ?? "";
const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";
const db = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const TEXT = "Запиши КБЖУ";

Deno.serve(async (req) => {
  // только по секрету (cron). Иначе — мимо.
  if (!CRON_SECRET || req.headers.get("x-cron-secret") !== CRON_SECRET) {
    return new Response("forbidden", { status: 403 });
  }

  const { data, error } = await db.from("reminders").select("chat_id").eq("enabled", true);
  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });

  let sent = 0, failed = 0;
  for (const r of data ?? []) {
    try {
      const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: r.chat_id, text: TEXT }),
      });
      res.ok ? sent++ : failed++;
    } catch {
      failed++;
    }
  }
  return new Response(JSON.stringify({ sent, failed }), {
    headers: { "Content-Type": "application/json" },
  });
});
