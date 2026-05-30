// ui.js — рендер экранов, нижние листы (sheets), навигация, Telegram UI.

import * as S from './state.js';
import { scale, sumDay, progress, kcalFromMacros } from './nutrition.js';

const tg = window.Telegram?.WebApp;

// ── мелкие хелперы ───────────────────────────────────────────
const $ = (sel, root = document) => root.querySelector(sel);
const screenEl = $('#screen');

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// парсинг числа из инпута (запятая → точка), отрицательные → 0
function num(v) {
  const n = parseFloat(String(v).replace(',', '.'));
  return isFinite(n) && n > 0 ? n : 0;
}

function haptic(kind = 'light') {
  try {
    if (kind === 'success' || kind === 'warning' || kind === 'error') tg?.HapticFeedback?.notificationOccurred(kind);
    else tg?.HapticFeedback?.impactOccurred(kind);
  } catch { /* нет в браузере */ }
}

function confirmAsync(message) {
  return new Promise((resolve) => {
    if (tg?.showConfirm) tg.showConfirm(message, (ok) => resolve(ok));
    else resolve(window.confirm(message));
  });
}

const todayStr = () => {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
};

function shiftDate(dateStr, days) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function fmtDateLabel(dateStr) {
  if (dateStr === todayStr()) return 'Сегодня';
  if (dateStr === shiftDate(todayStr(), -1)) return 'Вчера';
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', weekday: 'short' });
}

const kbjuMini = (n) =>
  `<span class="kbju-mini tnum">${n.kcal} ккал<span class="sep">·</span>Б ${n.p}<span class="sep">·</span>Ж ${n.f}<span class="sep">·</span>У ${n.c}</span>`;

const ICON_CHEVRON = '<svg class="chevron" width="8" height="14" viewBox="0 0 8 14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 1l6 6-6 6"/></svg>';

// КБЖУ записи дневника (учитывает быстрые записи и битые ссылки).
function entryNutrition(e, cat) {
  if (e.refType === 'quick') return { kcal: e.kcal || 0, p: e.p || 0, f: e.f || 0, c: e.c || 0 };
  const item = e.refType === 'recipe' ? cat.recipes.get(e.refId) : cat.foods.get(e.refId);
  return item ? scale(item.per100, e.grams) : { kcal: 0, p: 0, f: 0, c: 0 };
}
function entryName(e, cat) {
  if (e.refType === 'quick') return (e.name && e.name.trim()) || 'Быстрая запись';
  const item = e.refType === 'recipe' ? cat.recipes.get(e.refId) : cat.foods.get(e.refId);
  return item ? item.name : '— удалено —';
}

// ── состояние навигации ──────────────────────────────────────
const nav = {
  tab: 'diary',
  date: todayStr(),
};

// ════════════════════════════════════════════════════════════
//  SHEETS (нижние листы со стеком)
// ════════════════════════════════════════════════════════════
const sheetStack = [];

function syncBackButton() {
  if (!tg?.BackButton) return;
  if (sheetStack.length) tg.BackButton.show();
  else tg.BackButton.hide();
}

// content: DOM-узел. Возвращает объект { el, close }.
function openSheet(title, content) {
  const back = document.createElement('div');
  back.className = 'sheet-back';
  const sheet = document.createElement('div');
  sheet.className = 'sheet';
  sheet.innerHTML = `<div class="sheet-grip"></div><div class="sheet-title">${esc(title)}</div>`;
  sheet.appendChild(content);
  back.appendChild(sheet);
  document.body.appendChild(back);

  const entry = { el: back };
  const close = () => {
    const i = sheetStack.indexOf(entry);
    if (i === -1) return;
    sheetStack.splice(i, 1);
    back.remove();
    syncBackButton();
  };
  entry.close = close;

  // тап по фону (не по самому листу) — закрыть
  back.addEventListener('click', (e) => { if (e.target === back) close(); });

  sheetStack.push(entry);
  syncBackButton();
  return entry;
}

function closeTopSheet() {
  const top = sheetStack[sheetStack.length - 1];
  if (top) top.close();
}

