// storage.js — единый интерфейс хранилища поверх Telegram CloudStorage
// с фоллбэком на localStorage (для обычного браузера / разработки).
//
// CloudStorage хранит строки. Мы сериализуем значения в JSON.
// Лимиты Telegram: до 1024 ключей, значение ≤ 4096 байт, ключ ≤ 128 символов.

const tg = window.Telegram?.WebApp;
const cloud = tg?.CloudStorage;
// telegram-web-app.js грузится и в обычном браузере, создавая заглушку WebApp,
// где методы CloudStorage есть, но при вызове бросают WebAppMethodUnsupported.
// Поэтому проверяем не только наличие метода, но и реальный запуск в Telegram
// (есть initData) и версию Bot API ≥ 6.9 (когда появился CloudStorage).
const useCloud = !!(
  cloud &&
  typeof cloud.getKeys === 'function' &&
  tg.initData &&
  tg.isVersionAtLeast?.('6.9')
);

const LS_PREFIX = 'kkal:';

// ── localStorage-реализация (фоллбэк) ───────────────────────
const lsBackend = {
  getKeys() {
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(LS_PREFIX)) keys.push(k.slice(LS_PREFIX.length));
    }
    return Promise.resolve(keys);
  },
  getItems(keys) {
    const out = {};
    for (const k of keys) out[k] = localStorage.getItem(LS_PREFIX + k) ?? '';
    return Promise.resolve(out);
  },
  setItem(key, value) {
    localStorage.setItem(LS_PREFIX + key, value);
    return Promise.resolve();
  },
  removeItem(key) {
    localStorage.removeItem(LS_PREFIX + key);
    return Promise.resolve();
  },
};

// ── CloudStorage-реализация (промисификация коллбэков) ──────
const cloudBackend = {
  getKeys() {
    return new Promise((resolve, reject) => {
      cloud.getKeys((err, keys) => (err ? reject(err) : resolve(keys || [])));
    });
  },
  getItems(keys) {
    if (!keys.length) return Promise.resolve({});
    return new Promise((resolve, reject) => {
      cloud.getItems(keys, (err, values) => (err ? reject(err) : resolve(values || {})));
    });
  },
  setItem(key, value) {
    return new Promise((resolve, reject) => {
      cloud.setItem(key, value, (err) => (err ? reject(err) : resolve()));
    });
  },
  removeItem(key) {
    return new Promise((resolve, reject) => {
      cloud.removeItem(key, (err) => (err ? reject(err) : resolve()));
    });
  },
};

const backend = useCloud ? cloudBackend : lsBackend;

export const isCloud = useCloud;

// Загрузить всё содержимое хранилища как { ключ: распарсенное_значение }.
// Битые/пустые значения пропускаем.
export async function loadAll() {
  const keys = await backend.getKeys();
  if (!keys.length) return {};
  const raw = await backend.getItems(keys);
  const out = {};
  for (const k of keys) {
    const v = raw[k];
    if (v == null || v === '') continue;
    try {
      out[k] = JSON.parse(v);
    } catch {
      /* пропускаем нечитаемое значение */
    }
  }
  return out;
}

export function setItem(key, value) {
  return backend.setItem(key, JSON.stringify(value));
}

export function removeItem(key) {
  return backend.removeItem(key);
}
