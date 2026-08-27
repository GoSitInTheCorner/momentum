// views/today.js -- landing screen: yesterday recap, journal, to-dos, log streams, health sliders.
import { todayStr, addDays } from '../db.js';
import {
  getDay, saveDay, getTasksForDate, addTask, toggleTask, updateTask, deleteTask, reorderTasks,
  getLogForDate, addLogItem, deleteLogItem, getGoals, getSettings, getRecentTaskTexts,
} from '../store.js';
import { createHealthSlider } from '../components/slider.js';
import { openPrompt, openSheet } from '../components/sheet.js';
import { openEmotionBank, mountEmotionTagRow } from '../components/emotionbank.js';
import { escapeHtml, formatWeekday } from '../util.js';

const JOURNAL_PROMPTS = [
  'What went well today?', 'What is on your mind?', 'What are you grateful for right now?',
  'What felt hard today, and why?', 'What is one thing you want to remember about today?',
];
function promptsForToday() {
  const dayOfYear = Math.floor((Date.now() - new Date(new Date().getFullYear(), 0, 0)) / 86400000);
  return [0, 1, 2].map((i) => JOURNAL_PROMPTS[(dayOfYear + i) % JOURNAL_PROMPTS.length]);
}

let debounceTimer = null;
function debounce(fn, ms = 500) {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(fn, ms);
}