// ── конструкторы DOM ────────────────────────────────────────
function field(label, { value = '', placeholder = '', type = 'text', inputmode } = {}) {
  const wrap = document.createElement('div');
  wrap.className = 'field';
  wrap.innerHTML = `<label>${esc(label)}</label><input type="${type}" value="${esc(value)}" placeholder="${esc(placeholder)}"${inputmode ? ` inputmode="${inputmode}"` : ''} />`;
  return { el: wrap, input: $('input', wrap) };
}

function button(text, cls = '') {
  const b = document.createElement('button');
  b.className = 'btn ' + cls;
  b.textContent = text;
  return b;
}

// Карточка с авторассчитанной ккал. set(n) обновляет число.
function calcDisplay(label) {
  const card = document.createElement('div');
  card.className = 'card';
  card.innerHTML = `<div class="calc"><span class="calc-label">${esc(label)}</span>` +
    `<span><span class="calc-val tnum">0</span><span class="calc-unit">ккал</span></span></div>`;
  const valEl = $('.calc-val', card);
  return { card, set: (n) => { valEl.textContent = n; } };
}

// ════════════════════════════════════════════════════════════
//  ЭКРАН: ДНЕВНИК
// ════════════════════════════════════════════════════════════
function renderDiary() {
  const day = S.getDay(nav.date);
  const cat = S.catalog();
  const totals = sumDay(day.entries, cat);
  const goal = S.store.settings.goal;
  const pr = progress(totals, goal);

  const R = 54, C = 2 * Math.PI * R; // окружность кольца
  const off = C * (1 - pr.kcal.ratio);

  const entriesHtml = day.entries.length
    ? day.entries.map((e) => {
        const n = entryNutrition(e, cat);
        const name = entryName(e, cat);
        const sub = e.refType === 'quick' ? kbjuMini(n) : `${e.grams} г · ${kbjuMini(n)}`;
        return `<button class="row" data-entry="${e.id}">
            <div class="row-main">
              <div class="row-title">${esc(name)}</div>
              <div class="row-sub">${sub}</div>
            </div>
            <div class="row-value tnum">${n.kcal}</div>${ICON_CHEVRON}
          </button>`;
      }).join('')
    : `<div class="empty">Пока ничего не добавлено.<br>Нажмите «+», чтобы добавить.</div>`;

  const macro = (cls, name, m, unit = 'г') => `
    <div class="macro ${cls}">
      <div class="macro-head"><span class="m-name">${name}</span>
        <span class="m-val tnum">${m.got}${m.goal ? ` / ${m.goal}` : ''} ${unit}</span></div>
      <div class="bar"><span style="width:${Math.round(m.ratio * 100)}%"></span></div>
    </div>`;

  screenEl.innerHTML = `
    <div class="datenav">
      <button data-date="-1" aria-label="Назад"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg></button>
      <div class="d-label">${fmtDateLabel(nav.date)}</div>
      <button data-date="1" aria-label="Вперёд"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6"/></svg></button>
    </div>

    <div class="card progress-card">
      <div class="ring-wrap">
        <svg viewBox="0 0 120 120">
          <circle class="ring-bg" cx="60" cy="60" r="${R}" stroke-width="12"/>
          <circle class="ring-fg" cx="60" cy="60" r="${R}" stroke-width="12"
            stroke-dasharray="${C.toFixed(1)}" stroke-dashoffset="${off.toFixed(1)}"/>
        </svg>
        <div class="ring-center">
          <div class="kcal tnum">${totals.kcal}</div>
          <div class="kcal-sub">${goal.kcal ? `из ${goal.kcal}` : 'ккал'}</div>
        </div>
      </div>
      <div class="macros">
        ${macro('p', 'Белки', pr.p)}
        ${macro('f', 'Жиры', pr.f)}
        ${macro('c', 'Углеводы', pr.c)}
      </div>
    </div>

    <div class="section-title">За день</div>
    <div class="card">${entriesHtml}</div>

    <button class="fab" id="fab-add" aria-label="Добавить">
      <svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>
    </button>
  `;

  $('[data-date="-1"]').onclick = () => { haptic(); nav.date = shiftDate(nav.date, -1); renderDiary(); };
  $('[data-date="1"]').onclick = () => { haptic(); nav.date = shiftDate(nav.date, 1); renderDiary(); };
  $('#fab-add').onclick = () => { haptic(); openAddEntry(); };
  screenEl.querySelectorAll('[data-entry]').forEach((row) => {
    row.onclick = () => { haptic(); openEditEntry(row.dataset.entry); };
  });
}

