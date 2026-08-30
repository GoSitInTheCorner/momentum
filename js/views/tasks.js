// views/tasks.js -- the "do" tab: one capture box (task / did-it / thought) plus a
// persistent "To do" list of every open task across all dates, and a collapsible dated
// "Done & thoughts" history. Reworked in v2.5 off the old today-only view + manual
// "carried over from yesterday" strip (see docs/SPEC.md v2.5) -- drag-reorder and the
// goal-link chip are dropped from these rows to keep the list uncrowded; those fields
// stay intact on the task record, just unrendered here. components/tasklist.js (the
// old drag/carryover/goal-link implementation) is now unused by anything and removed.
import {
  getSettings, getOpenTasks, getDoneTasks, addTask, addDoneTask, toggleTask, deleteTask,
  addThought, getThoughts, deleteLogItem,
} from '../store.js';
import { todayStr } from '../db.js';
import { escapeHtml, formatDate } from '../util.js';
import { wireAutosave } from '../components/savebadge.js';

export async function renderTasks(root, { pendingAction } = {}) {
  const date = todayStr();

  const view = document.createElement('div');
  view.className = 'view view--tasks';
  view.innerHTML = `
    <header class="topbar">
      <div class="topbar__eyebrow">Get it done</div>
      <h1 class="topbar__title">Tasks</h1>
    </header>
    <div class="scroll-area" id="tasks-scroll">
      <section class="card task-capture">
        <div class="card__title-row"><h2 class="card__title">What's on your mind?</h2></div>
        <input type="text" class="text-field" id="capture-input" placeholder="Add a task, a win, or a thought..." />
        <div class="task-capture__actions">
          <button type="button" class="chip-btn" id="capture-task-btn">+ Task</button>
          <button type="button" class="chip-btn chip-btn--done" id="capture-did-btn">&#10003; Did it</button>
          <button type="button" class="chip-btn chip-btn--learned" id="capture-thought-btn">~ Thought</button>
        </div>
        <div class="autosave-hint" id="task-hint">&nbsp;</div>
      </section>

      <section class="card">
        <div class="card__title-row"><h2 class="card__title">To do</h2></div>
        <ul class="task-list" id="open-task-list"></ul>
        <p class="empty-hint" id="open-task-empty" hidden>All clear. Add a task above when something comes up.</p>
      </section>

      <section class="card">
        <button type="button" class="checkin-toggle is-open" id="history-toggle" aria-expanded="true">
          <span>Done &amp; thoughts (<span id="history-count">0</span>)</span>
          <span class="checkin-toggle__chevron" aria-hidden="true">&#9662;</span>
        </button>
        <div class="checkin-body" id="history-body">
          <ul class="log-list" id="history-list"></ul>
        </div>
      </section>
      <div class="scroll-spacer"></div>
    </div>
  `;
  root.appendChild(view);

  const captureInput = view.querySelector('#capture-input');

  try {
    const settings = await getSettings();
    const badge = wireAutosave(view.querySelector('#task-hint'));
    const openListEl = view.querySelector('#open-task-list');
    const openEmptyEl = view.querySelector('#open-task-empty');
    const historyListEl = view.querySelector('#history-list');
    const historyCountEl = view.querySelector('#history-count');

    const dateLabel = (d) => (d === date ? 'Today' : formatDate(d, settings.dateFormat));

    async function refreshOpen() {
      const tasks = await getOpenTasks();
      openEmptyEl.hidden = tasks.length > 0;
      openListEl.innerHTML = tasks.map((t) => `
        <li class="task-row" data-id="${t.id}">
          <button class="task-check" aria-label="Toggle done"><svg viewBox="0 0 24 24" fill="none"><path d="M5 12.5l4.5 4.5L19 7.5" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
          <span class="task-row__text">${escapeHtml(t.text)}</span>
          <span class="task-date">${escapeHtml(dateLabel(t.date))}</span>
          <button class="task-delete" aria-label="Delete">&times;</button>
        </li>
      `).join('');
      openListEl.querySelectorAll('.task-row').forEach((row) => {
        const id = Number(row.dataset.id);
        row.querySelector('.task-check').addEventListener('click', async (e) => {
          e.stopPropagation();
          badge.saving();
          const done = await toggleTask(id);
          badge.saved();
          row.classList.toggle('is-done', done);
          setTimeout(refreshAll, done ? 550 : 0);
        });
        row.querySelector('.task-delete').addEventListener('click', async (e) => {
          e.stopPropagation();
          badge.saving();
          await deleteTask(id);
          badge.saved();
          refreshAll();
        });
      });
    }

    async function refreshHistory() {
      const [doneTasks, thoughts] = await Promise.all([getDoneTasks(), getThoughts()]);
      const merged = [
        ...doneTasks.map((t) => ({ kind: 'task', id: t.id, text: t.text, date: t.date, ts: t.completedAt || 0 })),
        ...thoughts.map((l) => ({ kind: 'thought', id: l.id, text: l.text, date: l.date, ts: l.createdAt || 0 })),
      ].sort((a, b) => b.ts - a.ts);

      historyCountEl.textContent = String(merged.length);
      historyListEl.innerHTML = merged.length ? merged.map((h) => `
        <li class="log-row ${h.kind === 'task' ? 'log-row--task-done' : 'log-row--thought'}" data-id="${h.id}" data-kind="${h.kind}">
          <span class="log-row__dot">${h.kind === 'task' ? '&#10003;' : '~'}</span>
          <span class="log-row__text">${escapeHtml(h.text)}</span>
          <span class="task-date">${escapeHtml(dateLabel(h.date))}</span>
          <button class="log-row__delete" aria-label="Delete">&times;</button>
        </li>
      `).join('') : '<p class="empty-hint">Nothing here yet.</p>';

      historyListEl.querySelectorAll('.log-row__delete').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const row = btn.closest('.log-row');
          const id = Number(row.dataset.id);
          badge.saving();
          if (row.dataset.kind === 'task') await deleteTask(id); else await deleteLogItem(id);
          badge.saved();
          refreshAll();
        });
      });
    }

    async function refreshAll() {
      await Promise.all([refreshOpen(), refreshHistory()]);
    }
    await refreshAll();

    const historyToggle = view.querySelector('#history-toggle');
    const historyBody = view.querySelector('#history-body');
    historyToggle.addEventListener('click', () => {
      const opening = historyBody.hidden;
      historyBody.hidden = !opening;
      historyToggle.setAttribute('aria-expanded', String(opening));
      historyToggle.classList.toggle('is-open', opening);
    });

    async function submitWith(addFn) {
      const text = captureInput.value.trim();
      if (!text) return;
      badge.saving();
      await addFn(date, text);
      badge.saved();
      captureInput.value = '';
      refreshAll();
    }
    view.querySelector('#capture-task-btn').addEventListener('click', () => submitWith(addTask));
    view.querySelector('#capture-did-btn').addEventListener('click', () => submitWith(addDoneTask));
    view.querySelector('#capture-thought-btn').addEventListener('click', () => submitWith(addThought));
    captureInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submitWith(addTask); } });
  } catch (err) {
    console.warn('tasks view failed', err);
    view.querySelector('#tasks-scroll').innerHTML = '<p class="empty-hint">Something went wrong loading tasks. Try reloading.</p>';
  }

  if (pendingAction === 'task') captureInput.focus();
}