export async function renderToday(root, { pendingAction } = {}) {
  const settings = await getSettings();
  const date = todayStr();
  const yDate = addDays(date, -1);

  const view = document.createElement('div');
  view.className = 'view view--today';

  const showRecap = settings.recapEnabled && !isRecapDismissedToday() &&
    (settings.recapAlways || isBeforeCutoff(settings.recapCutoff));

  view.innerHTML = `
    <header class="topbar">
      <div class="topbar__eyebrow">${formatWeekday(date)}</div>
      <h1 class="topbar__title">Today</h1>
    </header>
    <div class="scroll-area">
      ${showRecap ? `<section class="recap" id="recap"></section>` : ''}
      <section class="card journal-card">
        <div class="card__title-row">
          <h2 class="card__title">Today's entry</h2>
          <button class="icon-btn" id="journal-emo-btn" aria-label="Insert feeling word" title="Insert a feeling word">&#9786;</button>
        </div>
        <div class="journal-prompts" id="journal-prompts" hidden></div>
        <textarea class="journal-input" placeholder="What's on your mind today?" style="font-family:var(--journal-font); font-size:calc(1rem * var(--journal-scale));"></textarea>
        <div class="autosave-hint" id="journal-hint">&nbsp;</div>
      </section>

      <section class="card">
        <div class="card__title-row">
          <h2 class="card__title">To-dos</h2>
          <button class="chip-btn" id="add-task-btn">+ Add</button>
        </div>
        <div class="carryover" id="carryover" hidden></div>
        <ul class="task-list" id="task-list"></ul>
        <p class="empty-hint" id="task-empty" hidden>Nothing yet -- tap + to add your first to-do.</p>
      </section>

      <section class="card">
        <div class="card__title-row">
          <h2 class="card__title">Done &amp; learned</h2>
        </div>
        <div class="log-actions">
          <button class="chip-btn chip-btn--done" id="add-done-btn">&#9679; I did...</button>
          <button class="chip-btn chip-btn--learned" id="add-learned-btn">&#9670; I learned...</button>
        </div>
        <ul class="log-list" id="log-list"></ul>
      </section>

      <section class="card">
        <div class="card__title-row">
          <h2 class="card__title">How are you?</h2>
        </div>
        <div class="health-row" id="health-row"></div>
        <div class="emo-tag-mount" id="emo-tag-mount"></div>
      </section>
      <div class="scroll-spacer"></div>
    </div>
  `;
  root.appendChild(view);

  // ---- Journal ----
  const day = await getDay(date);
  const yDay = await getDay(yDate);
  const journalInput = view.querySelector('.journal-input');
  journalInput.value = day.journal || '';
  const hint = view.querySelector('#journal-hint');
  const promptsEl = view.querySelector('#journal-prompts');

  journalInput.addEventListener('input', () => {
    promptsEl.hidden = true;
    hint.textContent = 'Saving...';
    debounce(async () => {
      await saveDay(date, { journal: journalInput.value });
      hint.textContent = 'Saved';
      setTimeout(() => { if (hint.textContent === 'Saved') hint.textContent = ' '; }, 1500);
    }, 500);
  });

  // Smart prefill: lightweight prompt suggestions, tappable inserts, only while empty
  // and only when the "Daily prompt" setting is on.
  if (settings.dailyPrompt && !journalInput.value.trim()) {
    promptsEl.hidden = false;
    promptsEl.innerHTML = promptsForToday().map((p) => `<button type="button" class="preset-chip">${escapeHtml(p)}</button>`).join('');
    promptsEl.querySelectorAll('.preset-chip').forEach((chip) => {
      chip.addEventListener('click', () => {
        journalInput.value = (journalInput.value ? journalInput.value + ' ' : '') + chip.textContent + ' ';
        journalInput.focus();
        journalInput.dispatchEvent(new Event('input'));
      });
    });
  }

  view.querySelector('#journal-emo-btn').addEventListener('click', () => {
    openEmotionBank({
      mode: 'insert',
      onInsert: (word) => {
        const el = journalInput;
        const start = el.selectionStart ?? el.value.length;
        const end = el.selectionEnd ?? el.value.length;
        el.value = el.value.slice(0, start) + word + el.value.slice(end);
        el.focus();
        el.selectionStart = el.selectionEnd = start + word.length;
        el.dispatchEvent(new Event('input'));
      },
    });
  });

  // ---- Recap ----
  if (showRecap) {
    await renderRecap(view.querySelector('#recap'), yDate);
  }

  // ---- Tasks ----
  const goals = await getGoals();

  async function refreshTasks() {
    const tasks = await getTasksForDate(date);
    const listEl = view.querySelector('#task-list');
    view.querySelector('#task-empty').hidden = tasks.length > 0;
    listEl.innerHTML = tasks.map((t) => taskRowHTML(t, goals)).join('');
    wireTaskRows(listEl);
    await refreshCarryover(tasks);
  }

  function wireTaskRows(listEl) {
    listEl.querySelectorAll('.task-row').forEach((row) => {
      const id = Number(row.dataset.id);
      row.querySelector('.task-check').addEventListener('click', async (e) => {
        e.stopPropagation();
        row.classList.add('is-animating');
        const done = await toggleTask(id);
        row.classList.toggle('is-done', done);
        setTimeout(() => refreshTasks(), done ? 550 : 0);
      });
      row.querySelector('.task-delete').addEventListener('click', async (e) => {
        e.stopPropagation();
        await deleteTask(id);
        refreshTasks();
      });
      const linkBtn = row.querySelector('.task-link');
      if (linkBtn) linkBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        openSheet({
          title: 'Link to a goal',
          actions: [
            { id: 'none', label: 'No goal', hint: 'Remove link', icon: '&mdash;' },
            ...goals.map((g) => ({ id: String(g.id), label: g.title, hint: g.category || '', icon: '&#9670;' })),
          ],
          onSelect: async (selId) => {
            await updateTask(id, { goalId: selId === 'none' ? null : Number(selId) });
            refreshTasks();
          },
        });
      });
      wireDrag(row.querySelector('.task-drag'), row, listEl, async (orderedIds) => reorderTasks(date, orderedIds));
    });
  }

  // Smart prefill: carried-over unfinished to-dos from yesterday, one-tap add or dismiss.
  const dismissedCarryover = new Set(JSON.parse(sessionStorage.getItem(`momentum-carryover-dismissed-${date}`) || '[]'));
  function saveDismissed() {
    sessionStorage.setItem(`momentum-carryover-dismissed-${date}`, JSON.stringify([...dismissedCarryover]));
  }
  async function refreshCarryover(todaysTasks) {
    const carryEl = view.querySelector('#carryover');
    const yTasks = await getTasksForDate(yDate);
    const todaysTexts = new Set(todaysTasks.map((t) => t.text.trim().toLowerCase()));
    const candidates = yTasks.filter((t) => !t.done && !dismissedCarryover.has(t.id) && !todaysTexts.has(t.text.trim().toLowerCase()));
    if (!candidates.length) { carryEl.hidden = true; carryEl.innerHTML = ''; return; }
    carryEl.hidden = false;
    carryEl.innerHTML = `
      <div class="carryover__label">Carried over from yesterday</div>
      ${candidates.map((t) => `
        <div class="carryover__row" data-yid="${t.id}">
          <span class="carryover__text">${escapeHtml(t.text)}</span>
          <button class="carryover__add" aria-label="Add to today">Add</button>
          <button class="carryover__dismiss" aria-label="Dismiss">&times;</button>
        </div>
      `).join('')}
    `;
    carryEl.querySelectorAll('.carryover__row').forEach((row) => {
      const yid = Number(row.dataset.yid);
      const src = candidates.find((c) => c.id === yid);
      row.querySelector('.carryover__add').addEventListener('click', async () => {
        await addTask(date, src.text, src.goalId || null);
        dismissedCarryover.add(yid);
        saveDismissed();
        refreshTasks();
      });
      row.querySelector('.carryover__dismiss').addEventListener('click', () => {
        dismissedCarryover.add(yid);
        saveDismissed();
        row.remove();
        if (!carryEl.querySelector('.carryover__row')) carryEl.hidden = true;
      });
    });
  }

  view.querySelector('#add-task-btn').addEventListener('click', async () => {
    const presets = await getRecentTaskTexts(6);
    openPrompt({
      title: 'New to-do', placeholder: 'e.g. Finish project proposal', confirmLabel: 'Add', presets,
      onSubmit: async (text) => { await addTask(date, text); refreshTasks(); },
    });
  });

  await refreshTasks();

  // ---- Log (done / learned) ----
  async function refreshLog() {
    const items = await getLogForDate(date);
    const listEl = view.querySelector('#log-list');
    listEl.innerHTML = items.map((i) => `
      <li class="log-row log-row--${i.type}" data-id="${i.id}">
        <span class="log-row__dot">${i.type === 'done' ? '&#9679;' : '&#9670;'}</span>
        <span class="log-row__text">${escapeHtml(i.text)}</span>
        <button class="log-row__delete" aria-label="Delete">&times;</button>
      </li>
    `).join('');
    listEl.querySelectorAll('.log-row__delete').forEach((btn) => {
      btn.addEventListener('click', async () => {
        await deleteLogItem(Number(btn.closest('.log-row').dataset.id));
        refreshLog();
      });
    });
  }
  view.querySelector('#add-done-btn').addEventListener('click', () => {
    openPrompt({ title: 'I did...', placeholder: 'e.g. Went for a 20-min run', confirmLabel: 'Log it',
      onSubmit: async (text) => { await addLogItem(date, 'done', text); refreshLog(); } });
  });
  view.querySelector('#add-learned-btn').addEventListener('click', () => {
    openPrompt({ title: 'I learned...', placeholder: 'e.g. Async/await pitfalls in JS', confirmLabel: 'Log it',
      onSubmit: async (text) => { await addLogItem(date, 'learned', text); refreshLog(); } });
  });
  await refreshLog();

  // ---- Health sliders ----
  // Smart prefill: default each slider to *yesterday's* rating for that dimension when
  // today has none yet; fall back to the scale midpoint only if yesterday has no data
  // either. Still fully draggable/editable -- nothing here is written until touched.
  const healthRow = view.querySelector('#health-row');
  for (const dim of settings.healthDims.filter((d) => d.enabled)) {
    const todayVal = day.ratings?.[dim.key];
    const prefill = typeof todayVal === 'number' ? todayVal : yDay.ratings?.[dim.key];
    const slider = createHealthSlider({
      key: dim.key, label: dim.label, value: prefill, scale: settings.ratingScale,
      onChange: async (v) => {
        const cur = await getDay(date);
        await saveDay(date, { ratings: { ...cur.ratings, [dim.key]: v } });
      },
    });
    healthRow.appendChild(slider.el);
  }

  // Emotion tags for today, next to the health sliders (one shared component).
  mountEmotionTagRow(view.querySelector('#emo-tag-mount'), { date, tags: day.emotions || [] });

  // ---- Handle FAB pending action ----
  if (pendingAction === 'task') view.querySelector('#add-task-btn').click();
  if (pendingAction === 'done') view.querySelector('#add-done-btn').click();
  if (pendingAction === 'learned') view.querySelector('#add-learned-btn').click();
  if (pendingAction === 'journal') journalInput.focus();
}

