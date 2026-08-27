// components/tasklist.js — the full to-do list UI (row markup, drag-to-reorder,
// goal-link sheet, carried-over-from-yesterday smart prefill). Extracted out of the
// old Today view so Goals ("do") can own it without duplicating the ~70-line drag
// implementation. One implementation, one importer today (Goals) -- kept as a
// standalone module so it stays importable from anywhere else that needs it later.
import { getTasksForDate, addTask, toggleTask, updateTask, deleteTask, reorderTasks } from '../store.js';
import { openSheet } from './sheet.js';
import { escapeHtml } from '../util.js';

export function taskRowHTML(t, goals) {
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
export function wireDrag(handle, row, listEl, onReorder) {
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

/**
 * Mounts a full to-do list section (list + carried-over-from-yesterday strip + empty
 * state) into existing DOM refs inside `root`. `root` must contain elements with ids
 * #task-list, #task-empty, #carryover. `badge` is the object returned by
 * components/savebadge.js's wireAutosave() (optional -- omit for no save feedback).
 */
export function createTaskSection({ root, date, yDate, goals, badge }) {
  const listEl = root.querySelector('#task-list');
  const emptyEl = root.querySelector('#task-empty');
  const carryEl = root.querySelector('#carryover');

  const dismissedCarryover = new Set(JSON.parse(sessionStorage.getItem(`momentum-carryover-dismissed-${date}`) || '[]'));
  function saveDismissed() {
    sessionStorage.setItem(`momentum-carryover-dismissed-${date}`, JSON.stringify([...dismissedCarryover]));
  }

  async function refresh() {
    const tasks = await getTasksForDate(date);
    emptyEl.hidden = tasks.length > 0;
    listEl.innerHTML = tasks.map((t) => taskRowHTML(t, goals)).join('');
    wireRows();
    await refreshCarryover(tasks);
    return tasks;
  }

  function wireRows() {
    listEl.querySelectorAll('.task-row').forEach((row) => {
      const id = Number(row.dataset.id);
      row.querySelector('.task-check').addEventListener('click', async (e) => {
        e.stopPropagation();
        row.classList.add('is-animating');
        badge?.saving();
        const done = await toggleTask(id);
        badge?.saved();
        row.classList.toggle('is-done', done);
        setTimeout(() => refresh(), done ? 550 : 0);
      });
      row.querySelector('.task-delete').addEventListener('click', async (e) => {
        e.stopPropagation();
        badge?.saving();
        await deleteTask(id);
        badge?.saved();
        refresh();
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
            badge?.saving();
            await updateTask(id, { goalId: selId === 'none' ? null : Number(selId) });
            badge?.saved();
            refresh();
          },
        });
      });
      wireDrag(row.querySelector('.task-drag'), row, listEl, async (orderedIds) => {
        badge?.saving();
        await reorderTasks(date, orderedIds);
        badge?.saved();
      });
    });
  }

  async function refreshCarryover(todaysTasks) {
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
        badge?.saving();
        await addTask(date, src.text, src.goalId || null);
        badge?.saved();
        dismissedCarryover.add(yid);
        saveDismissed();
        refresh();
      });
      row.querySelector('.carryover__dismiss').addEventListener('click', () => {
        dismissedCarryover.add(yid);
        saveDismissed();
        row.remove();
        if (!carryEl.querySelector('.carryover__row')) carryEl.hidden = true;
      });
    });
  }

  return { refresh };
}