// ── лист: добавить запись в дневник ─────────────────────────
function openAddEntry() {
  const content = document.createElement('div');
  const search = document.createElement('input');
  search.className = 'search';
  search.placeholder = 'Поиск продукта или рецепта';

  const quickBtn = button('Ввести КБЖУ вручную', 'secondary');
  quickBtn.style.marginBottom = '8px';
  const createBtn = button('+ Создать позицию', 'secondary');
  createBtn.style.marginBottom = '8px';

  const list = document.createElement('div');
  list.className = 'card';

  content.append(search, quickBtn, createBtn, list);
  const sheet = openSheet('Добавить', content);

  quickBtn.onclick = () => { haptic(); openQuickAdd(sheet); };

  const renderList = () => {
    const q = search.value.trim().toLowerCase();
    let items = [...S.store.foods.values()].sort((a, b) => a.name.localeCompare(b.name, 'ru'));
    if (q) items = items.filter((x) => x.name.toLowerCase().includes(q));

    list.innerHTML = items.length
      ? items.map((x) => `<button class="row" data-id="${x.id}">
            <div class="row-main">
              <div class="row-title">${esc(x.name)}</div>
              <div class="row-sub">${kbjuMini(x.per100)} <span class="muted">/ 100 г</span></div>
            </div>${ICON_CHEVRON}
          </button>`).join('')
      : `<div class="empty">Ничего не найдено.<br>Создайте новую позицию.</div>`;

    list.querySelectorAll('[data-id]').forEach((row) => {
      row.onclick = () => {
        haptic();
        openGramsStep(S.store.foods.get(row.dataset.id), 'food', sheet);
      };
    });
  };

  search.oninput = renderList;
  createBtn.onclick = () => { haptic(); openFoodEditor(null, (food) => openGramsStep(food, 'food', sheet)); };
  renderList();
  setTimeout(() => search.focus(), 100);
}

// ── шаг: ввод граммов и добавление в дневник ────────────────
function openGramsStep(item, type, parentSheet) {
  if (!item) return;
  const content = document.createElement('div');
  const def = type === 'recipe' && item.totalGrams ? item.totalGrams : 100;
  const g = field('Граммы', { value: def, inputmode: 'decimal' });
  const preview = document.createElement('div');
  preview.className = 'totals-line';

  const card = document.createElement('div');
  card.className = 'card';
  card.appendChild(g.el);

  const addBtn = button('Добавить', '');
  addBtn.classList.add('btn-add');

  content.append(card, preview, addBtn);
  const sheet = openSheet(item.name, content);

  const upd = () => {
    const n = scale(item.per100, num(g.input.value));
    preview.innerHTML = `Итого: <b class="tnum">${n.kcal} ккал</b> · Б ${n.p} · Ж ${n.f} · У ${n.c}`;
  };
  g.input.oninput = upd;
  upd();

  addBtn.onclick = () => {
    const grams = num(g.input.value);
    if (!grams) return;
    S.addEntry(nav.date, { refType: type, refId: item.id, grams });
    haptic('success');
    sheet.close();
    parentSheet?.close();
    renderDiary();
  };
  setTimeout(() => g.input.select(), 100);
}

