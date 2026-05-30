# Подключение базы данных Supabase

Безопасная схема: приложение шлёт Telegram `initData` в Edge Function, та проверяет
подпись токеном бота (секрет, не в коде) и пишет данные в Postgres под service_role.
Публичный anon-ключ в коде — это нормально, к таблицам он доступа не даёт (RLS).

```
Браузер ──initData──► Edge Function "kkal" ──► Postgres (RLS, доступ только функции)
        anon-ключ      проверяет подпись BOT_TOKEN
```

> ⚠️ Бот, чей токен ты впишешь в `BOT_TOKEN`, должен быть **тем же**, через которого
> открывается Mini App (кнопка меню в BotFather). initData подписывается его токеном.

## Шаги (всё через веб-дашборд, без терминала)

### 1. Создать проект
1. https://supabase.com → войти → **New project**.
2. Имя любое, регион поближе (напр. *Frankfurt*), задай и сохрани пароль БД.
3. Подожди ~2 минуты, пока проект поднимется.

### 2. Создать таблицы
1. Дашборд → **SQL Editor** → **New query**.
2. Вставь целиком содержимое [`supabase/schema.sql`](supabase/schema.sql) → **Run**.
   Должно выполниться без ошибок.

### 3. Развернуть функцию
1. Дашборд → **Edge Functions** → **Create a new function** (или *Deploy via editor*).
2. Имя функции — ровно `kkal`.
3. Вставь целиком содержимое [`supabase/functions/kkal/index.ts`](supabase/functions/kkal/index.ts) → **Deploy**.

### 4. Вписать секрет с токеном бота
1. Дашборд → **Project Settings → Edge Functions → Secrets** (или у самой функции → *Secrets*).
2. Добавь секрет:
   - **Name:** `BOT_TOKEN`
   - **Value:** токен бота из @BotFather (тот самый «API ключ»)
3. Сохрани. (`SUPABASE_URL` и `SUPABASE_SERVICE_ROLE_KEY` платформа подставит сама.)

### 5. Дать мне два публичных значения
Дашборд → **Project Settings → API**:
- **Project URL** (вид `https://xxxxxxxx.supabase.co`)
- **anon public** ключ (длинная строка)

Пришли их мне — я впишу в [`src/config.js`](src/config.js), запушу, и приложение
переключится на Supabase. После этого на экране **Цель** внизу будет написано
«Данные хранятся в базе Supabase».

## Проверка, что заработало
- Открой Mini App в Telegram → добавь продукт.
- В дашборде **Table Editor → foods** появится строка с твоим `user_id`.
- Открой на другом устройстве — данные на месте.

## Если что-то не так
- **401 unauthorized** в сети — не задан/неверный `BOT_TOKEN`, или бот не тот, что в меню.
- Пусто после добавления — проверь, что SQL из шага 2 выполнен и функция называется `kkal`.
