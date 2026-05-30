// state.js — in-memory store: грузим всё из хранилища один раз, читаем из памяти
// (мгновенно), пишем в память + дебаунс-сохранение в CloudStorage/localStorage.

import { loadAll, setItem, removeItem } from './storage.js';
import { recipeTotals } from './nutrition.js';

const DEFAULT_GOAL = { kcal: 2000, protein: 120, fat: 65, carbs: 220 };

export const store = {
  foods: new Map(),   // id -> { id, name, per100:{kcal,p,f,c} }
  recipes: new Map(), // id -> { id, name, ingredients:[{foodId,grams}], totalGrams, per100 }
  days: new Map(),    // 'YYYY-MM-DD' -> { entries:[{id,refType,refId,grams}] }
  settings: { goal: { ...DEFAULT_GOAL } },
};

// ── id ──────────────────────────────────────────────────────
// Date.now()/Math.random доступны в браузере (запрет — только для workflow-скриптов).
let seq = 0;
function newId() {
  seq += 1;
  return Date.now().toString(36) + seq.toString(36);
}

// ── загрузка ────────────────────────────────────────────────
export async function hydrate() {
  const all = await loadAll();
  for (const [key, val] of Object.entries(all)) {
    if (key === 'settings') {
      store.settings = { goal: { ...DEFAULT_GOAL, ...(val.goal || {}) } };
    } else if (key.startsWith('food:')) {
      store.foods.set(val.id, val);
    } else if (key.startsWith('recipe:')) {
      store.recipes.set(val.id, val);
    } else if (key.startsWith('day:')) {
      store.days.set(key.slice(4), val);
    }
  }
}

// ── дебаунс-сохранение по ключам ────────────────────────────
const pending = new Map(); // key -> value | DELETE
const DELETE = Symbol('delete');
let timer = null;

function schedule(key, value) {
  pending.set(key, value);
  if (timer) clearTimeout(timer);
  timer = setTimeout(flush, 250);
}

async function flush() {
  timer = null;
  const batch = [...pending.entries()];
  pending.clear();
  for (const [key, value] of batch) {
    try {
      if (value === DELETE) await removeItem(key);
      else await setItem(key, value);
    } catch (e) {
      // не роняем приложение, если запись не удалась — попробуем при след. изменении
      console.warn('Не удалось сохранить', key, e);
    }
  }
}

// На случай закрытия — постараться дописать немедленно.
window.addEventListener('pagehide', () => { if (timer) flush(); });

// ── catalog для расчётов ────────────────────────────────────
export function catalog() {
  return { foods: store.foods, recipes: store.recipes };
}

// ── settings / goal ─────────────────────────────────────────
export function setGoal(goal) {
  store.settings.goal = { ...store.settings.goal, ...goal };
  schedule('settings', store.settings);
}

// ── foods ───────────────────────────────────────────────────
export function upsertFood({ id, name, per100, portion }) {
  const food = { id: id || newId(), name: name.trim(), per100, portion: portion || 0 };
  store.foods.set(food.id, food);
  schedule('food:' + food.id, food);
  return food;
}

export function deleteFood(id) {
  store.foods.delete(id);
  schedule('food:' + id, DELETE);
}

// Где используется продукт: в рецептах и в записях дневника.
export function foodUsage(id) {
  let recipes = 0;
  for (const r of store.recipes.values()) {
    if ((r.ingredients || []).some((i) => i.foodId === id)) recipes += 1;
  }
  let entries = 0;
  for (const d of store.days.values()) {
    entries += (d.entries || []).filter((e) => e.refType === 'food' && e.refId === id).length;
  }
  return { recipes, entries };
}

// ── recipes ─────────────────────────────────────────────────
// Принимает имя и ингредиенты; per100/totalGrams считаются здесь.
export function upsertRecipe({ id, name, ingredients }) {
  const t = recipeTotals(ingredients, store.foods);
  const recipe = {
    id: id || newId(),
    name: name.trim(),
    ingredients,
    totalGrams: t.totalGrams,
    per100: t.per100,
  };
  store.recipes.set(recipe.id, recipe);
  schedule('recipe:' + recipe.id, recipe);
  return recipe;
}

export function deleteRecipe(id) {
  store.recipes.delete(id);
  schedule('recipe:' + id, DELETE);
}

// ── дневник ─────────────────────────────────────────────────
function ensureDay(date) {
  let d = store.days.get(date);
  if (!d) {
    d = { entries: [] };
    store.days.set(date, d);
  }
  return d;
}

export function getDay(date) {
  return store.days.get(date) || { entries: [] };
}

export function addEntry(date, { refType, refId, grams, unit, qty }) {
  const d = ensureDay(date);
  d.entries.push({ id: newId(), refType, refId, grams, unit: unit || 'g', qty: qty ?? grams });
  schedule('day:' + date, d);
}

// Быстрая запись: КБЖУ вводятся цифрами напрямую, без продукта/рецепта.
export function addQuickEntry(date, { name, kcal, p, f, c }) {
  const d = ensureDay(date);
  d.entries.push({ id: newId(), refType: 'quick', name, kcal, p, f, c });
  schedule('day:' + date, d);
}

export function updateQuickEntry(date, entryId, { name, kcal, p, f, c }) {
  const d = store.days.get(date);
  if (!d) return;
  const e = d.entries.find((x) => x.id === entryId);
  if (!e) return;
  Object.assign(e, { name, kcal, p, f, c });
  schedule('day:' + date, d);
}

export function updateEntry(date, entryId, { grams, unit, qty }) {
  const d = store.days.get(date);
  if (!d) return;
  const e = d.entries.find((x) => x.id === entryId);
  if (!e) return;
  e.grams = grams;
  e.unit = unit || 'g';
  e.qty = qty ?? grams;
  schedule('day:' + date, d);
}

export function deleteEntry(date, entryId) {
  const d = store.days.get(date);
  if (!d) return;
  d.entries = d.entries.filter((x) => x.id !== entryId);
  schedule('day:' + date, d);
}
