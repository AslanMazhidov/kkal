// storage.js — единый интерфейс хранилища. Приоритет бэкендов:
//   1) Supabase   — если задан config.js и есть Telegram initData (боевой режим)
//   2) CloudStorage — если открыто в Telegram (запасной, пока Supabase не настроен)
//   3) localStorage — обычный браузер / разработка
//
// Каждый бэкенд реализует loadAll() → { ключ: значение }, setItem(key, value),
// removeItem(key). Ключи: 'settings', 'food:<id>', 'recipe:<id>', 'day:<дата>'.

import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

const tg = window.Telegram?.WebApp;
const initData = tg?.initData || '';

// ── localStorage ────────────────────────────────────────────
const LS_PREFIX = 'kkal:';
const lsBackend = {
  name: 'local',
  async loadAll() {
    const out = {};
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith(LS_PREFIX)) continue;
      try { out[k.slice(LS_PREFIX.length)] = JSON.parse(localStorage.getItem(k)); } catch { /* skip */ }
    }
    return out;
  },
  async setItem(key, value) { localStorage.setItem(LS_PREFIX + key, JSON.stringify(value)); },
  async removeItem(key) { localStorage.removeItem(LS_PREFIX + key); },
};

// ── Telegram CloudStorage ───────────────────────────────────
const cloud = tg?.CloudStorage;
const cloudUsable = !!(cloud && typeof cloud.getKeys === 'function' && initData && tg.isVersionAtLeast?.('6.9'));
const cloudBackend = {
  name: 'cloud',
  loadAll() {
    return new Promise((resolve, reject) => {
      cloud.getKeys((err, keys) => {
        if (err) return reject(err);
        if (!keys || !keys.length) return resolve({});
        cloud.getItems(keys, (err2, values) => {
          if (err2) return reject(err2);
          const out = {};
          for (const k of keys) {
            const v = values?.[k];
            if (v == null || v === '') continue;
            try { out[k] = JSON.parse(v); } catch { /* skip */ }
          }
          resolve(out);
        });
      });
    });
  },
  setItem(key, value) {
    return new Promise((resolve, reject) => {
      cloud.setItem(key, JSON.stringify(value), (err) => (err ? reject(err) : resolve()));
    });
  },
  removeItem(key) {
    return new Promise((resolve, reject) => {
      cloud.removeItem(key, (err) => (err ? reject(err) : resolve()));
    });
  },
};

// ── Supabase (через Edge Function "kkal") ───────────────────
const supaUsable = /^https:\/\/.+\.supabase\.co\/?$/.test(SUPABASE_URL || '')
  && !!SUPABASE_ANON_KEY && SUPABASE_ANON_KEY !== 'YOUR_SUPABASE_ANON_KEY'
  && !!initData;

const FUNCTION_URL = `${(SUPABASE_URL || '').replace(/\/$/, '')}/functions/v1/kkal`;

async function supaCall(payload) {
  const res = await fetch(FUNCTION_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      // anon-ключ нужен шлюзу Supabase; настоящая авторизация — по initData внутри функции
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    },
    body: JSON.stringify({ ...payload, initData }),
  });
  if (!res.ok) throw new Error('supabase ' + res.status + ' ' + (await res.text().catch(() => '')));
  return res.json();
}

const supabaseBackend = {
  name: 'supabase',
  loadAll() { return supaCall({ action: 'loadAll' }); },
  setItem(key, value) { return supaCall({ action: 'set', key, value }); },
  removeItem(key) { return supaCall({ action: 'remove', key }); },
};

// ── выбор бэкенда ───────────────────────────────────────────
const backend = supaUsable ? supabaseBackend : cloudUsable ? cloudBackend : lsBackend;

export const backendName = backend.name; // 'supabase' | 'cloud' | 'local'

export function loadAll() { return backend.loadAll(); }
export function setItem(key, value) { return backend.setItem(key, value); }
export function removeItem(key) { return backend.removeItem(key); }
