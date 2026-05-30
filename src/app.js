// app.js — точка входа: инициализация Telegram, темизация, загрузка данных, рендер.

import { hydrate } from './state.js';
import { initUI } from './ui.js';

const tg = window.Telegram?.WebApp;

// Применить цвета Telegram-темы к CSS-переменным (если открыто внутри Telegram).
function applyTheme() {
  const p = tg?.themeParams;
  if (!p) return;
  const root = document.documentElement.style;
  const map = {
    '--bg': p.secondary_bg_color || p.bg_color,
    '--surface': p.bg_color,
    '--surface-2': p.secondary_bg_color || p.bg_color,
    '--text': p.text_color,
    '--hint': p.hint_color,
    '--accent': p.button_color,
    '--accent-text': p.button_text_color,
    '--destructive': p.destructive_text_color,
  };
  for (const [k, v] of Object.entries(map)) if (v) root.setProperty(k, v);
}

async function main() {
  if (tg) {
    tg.ready();
    tg.expand();
    applyTheme();
    tg.onEvent?.('themeChanged', applyTheme);
  }

  // Сбой хранилища не должен блокировать запуск интерфейса.
  try {
    await hydrate();
  } catch (e) {
    console.warn('Не удалось загрузить данные:', e);
  }
  initUI();
}

main();
