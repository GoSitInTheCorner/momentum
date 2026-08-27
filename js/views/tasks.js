// views/tasks.js -- the "do" tab: today's to-dos (add, check, reorder, goal-link).
// Moved off Goals in v2.2 so Goals is goals/milestones only (see docs/SPEC.md v2.2).
// Reuses components/tasklist.js's createTaskSection -- the same drag/carryover/goal-link
// implementation Goals used to own, now with exactly one importer here (plus the
// compact read/check/quick-add card on Home, which intentionally stays lighter-weight).
import { getGoals, getRecentTaskTexts, addTask } from '../store.js';
import { todayStr, addDays } from '../db.js';
import { openPrompt } from '../components/sheet.js';
import { createTaskSection } from '../components/tasklist.js';
import { wireAutosave } from '../components/savebadge.js';

export async function renderTasks(root, { pendingAction } = {}) {
  const date = todayStr();
  const yDate = addDays(date, -1);

  const view = document.createElement('div');
  view.className = 'view view--tasks';
  view.innerHTML = `
    <header class="topbar">
      <div class="topbar__eyebrow">Get it done</div>
      <h1 class="topbar__title">Tasks</h1>
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
      <div class="scroll-spacer"></div>
    </div>
  `;
  root.appendChild(view);

  const goals = await getGoals();
  const badge = wireAutosave(view.querySelector('#task-hint'));
  const taskSection = createTaskSection({ root: view, date, yDate, goals, badge });
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
}
