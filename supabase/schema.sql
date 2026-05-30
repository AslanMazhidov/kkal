-- Схема БД для КБЖУ. Выполнить один раз в Supabase → SQL Editor.
--
-- Доступ к данным — только через Edge Function (service_role, обходит RLS).
-- RLS включён без публичных политик: с публичным anon-ключом таблицы НЕдоступны,
-- поэтому даже зная ключ из открытого кода, чужой не прочитает твои данные.

create table if not exists public.settings (
  user_id    bigint primary key,
  goal       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.foods (
  id      text primary key,            -- id, сгенерированный приложением
  user_id bigint not null,
  name    text   not null,
  kcal    numeric not null default 0,  -- на 100 г
  p       numeric not null default 0,
  f       numeric not null default 0,
  c       numeric not null default 0
);
create index if not exists foods_user_idx on public.foods(user_id);

create table if not exists public.recipes (
  id          text primary key,
  user_id     bigint  not null,
  name        text    not null,
  ingredients jsonb   not null default '[]'::jsonb,  -- [{foodId, grams}]
  total_grams numeric not null default 0,
  per100      jsonb   not null default '{}'::jsonb    -- {kcal,p,f,c}
);
create index if not exists recipes_user_idx on public.recipes(user_id);

create table if not exists public.days (
  user_id bigint not null,
  date    date   not null,
  entries jsonb  not null default '[]'::jsonb,  -- [{id, refType, refId, grams} | {id, refType:'quick', name, kcal,p,f,c}]
  primary key (user_id, date)
);

-- Включаем RLS и НЕ создаём публичных политик → anon-ключ к таблицам не имеет доступа.
alter table public.settings enable row level security;
alter table public.foods    enable row level security;
alter table public.recipes  enable row level security;
alter table public.days     enable row level security;