// ── лист: редактировать запись дневника ─────────────────────
function openEditEntry(entryId) {
  const day = S.getDay(nav.date);
  const e = day.entries.find((x) => x.id === entryId);
  if (!e) return;
  if (e.refType === 'quick') { openEditQuickEntry(entryId); return; }
  const cat = S.catalog();
  const item = e.refType === 'recipe' ? cat.recipes.get(e.refId) : cat.foods.get(e.refId);

  const content = document.createElement('div');
  const g = field('Граммы', { value: e.grams, inputmode: 'decimal' });
  const card = document.createElement('div');
  card.className = 'card';
  card.appendChild(g.el);

  const preview = document.createElement('div');
  preview.className = 'totals-line';

  const saveBtn = button('Сохранить');
  saveBtn.classList.add('btn-add');
  const delBtn = button('Удалить', 'danger');
  delBtn.style.marginTop = '8px';

  content.append(card, preview, saveBtn, delBtn);
  const sheet = openSheet(item ? item.name : 'Запись', content);

  const upd = () => {
    if (!item) { preview.textContent = 'Продукт удалён из каталога.'; return; }
    const n = scale(item.per100, num(g.input.value));
    preview.innerHTML = `Итого: <b class="tnum">${n.kcal} ккал</b> · Б ${n.p} · Ж ${n.f} · У ${n.c}`;
  };
  g.input.oninput = upd;
  upd();

  saveBtn.onclick = () => {
    const grams = num(g.input.value);
    if (!grams) return;
    S.updateEntry(nav.date, entryId, grams);
    haptic('success');
    sheet.close();
    renderDiary();
  };
  delBtn.onclick = () => {
    S.deleteEntry(nav.date, entryId);
    haptic('warning');
    sheet.close();
    renderDiary();
  };
}

// ── форма быстрой записи КБЖУ (общая для добавления и правки) ─
// Ккал считается автоматически из Б/Ж/У.
function buildQuickFields(init) {
  const name = field('Название (необязательно)', { value: init?.name || '', placeholder: 'Напр. Перекус' });
  const nameCard = document.createElement('div');
  nameCard.className = 'card';
  nameCard.appendChild(name.el);

  const kcalDisp = calcDisplay('Ккал (по Б/Ж/У)');

  const p = field('Белки, г', { value: init?.p ?? '', inputmode: 'decimal' });
  const f = field('Жиры, г', { value: init?.f ?? '', inputmode: 'decimal' });
  const c = field('Углеводы, г', { value: init?.c ?? '', inputmode: 'decimal' });
  const macroCard = document.createElement('div');
  macroCard.className = 'card';
  macroCard.append(p.el, f.el, c.el);

  const recompute = () => kcalDisp.set(kcalFromMacros(num(p.input.value), num(f.input.value), num(c.input.value)));
  [p, f, c].forEach((x) => (x.input.oninput = recompute));
  recompute();

  return { name, p, f, c, nameCard, kcalCard: kcalDisp.card, macroCard };
}

function readQuick(q) {
  const p = num(q.p.input.value), f = num(q.f.input.value), c = num(q.c.input.value);
  return { name: q.name.input.value.trim(), kcal: kcalFromMacros(p, f, c), p, f, c };
}

// ── лист: добавить быструю запись КБЖУ ──────────────────────
function openQuickAdd(parentSheet) {
  const content = document.createElement('div');
  const q = buildQuickFields();
  const hint = document.createElement('div');
  hint.className = 'section-title';
  hint.textContent = 'КБЖУ записи';
  const addBtn = button('Добавить');
  addBtn.classList.add('btn-add');
  content.append(q.nameCard, hint, q.kcalCard, q.macroCard, addBtn);
  const sheet = openSheet('Быстрая запись', content);

  addBtn.onclick = () => {
    const v = readQuick(q);
    if (!(v.p || v.f || v.c)) { q.p.input.focus(); return; }
    S.addQuickEntry(nav.date, v);
    haptic('success');
    sheet.close();
    parentSheet?.close();
    renderDiary();
  };
  setTimeout(() => q.p.input.focus(), 100);
}

// ── лист: редактировать быструю запись ──────────────────────
function openEditQuickEntry(entryId) {
  const day = S.getDay(nav.date);
  const e = day.entries.find((x) => x.id === entryId);
  if (!e) return;

  const content = document.createElement('div');
  const q = buildQuickFields(e);
  const hint = document.createElement('div');
  hint.className = 'section-title';
  hint.textContent = 'КБЖУ записи';
  const saveBtn = button('Сохранить');
  saveBtn.classList.add('btn-add');
  const delBtn = button('Удалить', 'danger');
  delBtn.style.marginTop = '8px';
  content.append(q.nameCard, hint, q.kcalCard, q.macroCard, saveBtn, delBtn);
  const sheet = openSheet('Быстрая запись', content);

  saveBtn.onclick = () => {
    const v = readQuick(q);
    if (!(v.p || v.f || v.c)) { q.p.input.focus(); return; }
    S.updateQuickEntry(nav.date, entryId, v);
    haptic('success');
    sheet.close();
    renderDiary();
  };
  delBtn.onclick = () => {
    S.deleteEntry(nav.date, entryId);
    haptic('warning');
    sheet.close();
    renderDiary();
  };
}

