// Публичные настройки Supabase.
// anon-ключ и URL БЕЗОПАСНО держать в коде — они и так уходят в браузер,
// а данные защищены проверкой Telegram-подписи в Edge Function + RLS.
//
// Заполни после создания проекта (см. SUPABASE.md). Пока стоят заглушки —
// приложение работает на CloudStorage/localStorage.
export const SUPABASE_URL = 'YOUR_SUPABASE_URL';            // напр. https://abcdxyz.supabase.co
export const SUPABASE_ANON_KEY = 'YOUR_SUPABASE_ANON_KEY';  // Project Settings → API → anon public
