// nutrition.js — чистые функции расчёта КБЖУ.
// Везде per100 = { kcal, p, f, c } — значения на 100 г.

const round = (n) => Math.round(n);
const round1 = (n) => Math.round(n * 10) / 10;

// Калории из Б/Ж/У по факторам Этвотера: белки 4, жиры 9, углеводы 4 ккал/г.
export function kcalFromMacros(p, f, c) {
  return Math.round(4 * (p || 0) + 9 * (f || 0) + 4 * (c || 0));
}

// Пересчёт КБЖУ с «на 100 г» на произвольное число граммов.
export function scale(per100, grams) {
  const k = (grams || 0) / 100;
  return {
    kcal: round(per100.kcal * k),
    p: round1(per100.p * k),
    f: round1(per100.f * k),
    c: round1(per100.c * k),
  };
}

// Суммарное КБЖУ за день.
// entries: [{ refType:'food'|'recipe', refId, grams }]
// catalog: { foods: Map<id,food>, recipes: Map<id,recipe> }
// Если ссылка «битая» (продукт удалён) — запись считается как 0, но не ломает сумму.
export function sumDay(entries, catalog) {
  const total = { kcal: 0, p: 0, f: 0, c: 0 };
  for (const e of entries || []) {
    let s;
    if (e.refType === 'quick') {
      // быстрая запись хранит КБЖУ напрямую, без продукта
      s = { kcal: e.kcal || 0, p: e.p || 0, f: e.f || 0, c: e.c || 0 };
    } else {
      const item = e.refType === 'recipe' ? catalog.recipes.get(e.refId) : catalog.foods.get(e.refId);
      if (!item) continue;
      s = scale(item.per100, e.grams);
    }
    total.kcal += s.kcal;
    total.p += s.p;
    total.f += s.f;
    total.c += s.c;
  }
  return {
    kcal: round(total.kcal),
    p: round1(total.p),
    f: round1(total.f),
    c: round1(total.c),
  };
}

// Итоги рецепта по списку ингредиентов.
// ingredients: [{ foodId, grams }], foods: Map<id,food>
// Возвращает { totalGrams, total:{kcal,p,f,c}, per100:{kcal,p,f,c} }.
export function recipeTotals(ingredients, foods) {
  const total = { kcal: 0, p: 0, f: 0, c: 0 };
  let totalGrams = 0;
  for (const ing of ingredients || []) {
    const food = foods.get(ing.foodId);
    if (!food) continue;
    const s = scale(food.per100, ing.grams);
    total.kcal += s.kcal;
    total.p += s.p;
    total.f += s.f;
    total.c += s.c;
    totalGrams += ing.grams || 0;
  }
  const k = totalGrams > 0 ? 100 / totalGrams : 0;
  return {
    totalGrams: round(totalGrams),
    total: {
      kcal: round(total.kcal),
      p: round1(total.p),
      f: round1(total.f),
      c: round1(total.c),
    },
    per100: {
      kcal: round(total.kcal * k),
      p: round1(total.p * k),
      f: round1(total.f * k),
      c: round1(total.c * k),
    },
  };
}

// Прогресс к цели: доля 0..1 (для колец/полосок) и остаток.
// totals и goal — { kcal, p, f, c } (в goal допускаются null/0 = «не задано»).
export function progress(totals, goal) {
  const ratio = (got, target) => (target > 0 ? Math.min(got / target, 1) : 0);
  return {
    kcal: { got: totals.kcal, goal: goal.kcal || 0, ratio: ratio(totals.kcal, goal.kcal), left: Math.max((goal.kcal || 0) - totals.kcal, 0) },
    p: { got: totals.p, goal: goal.protein || 0, ratio: ratio(totals.p, goal.protein) },
    f: { got: totals.f, goal: goal.fat || 0, ratio: ratio(totals.f, goal.fat) },
    c: { got: totals.c, goal: goal.carbs || 0, ratio: ratio(totals.c, goal.carbs) },
  };
}