// ════════════════════════════════════════════════════════════
//  ЭКРАН: КАТАЛОГ (плоский список позиций с КБЖУ)
// ════════════════════════════════════════════════════════════
function renderCatalog() {
  screenEl.innerHTML = `
    <h1 class="large-title">Каталог</h1>
    <input class="search" id="cat-search" placeholder="Поиск" />
    <div class="card" id="cat-list"></div>
    <button class="fab" id="fab-new" aria-label="Добавить позицию">
      <svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>
    </button>
  `;

  const listEl = $('#cat-list');
  const searchEl = $('#cat-search');

  const renderList = () => {
    const q = searchEl.value.trim().toLowerCase();
    let items = [...S.store.foods.values()].sort((a, b) => a.name.localeCompare(b.name, 'ru'));
    if (q) items = items.filter((x) => x.name.toLowerCase().includes(q));
    listEl.innerHTML = items.length
      ? items.map((x) => `<button class="row" data-id="${x.id}">
            <div class="row-main"><div class="row-title">${esc(x.name)}</div>
            <div class="row-sub">${kbjuMini(x.per100)} <span class="muted">/ 100 г</span></div></div>${ICON_CHEVRON}
          </button>`).join('')
      : `<div class="empty">Пока пусто.<br>Нажмите «+», чтобы добавить позицию.</div>`;
    listEl.querySelectorAll('[data-id]').forEach((row) => {
      row.onclick = () => { haptic(); openFoodEditor(S.store.foods.get(row.dataset.id)); };
    });
  };

  searchEl.oninput = renderList;
  $('#fab-new').onclick = () => { haptic(); openFoodEditor(null); };
  renderList();
}

// ── лист: редактор продукта ─────────────────────────────────
// onSaved(food) — необязательный коллбэк (используется при «создать из дневника»)
function openFoodEditor(food, onSaved) {
  const editing = !!food;
  const content = document.createElement('div');

  const name = field('Название', { value: food?.name || '', placeholder: 'Напр. Куриная грудка' });
  const nameCard = document.createElement('div');
  nameCard.className = 'card';
  nameCard.appendChild(name.el);

  const hint = document.createElement('div');
  hint.className = 'section-title';
  hint.textContent = 'На 100 грамм';

  const kcalDisp = calcDisplay('Ккал (по Б/Ж/У)');
  const p = field('Белки', { value: food?.per100.p ?? '', inputmode: 'decimal' });
  const f = field('Жиры', { value: food?.per100.f ?? '', inputmode: 'decimal' });
  const c = field('Углеводы', { value: food?.per100.c ?? '', inputmode: 'decimal' });

  const macroCard = document.createElement('div');
  macroCard.className = 'card';
  macroCard.append(p.el, f.el, c.el);

  const recompute = () => kcalDisp.set(kcalFromMacros(num(p.input.value), num(f.input.value), num(c.input.value)));
  [p, f, c].forEach((x) => (x.input.oninput = recompute));
  recompute();

  const saveBtn = button(editing ? 'Сохранить' : 'Создать');
  saveBtn.classList.add('btn-add');
  content.append(nameCard, hint, kcalDisp.card, macroCard, saveBtn);

  if (editing) {
    const delBtn = button('Удалить позицию', 'danger');
    delBtn.style.marginTop = '8px';
    delBtn.onclick = async () => {
      const u = S.foodUsage(food.id);
      if (u.entries) {
        const ok = await confirmAsync(
          `Позиция используется в дневнике (записей: ${u.entries}). ` +
          `Удалить? Эти записи перестанут учитываться.`);
        if (!ok) return;
      }
      S.deleteFood(food.id);
      haptic('warning');
      sheet.close();
      if (nav.tab === 'catalog') renderCatalog();
      else renderDiary();
    };
    content.appendChild(delBtn);
  }

  const sheet = openSheet(editing ? 'Позиция' : 'Новая позиция', content);

  saveBtn.onclick = () => {
    const nm = name.input.value.trim();
    if (!nm) { name.input.focus(); return; }
    const pv = num(p.input.value), fv = num(f.input.value), cv = num(c.input.value);
    const saved = S.upsertFood({
      id: food?.id,
      name: nm,
      per100: { kcal: kcalFromMacros(pv, fv, cv), p: pv, f: fv, c: cv },
    });
    haptic('success');
    sheet.close();
    if (nav.tab === 'catalog') renderCatalog();
    if (onSaved) onSaved(saved);
  };
  setTimeout(() => name.input.focus(), 100);
}

