// views/tasks.js -- the "do" tab: one capture box (task / did-it / thought) plus a
// persistent "To do" list of every open task across all dates, and a collapsible dated
// "Done & thoughts" history. Reworked in v2.5 off the old today-only view + manual
// "carried over from yesterday" strip (see docs/SPEC.md v2.5) -- drag-reorder and the
// goal-link chip are dropped from these rows to keep the list uncrowded; those fields
// stay intact on the task record, just unrendered here. components/tasklist.js (the
// old drag/carryover/goal-link implementation) is now unused by anything and removed.
import {
  getSettings, getOpenTasks, getDoneTasks, addTask, addDoneTask, toggleTask, deleteTask,
  addThought, getThoughts, deleteLogItem, updateTask,
} from '../store.js';
import { todayStr } from '../db.js';
import { escapeHtml, formatDate, formatDue } from '../util.js';
import { wireAutosave } from '../components/savebadge.js';
import { openFormSheet } from '../components/sheet.js';

// Due-date picker sheet (v2.7) -- opened from the Tasks-tab date chip. Reuses the
// segmented-control markup/wiring pattern from views/settings.js's segButtons() (not
// imported -- that helper is private to settings.js, so this is a small inline copy)
// rather than inventing new markup.
const DUE_MODES = [
  { id: 'datetime', label: 'Date & time' },
  { id: 'year', label: 'Year' },
  { id: 'life', label: 'Life goal' },
  { id: 'date', label: 'Date' },
];

function openDuePicker(task, settings, onSaved) {
  const currentYear = new Date().getFullYear();
  const initialKind = task.dueKind || 'date';

  openFormSheet({
    title: 'Set due date',
    mount(body, close) {
      body.innerHTML = `
        <div class="segmented segmented--settings" id="due-mode-seg">
          ${DUE_MODES.map((o) => `<button type="button" class="segmented__btn ${o.id === initialKind ? 'is-active' : ''}" data-val="${o.id}">${o.label}</button>`).join('')}
        </div>
        <div id="due-fields"></div>
        <button class="btn btn--primary" id="due-save">Save</button>
      `;
      const seg = body.querySelector('#due-mode-seg');
      const fieldsEl = body.querySelector('#due-fields');
      let mode = initialKind;

      function renderFields() {
        if (mode === 'datetime') {
          // Carry over the task's existing calendar date when switching from plain
          // "date" (or a legacy no-dueKind record) into "date & time" -- only fall
          // back to today when the current date is a year/life sentinel, which isn't
          // a real date to prefill from.
          const d = (task.dueKind === 'datetime' || task.dueKind === 'date' || !task.dueKind) ? task.date : todayStr();
          const t = task.dueKind === 'datetime' ? (task.dueTime || '') : '';
          fieldsEl.innerHTML = `
            <label class="field-label">Date</label>
            <input type="date" class="text-field" id="due-date" value="${d}" />
            <label class="field-label">Time</label>
            <input type="time" class="text-field" id="due-time" value="${t}" />
          `;
        } else if (mode === 'year') {
          const y = task.dueKind === 'year' && task.dueYear ? task.dueYear : currentYear;
          const years = [];
          for (let yy = currentYear; yy <= currentYear + 30; yy++) years.push(yy);
          fieldsEl.innerHTML = `
            <label class="field-label">Year</label>
            <select class="text-field" id="due-year">
              ${years.map((yy) => `<option value="${yy}" ${yy === y ? 'selected' : ''}>${yy}</option>`).join('')}
            </select>
          `;
        } else if (mode === 'life') {
          fieldsEl.innerHTML = '<p class="empty-hint">No date needed -- this is a someday/life goal task.</p>';
        } else {
          const d = (task.dueKind === 'date' || !task.dueKind) ? task.date : todayStr();
          fieldsEl.innerHTML = `
            <label class="field-label">Date</label>
            <input type="date" class="text-field" id="due-date" value="${d}" />
          `;
        }
      }
      renderFields();

      seg.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-val]');
        if (!btn) return;
        mode = btn.dataset.val;
        seg.querySelectorAll('.segmented__btn').forEach((b) => b.classList.toggle('is-active', b === btn));
        renderFields();
      });

      body.querySelector('#due-save').addEventListener('click', async () => {
        let patch;
        if (mode === 'datetime') {
          const val = body.querySelector('#due-date').value || todayStr();
          const time = body.querySelector('#due-time').value || null;
          patch = { dueKind: 'datetime', date: val, dueTime: time, dueYear: null };
        } else if (mode === 'year') {
          const y = Number(body.querySelector('#due-year').value);
          patch = { dueKind: 'year', date: `${y}-12-31`, dueYear: y, dueTime: null };
        } else if (mode === 'life') {
          patch = { dueKind: 'life', date: '9999-12-31', dueTime: null, dueYear: null };
        } else {
          const val = body.querySelector('#due-date').value || todayStr();
          patch = { dueKind: 'date', date: val, dueTime: null, dueYear: null };
        }
        await updateTask(task.id, patch);
        close();
        onSaved();
      });
    },
  });
}

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
          <button type="button" class="task-date" data-id="${t.id}">${escapeHtml(formatDue(t, settings))}</button>
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
        row.querySelector('.task-date').addEventListener('click', (e) => {
          e.stopPropagation();
          const t = tasks.find((x) => x.id === id);
          if (t) openDuePicker(t, settings, refreshAll);
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