async function renderRecap(el, yDate) {
  const [day, tasks, log] = await Promise.all([getDay(yDate), getTasksForDate(yDate), getLogForDate(yDate)]);
  const done = tasks.filter((t) => t.done);
  const settings = await getSettings();
  const ratingsHtml = settings.healthDims.filter((d) => d.enabled).map((d) => {
    const v = day.ratings?.[d.key];
    return `<span class="recap__rating"><b>${v ?? '&mdash;'}</b><small>${d.label}</small></span>`;
  }).join('');
  el.innerHTML = `
    <div class="recap__card">
      <button class="recap__dismiss" aria-label="Dismiss">&times;</button>
      <div class="recap__eyebrow">Yesterday</div>
      ${done.length ? `<div class="recap__block"><h3>Completed</h3><ul>${done.map((t) => `<li>${escapeHtml(t.text)}</li>`).join('')}</ul></div>` : ''}
      ${log.length ? `<div class="recap__block"><h3>Logged</h3><ul>${log.slice(0, 4).map((i) => `<li>${i.type === 'done' ? '&#9679;' : '&#9670;'} ${escapeHtml(i.text)}</li>`).join('')}</ul></div>` : ''}
      ${!done.length && !log.length ? `<p class="recap__empty">No activity logged yesterday.</p>` : ''}
      <div class="recap__ratings">${ratingsHtml}</div>
    </div>
  `;
  el.querySelector('.recap__dismiss').addEventListener('click', () => {
    dismissRecapToday();
    el.remove();
  });
}