// ════════════════════════════════════════════════════════════
//  ЭКРАН: ЦЕЛЬ
// ════════════════════════════════════════════════════════════
function renderGoal() {
  const goal = S.store.settings.goal;
  screenEl.innerHTML = `<h1 class="large-title">Цель</h1>
    <div class="section-title">Дневная норма</div>
    <div id="goal-mount"></div>
    <button class="btn btn-add" id="goal-save">Сохранить</button>
    <div class="section-title">О приложении</div>
    <div class="totals-line muted" id="storage-note"></div>`;

  const mount = $('#goal-mount');
  const kcalDisp = calcDisplay('Ккал (по Б/Ж/У)');
  const p = field('Белки, г', { value: goal.protein || '', inputmode: 'decimal' });
  const f = field('Жиры, г', { value: goal.fat || '', inputmode: 'decimal' });
  const c = field('Углеводы, г', { value: goal.carbs || '', inputmode: 'decimal' });
  const macroCard = document.createElement('div');
  macroCard.className = 'card';
  macroCard.style.marginTop = '8px';
  macroCard.append(p.el, f.el, c.el);

  const recompute = () => kcalDisp.set(kcalFromMacros(num(p.input.value), num(f.input.value), num(c.input.value)));
  [p, f, c].forEach((x) => (x.input.oninput = recompute));
  recompute();

  mount.append(kcalDisp.card, macroCard);

  $('#goal-save').onclick = () => {
    const pv = num(p.input.value), fv = num(f.input.value), cv = num(c.input.value);
    S.setGoal({ kcal: kcalFromMacros(pv, fv, cv), protein: pv, fat: fv, carbs: cv });
    haptic('success');
    try { tg?.showPopup?.({ message: 'Цель сохранена', buttons: [{ type: 'ok' }] }); }
    catch { /* showPopup не поддержан в старой версии клиента */ }
  };

  import('./storage.js').then(({ backendName }) => {
    const notes = {
      supabase: 'Данные хранятся в базе Supabase — резервируются и доступны с любого устройства.',
      cloud: 'Данные хранятся в Telegram и синхронизируются между вашими устройствами.',
      local: 'Данные хранятся локально в этом браузере (только для разработки).',
    };
    $('#storage-note').textContent = notes[backendName] || notes.local;
  });
}

// ════════════════════════════════════════════════════════════
//  Навигация по вкладкам
// ════════════════════════════════════════════════════════════
export function render() {
  if (nav.tab === 'diary') renderDiary();
  else if (nav.tab === 'catalog') renderCatalog();
  else if (nav.tab === 'goal') renderGoal();

  document.querySelectorAll('.tab').forEach((t) => {
    t.classList.toggle('active', t.dataset.tab === nav.tab);
  });
  screenEl.scrollTop = 0;
}

export function initUI() {
  document.querySelectorAll('.tab').forEach((t) => {
    t.onclick = () => {
      if (nav.tab === t.dataset.tab) return;
      haptic();
      nav.tab = t.dataset.tab;
      render();
    };
  });

  // Telegram BackButton закрывает верхний лист
  if (tg?.BackButton) {
    tg.BackButton.onClick(() => { if (sheetStack.length) closeTopSheet(); });
  }

  render();
}
