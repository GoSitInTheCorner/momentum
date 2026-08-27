// views/goals.js -- the "do" tab: today's to-dos (moved from old Today), then
// create/edit goals, milestone checklists, progress bars.
import {
  getGoals, getGoal, addGoal, updateGoal, deleteGoal, goalProgress, getMostUsedGoalCategory,
  getRecentTaskTexts, addTask,
} from '../store.js';
import { todayStr, addDays } from '../db.js';
import { openFormSheet, openPrompt } from '../components/sheet.js';
import { createTaskSection } from '../components/tasklist.js';
import { wireAutosave } from '../components/savebadge.js';
import { escapeHtml, formatDate } from '../util.js';

export async function renderGoals(root, { pendingAction } = {}) {
  const date = todayStr();
  const yDate = addDays(date, -1);

  const view = document.createElement('div');
  view.className = 'view view--goals';
  view.innerHTML = `
    <header class="topbar">
      <div class="topbar__eyebrow">Building toward</div>
      <h1 class="topbar__title">Goals</h1>
    </header>
    <div class="scroll-area">
      <section class="card">
        <div class="card__title-row">
          <h2 class="card__title">Today's to-dos</h2>
          <button class="chip-btn" id="add-task-btn">+ Add</button>
        </div>
        <div class="carryover" id="carryover" hidden></div>
        <ul class="task-list" id="task-list"></ul>
        <p class="empty-hint" id="task-empty" hidden>Nothing yet -- tap + to add your first to-do.</p>
        <div class="autosave-hint" id="task-hint">&nbsp;</div>
      </section>

      <button class="btn btn--primary goals-new-btn" id="new-goal-btn">+ New goal</button>
      <ul class="goal-list" id="goal-list"></ul>
      <p class="empty-hint" id="goal-empty" hidden>No goals yet. Add one to start building momentum.</p>
      <div class="scroll-spacer"></div>
    </div>
  `;
  root.appendChild(view);

  // ---- Today's to-dos ----
  const goals0 = await getGoals();
  const badge = wireAutosave(view.querySelector('#task-hint'));
  const taskSection = createTaskSection({ root: view, date, yDate, goals: goals0, badge });
  await taskSection.refresh();

  view.querySelector('#add-task-btn').addEventListener('click', async () => {
    const presets = await getRecentTaskTexts(6);
    openPrompt({
      title: 'New to-do', placeholder: 'e.g. Finish project proposal', confirmLabel: 'Add', presets,
      onSubmit: async (text) => {
        badge.saving();
        await addTask(date, text);
        badge.saved();
        taskSection.refresh();
      },
    });
  });

  if (pendingAction === 'task') view.querySelector('#add-task-btn').click();

  // ---- Goals list ----
  async function refresh() {
    const goals = await getGoals();
    const listEl = view.querySelector('#goal-list');
    view.querySelector('#goal-empty').hidden = goals.length > 0;
    const rows = await Promise.all(goals.map(async (g) => {
      const pct = await goalProgress(g);
      return `
        <li class="goal-card" data-id="${g.id}">
          <div class="goal-card__top">
            <span class="goal-card__category">${escapeHtml(g.category || 'General')}</span>
            ${g.targetDate ? `<span class="goal-card__date">${formatDate(g.targetDate)}</span>` : ''}
          </div>
          <h3 class="goal-card__title">${escapeHtml(g.title)}</h3>
          <div class="progress-bar"><div class="progress-bar__fill" style="width:${pct}%"></div></div>
          <div class="goal-card__pct">${pct}% complete</div>
        </li>
      `;
    }));
    listEl.innerHTML = rows.join('');
    listEl.querySelectorAll('.goal-card').forEach((card) => {
      card.addEventListener('click', () => openGoalEditor(Number(card.dataset.id), refresh));
    });
  }
  await refresh();

  view.querySelector('#new-goal-btn').addEventListener('click', () => openGoalEditor(null, refresh));
}