function taskRowHTML(t, goals) {
  const goal = goals.find((g) => g.id === t.goalId);
  return `
    <li class="task-row ${t.done ? 'is-done' : ''}" data-id="${t.id}">
      <button class="task-drag" aria-label="Drag to reorder" tabindex="-1">
        <svg viewBox="0 0 24 24" fill="none"><circle cx="9" cy="6" r="1.4" fill="currentColor"/><circle cx="9" cy="12" r="1.4" fill="currentColor"/><circle cx="9" cy="18" r="1.4" fill="currentColor"/><circle cx="15" cy="6" r="1.4" fill="currentColor"/><circle cx="15" cy="12" r="1.4" fill="currentColor"/><circle cx="15" cy="18" r="1.4" fill="currentColor"/></svg>
      </button>
      <button class="task-check" aria-label="Toggle done"><svg viewBox="0 0 24 24" fill="none"><path d="M5 12.5l4.5 4.5L19 7.5" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
      <span class="task-row__text">${escapeHtml(t.text)}</span>
      <button class="task-link ${goal ? 'has-goal' : ''}" aria-label="Link to a goal" title="Link to a goal">${goal ? escapeHtml(goal.title) : '&#9670;'}</button>
      <button class="task-delete" aria-label="Delete">&times;</button>
    </li>
  `;
}

// Pointer-event based reorder (HTML5 drag-and-drop never fires from touch on iOS
// Safari, the real target device). Follows the same pointerdown/pointermove/pointerup
// + setPointerCapture pattern as components/slider.js. The drag is bound to a small
// handle (not the whole row) so the rest of the row keeps native scroll/tap behavior;
// the handle alone gets `touch-action: none` in CSS so a touch-drag isn't hijacked by
// the page scroll gesture. The dragged row itself moves visually via a CSS transform
// (reusing the existing .is-dragging class); sibling rows are hit-tested against by
// bounding rect on every move to decide the live drop position.
function wireDrag(handle, row, listEl, onReorder) {
  let pointerId = null;
  let dragging = false;
  let startClientY = 0;
  let staticTop = 0;

  function siblingRows() {
    return [...listEl.querySelectorAll('.task-row')].filter((r) => r !== row);
  }

  handle.addEventListener('pointerdown', (e) => {
    pointerId = e.pointerId;
    startClientY = e.clientY;
    staticTop = row.getBoundingClientRect().top;
    handle.setPointerCapture(pointerId);
  });

  handle.addEventListener('pointermove', (e) => {
    if (pointerId === null || e.pointerId !== pointerId) return;
    const dy = e.clientY - startClientY;
    if (!dragging) {
      if (Math.abs(dy) < 4) return;
      dragging = true;
      row.classList.add('is-dragging');
      row.style.zIndex = '5';
    }
    const desiredTop = staticTop + dy;
    row.style.transform = `translateY(${desiredTop - staticTop}px)`;

    const rowHeight = row.getBoundingClientRect().height;
    const desiredMid = desiredTop + rowHeight / 2;
    for (const sib of siblingRows()) {
      const r = sib.getBoundingClientRect();
      if (desiredMid > r.top && desiredMid < r.bottom) {
        const before = desiredMid < r.top + r.height / 2;
        const ref = before ? sib : sib.nextSibling;
        if (ref !== row) {
          listEl.insertBefore(row, ref);
          // Re-anchor the transform baseline to the row's new static position so it
          // doesn't visually jump by the amount the reflow just shifted it.
          staticTop = row.getBoundingClientRect().top - (desiredTop - staticTop);
          row.style.transform = `translateY(${desiredTop - staticTop}px)`;
        }
        break;
      }
    }
  });

  function end(e) {
    if (pointerId === null || (e && e.pointerId !== pointerId)) return;
    if (dragging) {
      row.classList.remove('is-dragging');
      row.style.transform = '';
      row.style.zIndex = '';
      const ids = [...listEl.querySelectorAll('.task-row')].map((r) => Number(r.dataset.id));
      onReorder(ids);
    }
    dragging = false;
    pointerId = null;
  }
  handle.addEventListener('pointerup', end);
  handle.addEventListener('pointercancel', end);
}

function isBeforeCutoff(cutoff) {
  const [h, m] = (cutoff || '12:00').split(':').map(Number);
  const now = new Date();
  return now.getHours() < h || (now.getHours() === h && now.getMinutes() < m);
}

function recapKey() { return `momentum-recap-dismissed-${todayStr()}`; }
function isRecapDismissedToday() { return sessionStorage.getItem(recapKey()) === '1'; }
function dismissRecapToday() { sessionStorage.setItem(recapKey(), '1'); }
