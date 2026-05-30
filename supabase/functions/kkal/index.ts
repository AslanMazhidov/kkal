// Edge Function "kkal" — единственный шлюз к данным.
//
// 1) Проверяет подпись Telegram initData токеном бота (секрет BOT_TOKEN) —
//    так мы достоверно узнаём user_id и отсекаем чужих.
// 2) Делает CRUD в Postgres под service_role (обходит RLS), жёстко привязывая
//    все строки к проверенному user_id.
//
// Секреты задаются в Supabase (Settings → Edge Functions → Secrets):
//   BOT_TOKEN = <токен из BotFather>
// SUPABASE_URL и SUPABASE_SERVICE_ROLE_KEY подставляются платформой автоматически.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const BOT_TOKEN = Deno.env.get("BOT_TOKEN") ?? "";
const db = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { ...cors, "Content-Type": "application/json" } });

// ── проверка подписи Telegram WebApp initData ───────────────
async function hmac(keyBytes: Uint8Array, msg: Uint8Array): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, msg));
}
const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, "0")).join("");

async function verify(initData: string): Promise<number | null> {
  if (!initData || !BOT_TOKEN) return null;
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) return null;
  params.delete("hash");
  const dcs = [...params.entries()].map(([k, v]) => `${k}=${v}`).sort().join("\n");
  const enc = new TextEncoder();
  // secret_key = HMAC_SHA256(key="WebAppData", msg=bot_token)
  const secret = await hmac(enc.encode("WebAppData"), enc.encode(BOT_TOKEN));
  // hash = HMAC_SHA256(key=secret_key, msg=data_check_string)
  const calc = hex(await hmac(secret, enc.encode(dcs)));
  if (calc !== hash) return null;
  // не принимаем слишком старые initData (24 ч)
  const authDate = Number(params.get("auth_date") || 0);
  if (authDate && Date.now() / 1000 - authDate > 86400) return null;
  try {
    const user = JSON.parse(params.get("user") || "{}");
    return typeof user.id === "number" ? user.id : null;
  } catch {
    return null;
  }
}

// ── маршрутизация ключей на таблицы (тот же формат, что в storage.js) ─
async function setKey(userId: number, key: string, value: any) {
  if (key === "settings") {
    await db.from("settings").upsert({ user_id: userId, goal: value?.goal ?? {}, updated_at: new Date().toISOString() });
  } else if (key.startsWith("food:")) {
    const p = value?.per100 ?? {};
    await db.from("foods").upsert({ id: value.id, user_id: userId, name: value.name, kcal: p.kcal ?? 0, p: p.p ?? 0, f: p.f ?? 0, c: p.c ?? 0 });
  } else if (key.startsWith("recipe:")) {
    await db.from("recipes").upsert({ id: value.id, user_id: userId, name: value.name, ingredients: value.ingredients ?? [], total_grams: value.totalGrams ?? 0, per100: value.per100 ?? {} });
  } else if (key.startsWith("day:")) {
    await db.from("days").upsert({ user_id: userId, date: key.slice(4), entries: value?.entries ?? [] }, { onConflict: "user_id,date" });
  }
}

async function removeKey(userId: number, key: string) {
  if (key.startsWith("food:")) await db.from("foods").delete().eq("user_id", userId).eq("id", key.slice(5));
  else if (key.startsWith("recipe:")) await db.from("recipes").delete().eq("user_id", userId).eq("id", key.slice(7));
  else if (key.startsWith("day:")) await db.from("days").delete().eq("user_id", userId).eq("date", key.slice(4));
  else if (key === "settings") await db.from("settings").delete().eq("user_id", userId);
}

// Возвращает всё в том же keyed-формате, что ждёт state.hydrate().
async function loadAll(userId: number) {
  const out: Record<string, unknown> = {};
  const [s, f, r, d] = await Promise.all([
    db.from("settings").select("goal").eq("user_id", userId).maybeSingle(),
    db.from("foods").select("*").eq("user_id", userId),
    db.from("recipes").select("*").eq("user_id", userId),
    db.from("days").select("*").eq("user_id", userId),
  ]);
  if (s.data) out["settings"] = { goal: s.data.goal };
  for (const x of f.data ?? []) out[`food:${x.id}`] = { id: x.id, name: x.name, per100: { kcal: Number(x.kcal), p: Number(x.p), f: Number(x.f), c: Number(x.c) } };
  for (const x of r.data ?? []) out[`recipe:${x.id}`] = { id: x.id, name: x.name, ingredients: x.ingredients, totalGrams: Number(x.total_grams), per100: x.per100 };
  for (const x of d.data ?? []) out[`day:${x.date}`] = { entries: x.entries };
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "bad json" }, 400); }

  const userId = await verify(body.initData ?? "");
  if (!userId) return json({ error: "unauthorized" }, 401);

  try {
    if (body.action === "loadAll") return json(await loadAll(userId));
    if (body.action === "set") { await setKey(userId, body.key, body.value); return json({ ok: true }); }
    if (body.action === "remove") { await removeKey(userId, body.key); return json({ ok: true }); }
    return json({ error: "bad action" }, 400);
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