async function openGoalEditor(id, onChange) {
  const goal = id ? await getGoal(id) : null;
  const mostUsedCategory = await getMostUsedGoalCategory();
  const commonCategories = ['Health', 'Career', 'Learning', 'Finance', 'Relationships', 'Personal'];
  const initialCategory = goal?.category || mostUsedCategory || commonCategories[0];

  openFormSheet({
    title: goal ? 'Edit goal' : 'New goal',
    mount: (body, close) => {
      // Render the static form fields exactly once. Milestone add/toggle/delete only
      // ever touches #g-milestones below -- rebuilding the whole form on every
      // milestone edit previously wiped out whatever the user had typed in Title/
      // Notes/Date, since those inputs are uncontrolled DOM nodes, not re-read state.
      let milestones = goal ? [...(goal.milestones || [])] : [];
      let category = initialCategory;

      body.innerHTML = `
        <label class="field-label">Title</label>
        <input type="text" class="text-field" id="g-title" placeholder="e.g. Run a 10k" value="${goal ? escapeHtml(goal.title) : ''}" />

        <label class="field-label">Category</label>
        <div class="chip-select" id="g-category">
          ${commonCategories.map((c) => `<button type="button" class="chip-select__opt ${c === category ? 'is-selected' : ''}" data-cat="${c}">${c}</button>`).join('')}
        </div>

        <label class="field-label">Target date (optional)</label>
        <input type="date" class="text-field" id="g-date" value="${goal?.targetDate || ''}" />

        <label class="field-label">Milestones</label>
        <ul class="milestone-list" id="g-milestones"></ul>
        <div class="milestone-add">
          <input type="text" class="text-field" id="g-new-milestone" placeholder="Add a milestone" />
          <button class="chip-btn" id="g-add-milestone">+ Add</button>
        </div>

        <label class="field-label">Notes</label>
        <textarea class="text-field text-field--area" id="g-notes" placeholder="Why this goal matters, resources, etc.">${goal ? escapeHtml(goal.notes || '') : ''}</textarea>

        <button class="btn btn--primary" id="g-save">${goal ? 'Save changes' : 'Create goal'}</button>
        ${goal ? `<button class="btn btn--danger" id="g-delete">Delete goal</button>` : ''}
      `;

      body.querySelectorAll('.chip-select__opt').forEach((opt) => {
        opt.addEventListener('click', () => {
          category = opt.dataset.cat;
          body.querySelectorAll('.chip-select__opt').forEach((o) => o.classList.toggle('is-selected', o === opt));
        });
      });

      function renderMilestones() {
        const list = body.querySelector('#g-milestones');
        list.innerHTML = milestones.map((m, i) => `
          <li class="milestone-row" data-i="${i}">
            <button class="milestone-check ${m.done ? 'is-done' : ''}" aria-label="Toggle milestone">${m.done ? '&#10003;' : ''}</button>
            <span class="milestone-text">${escapeHtml(m.text)}</span>
            <button class="milestone-delete" aria-label="Remove">&times;</button>
          </li>
        `).join('');
        list.querySelectorAll('.milestone-row').forEach((row) => {
          const i = Number(row.dataset.i);
          row.querySelector('.milestone-check').addEventListener('click', () => {
            milestones[i].done = !milestones[i].done;
            renderMilestones();
          });
          row.querySelector('.milestone-delete').addEventListener('click', () => {
            milestones.splice(i, 1);
            renderMilestones();
          });
        });
      }
      renderMilestones();

      function addMilestone() {
        const input = body.querySelector('#g-new-milestone');
        const text = input.value.trim();
        if (!text) return;
        milestones.push({ text, done: false });
        input.value = '';
        renderMilestones();
      }
      body.querySelector('#g-add-milestone').addEventListener('click', addMilestone);
      body.querySelector('#g-new-milestone').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); addMilestone(); }
      });

      body.querySelector('#g-save').addEventListener('click', async () => {
        const title = body.querySelector('#g-title').value.trim();
        if (!title) { body.querySelector('#g-title').focus(); return; }
        const payload = {
          title, category,
          targetDate: body.querySelector('#g-date').value || null,
          milestones,
          notes: body.querySelector('#g-notes').value.trim(),
        };
        if (goal) await updateGoal(goal.id, payload); else await addGoal(payload);
        close();
        onChange?.();
      });

      const del = body.querySelector('#g-delete');
      if (del) del.addEventListener('click', async () => {
        await deleteGoal(goal.id);
        close();
        onChange?.();
      });
    },
  });
}
