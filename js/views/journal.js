// views/journal.js -- the deep daily-reflection tab. Two segments in one screen:
// "Entries" (today's write-in-place reflection block, THEN search + reverse-chron list
// + day detail) and "Beliefs" (topics with dated stance history). A local segmented
// toggle, not a 6th tab -- the bottom bar stays at 5 tabs per spec.
import {
  getAllDaysSorted, getTasksForDate, getLogForDate, saveDay, getDay, getSettings,
  addLogItem, deleteLogItem,
} from '../store.js';
import {
  getBeliefs, getBelief, addBelief, updateBeliefStanceText, addStanceUpdate, deleteBelief,
  getLastUsedBeliefCategory, getRecentBeliefTopics,
} from '../store.js';
import { todayStr, addDays } from '../db.js';
import { openFormSheet, openPrompt } from '../components/sheet.js';
import { openEmotionBank, mountEmotionTagRow } from '../components/emotionbank.js';
import { createHealthSlider } from '../components/slider.js';
import { wireAutosave } from '../components/savebadge.js';
import { escapeHtml, formatDate, renderMarkdownLite } from '../util.js';

const BELIEF_CATEGORIES = ['political', 'ideology', 'other'];

// Rotating daily-prompt suggestions -- shared with today.js (Home's one-line reflection
// prompt reuses promptsForToday()[0] above the "Write today's entry" CTA), so this lives
// in exactly one place.
const JOURNAL_PROMPTS = [
  'What went well today?', 'What is on your mind?', 'What are you grateful for right now?',
  'What felt hard today, and why?', 'What is one thing you want to remember about today?',
];
export function promptsForToday() {
  const dayOfYear = Math.floor((Date.now() - new Date(new Date().getFullYear(), 0, 0)) / 86400000);
  return [0, 1, 2].map((i) => JOURNAL_PROMPTS[(dayOfYear + i) % JOURNAL_PROMPTS.length]);
}

export async function renderJournal(root, { segment = 'entries', pendingAction, focus } = {}) {
  const view = document.createElement('div');
  view.className = 'view view--journal';
  view.innerHTML = `
    <header class="topbar">
      <div class="topbar__eyebrow">Reflect</div>
      <h1 class="topbar__title">Journal</h1>
    </header>
    <div class="segmented" id="journal-segmented">
      <button class="segmented__btn" data-segment="entries">Entries</button>
      <button class="segmented__btn" data-segment="beliefs">Beliefs</button>
    </div>
    <div class="segment-pane" id="pane-entries"></div>
    <div class="segment-pane" id="pane-beliefs" hidden></div>
  `;
  root.appendChild(view);

  const seg = view.querySelector('#journal-segmented');
  const paneEntries = view.querySelector('#pane-entries');
  const paneBeliefs = view.querySelector('#pane-beliefs');

  function setSegment(id) {
    seg.querySelectorAll('.segmented__btn').forEach((b) => b.classList.toggle('is-active', b.dataset.segment === id));
    paneEntries.hidden = id !== 'entries';
    paneBeliefs.hidden = id !== 'beliefs';
  }
  seg.addEventListener('click', (e) => {
    const btn = e.target.closest('.segmented__btn');
    if (btn) setSegment(btn.dataset.segment);
  });
  setSegment(segment);

  await renderEntriesPane(paneEntries, { pendingAction, focus });
  await renderBeliefsPane(paneBeliefs);
}

// ---------------- Entries pane ----------------
async function renderEntriesPane(pane, { pendingAction, focus } = {}) {
  const settings = await getSettings();
  const date = todayStr();
  const yDate = addDays(date, -1);

  pane.innerHTML = `
    <div class="search-bar">
      <svg viewBox="0 0 24 24" fill="none" class="search-bar__icon"><circle cx="10.5" cy="10.5" r="6.5" stroke="currentColor" stroke-width="1.8"/><path d="M20 20l-4.5-4.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
      <input type="text" placeholder="Search your journal..." id="journal-search" />
    </div>
    <div class="scroll-area">
      <section class="card journal-card" id="today-reflect-card">
        <div class="card__title-row">
          <h2 class="card__title">Today's entry</h2>
          <button class="icon-btn" id="journal-emo-btn" aria-label="Insert feeling word" title="Insert a feeling word">&#9786;</button>
        </div>
        <div class="journal-prompts" id="journal-prompts" hidden></div>
        <textarea class="journal-input" id="journal-textarea" placeholder="What's on your mind today?" style="font-family:var(--journal-font); font-size:calc(1rem * var(--journal-scale));"></textarea>
        <div class="autosave-hint" id="journal-hint">&nbsp;</div>
      </section>

      <section class="card">
        <div class="card__title-row">
          <h2 class="card__title">How are you?</h2>
        </div>
        <div class="health-row" id="health-row"></div>
        <div class="emo-tag-mount" id="emo-tag-mount"></div>
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

      <ul class="entry-list" id="entry-list"></ul>
      <p class="empty-hint" id="entry-empty" hidden>No entries yet. Start writing above.</p>
      <div class="scroll-spacer"></div>
    </div>
  `;

  // One shared "Saving… / Saved ✓" badge for the whole reflection block (journal text,
  // sliders, log adds) -- matches the old single journal-hint UX, just now covering more.
  const hint = pane.querySelector('#journal-hint');
  const badge = wireAutosave(hint);

  // ---- Journal textarea ----
  const day = await getDay(date);
  const yDay = await getDay(yDate);
  const journalInput = pane.querySelector('#journal-textarea');
  journalInput.value = day.journal || '';
  const promptsEl = pane.querySelector('#journal-prompts');

  let debounceTimer = null;
  journalInput.addEventListener('input', () => {
    promptsEl.hidden = true;
    badge.saving();
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(async () => {
      await saveDay(date, { journal: journalInput.value });
      badge.saved();
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

  pane.querySelector('#journal-emo-btn').addEventListener('click', () => {
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

  if (focus) {
    pane.querySelector('#today-reflect-card').scrollIntoView({ block: 'start' });
    setTimeout(() => journalInput.focus(), 50);
  }

  // ---- Health sliders ----
  // Smart prefill: default each slider to *yesterday's* rating for that dimension when
  // today has none yet; fall back to the scale midpoint only if yesterday has no data
  // either. Still fully draggable/editable -- nothing here is written until touched.
  const healthRow = pane.querySelector('#health-row');
  for (const dim of settings.healthDims.filter((d) => d.enabled)) {
    const todayVal = day.ratings?.[dim.key];
    const prefill = typeof todayVal === 'number' ? todayVal : yDay.ratings?.[dim.key];
    const slider = createHealthSlider({
      key: dim.key, label: dim.label, value: prefill, scale: settings.ratingScale,
      onChange: async (v) => {
        badge.saving();
        const cur = await getDay(date);
        await saveDay(date, { ratings: { ...cur.ratings, [dim.key]: v } });
        badge.saved();
      },
    });
    healthRow.appendChild(slider.el);
  }

  // Emotion tags for today, next to the health sliders (one shared component).
  mountEmotionTagRow(pane.querySelector('#emo-tag-mount'), { date, tags: day.emotions || [] });

  // ---- Done / learned log ----
  async function refreshLog() {
    const items = await getLogForDate(date);
    const listEl = pane.querySelector('#log-list');
    listEl.innerHTML = items.map((i) => `
      <li class="log-row log-row--${i.type}" data-id="${i.id}">
        <span class="log-row__dot">${i.type === 'done' ? '&#9679;' : '&#9670;'}</span>
        <span class="log-row__text">${escapeHtml(i.text)}</span>
        <button class="log-row__delete" aria-label="Delete">&times;</button>
      </li>
    `).join('');
    listEl.querySelectorAll('.log-row__delete').forEach((btn) => {
      btn.addEventListener('click', async () => {
        badge.saving();
        await deleteLogItem(Number(btn.closest('.log-row').dataset.id));
        badge.saved();
        refreshLog();
      });
    });
  }
  pane.querySelector('#add-done-btn').addEventListener('click', () => {
    openPrompt({
      title: 'I did...', placeholder: 'e.g. Went for a 20-min run', confirmLabel: 'Log it',
      onSubmit: async (text) => { badge.saving(); await addLogItem(date, 'done', text); badge.saved(); refreshLog(); },
    });
  });
  pane.querySelector('#add-learned-btn').addEventListener('click', () => {
    openPrompt({
      title: 'I learned...', placeholder: 'e.g. Async/await pitfalls in JS', confirmLabel: 'Log it',
      onSubmit: async (text) => { badge.saving(); await addLogItem(date, 'learned', text); badge.saved(); refreshLog(); },
    });
  });
  await refreshLog();

  // ---- Handle FAB pending action (routed here via #/journal?segment=entries&action=X) ----
  if (pendingAction === 'done') pane.querySelector('#add-done-btn').click();
  if (pendingAction === 'learned') pane.querySelector('#add-learned-btn').click();

  // ---- Entries list + search ----
  const days = (await getAllDaysSorted()).filter((d) => (d.journal && d.journal.trim()) || Object.keys(d.ratings || {}).length);
  const listEl = pane.querySelector('#entry-list');
  pane.querySelector('#entry-empty').hidden = days.length > 0;

  function draw(items) {
    listEl.innerHTML = items.map((d) => `
      <li class="entry-row" data-date="${d.date}">
        <div class="entry-row__date">${formatDate(d.date, settings.dateFormat)}</div>
        <div class="entry-row__preview">${d.journal && d.journal.trim() ? escapeHtml(d.journal.slice(0, 90)) : '<span class="entry-row__muted">No journal text -- ratings/log only</span>'}</div>
      </li>
    `).join('');
    listEl.querySelectorAll('.entry-row').forEach((row) => {
      row.addEventListener('click', () => openDayDetail(row.dataset.date, settings));
    });
  }
  draw(days);

  pane.querySelector('#journal-search').addEventListener('input', (e) => {
    const q = e.target.value.trim().toLowerCase();
    draw(q ? days.filter((d) => (d.journal || '').toLowerCase().includes(q) || d.date.includes(q)) : days);
  });
}

// Exported so Home's calendar (and anywhere else) can open the same day-detail sheet
// instead of duplicating this markup.
export async function openDayDetail(date, settings) {
  const [tasks, log, day] = await Promise.all([getTasksForDate(date), getLogForDate(date), getDay(date)]);

  openFormSheet({
    title: formatDate(date, settings.dateFormat),
    mount: (body) => {
      body.innerHTML = `
        <div class="day-detail">
          <div class="field-label-row">
            <label class="field-label">Journal</label>
            <div class="field-label-row__actions">
              <button class="icon-btn" id="dd-emo-btn" aria-label="Insert feeling word" title="Insert a feeling word">&#9786;</button>
              ${settings.markdownRender ? `<button class="icon-btn" id="dd-edit-toggle" aria-label="Edit journal text" title="Edit">&#9998;</button>` : ''}
            </div>
          </div>
          ${settings.markdownRender ? `<div class="day-detail__journal-rendered" id="dd-journal-rendered"></div>` : ''}
          <textarea class="journal-input day-detail__journal" style="font-family:var(--journal-font);" ${settings.markdownRender ? 'hidden' : ''}>${escapeHtml(day.journal || '')}</textarea>

          <label class="field-label">Feelings tagged that day</label>
          <div id="dd-emo-mount"></div>

          <label class="field-label">Health ratings</label>
          <div class="day-detail__ratings">
            ${settings.healthDims.filter((d) => d.enabled).map((d) => `
              <div class="day-detail__rating"><b>${day.ratings?.[d.key] ?? '&mdash;'}</b><small>${d.label}</small></div>
            `).join('')}
          </div>

          <label class="field-label">To-dos</label>
          ${tasks.length ? `<ul class="day-detail__list">${tasks.map((t) => `<li class="${t.done ? 'is-done' : ''}">${t.done ? '&#10003;' : '&#9675;'} ${escapeHtml(t.text)}</li>`).join('')}</ul>` : `<p class="empty-hint">No to-dos that day.</p>`}

          <label class="field-label">Done &amp; learned</label>
          ${log.length ? `<ul class="day-detail__list">${log.map((i) => `<li>${i.type === 'done' ? '&#9679;' : '&#9670;'} ${escapeHtml(i.text)}</li>`).join('')}</ul>` : `<p class="empty-hint">Nothing logged that day.</p>`}
        </div>
      `;
      const ta = body.querySelector('.day-detail__journal');
      const renderedEl = body.querySelector('#dd-journal-rendered');
      function updateRendered() {
        if (!renderedEl) return;
        renderedEl.innerHTML = ta.value.trim()
          ? renderMarkdownLite(ta.value)
          : '<span class="entry-row__muted">No journal text yet.</span>';
      }
      let t;
      ta.addEventListener('input', () => {
        clearTimeout(t);
        t = setTimeout(() => { saveDay(date, { journal: ta.value }); updateRendered(); }, 500);
      });
      if (settings.markdownRender) {
        updateRendered();
        body.querySelector('#dd-edit-toggle').addEventListener('click', () => {
          const switchingToEdit = ta.hidden;
          ta.hidden = !switchingToEdit;
          renderedEl.hidden = switchingToEdit;
          if (switchingToEdit) ta.focus(); else updateRendered();
        });
      }
      body.querySelector('#dd-emo-btn').addEventListener('click', () => {
        openEmotionBank({
          mode: 'insert',
          onInsert: (word) => {
            const start = ta.selectionStart ?? ta.value.length;
            const end = ta.selectionEnd ?? ta.value.length;
            ta.value = ta.value.slice(0, start) + word + ta.value.slice(end);
            ta.dispatchEvent(new Event('input'));
          },
        });
      });
      mountEmotionTagRow(body.querySelector('#dd-emo-mount'), { date, tags: day.emotions || [] });
    },
  });
}

// ---------------- Beliefs pane ----------------
async function renderBeliefsPane(pane) {
  pane.innerHTML = `
    <div class="scroll-area">
      <div class="card__title-row beliefs-header">
        <h2 class="card__title">Your topics</h2>
        <button class="chip-btn" id="new-belief-btn">+ New topic</button>
      </div>
      <ul class="belief-list" id="belief-list"></ul>
      <p class="empty-hint" id="belief-empty" hidden>No topics yet -- add one to start tracking how your views evolve.</p>
      <div class="scroll-spacer"></div>
    </div>
  `;

  async function refresh() {
    const beliefs = await getBeliefs();
    const listEl = pane.querySelector('#belief-list');
    pane.querySelector('#belief-empty').hidden = beliefs.length > 0;
    listEl.innerHTML = beliefs.map((b) => `
      <li class="belief-row" data-id="${b.id}">
        <span class="belief-row__badge belief-row__badge--${b.category}">${b.category}</span>
        <div class="belief-row__body">
          <div class="belief-row__title">${escapeHtml(b.topic)}</div>
          <div class="belief-row__stance">${escapeHtml((b.currentStance || '').slice(0, 80)) || '<span class="entry-row__muted">No stance recorded yet</span>'}</div>
        </div>
      </li>
    `).join('');
    listEl.querySelectorAll('.belief-row').forEach((row) => {
      row.addEventListener('click', () => openBeliefDetail(Number(row.dataset.id), refresh));
    });
  }
  await refresh();

  pane.querySelector('#new-belief-btn').addEventListener('click', async () => {
    const [lastCategory, recentTopics] = await Promise.all([getLastUsedBeliefCategory(), getRecentBeliefTopics(5)]);
    openFormSheet({
      title: 'New topic',
      mount: (body, close) => {
        body.innerHTML = `
          ${recentTopics.length ? `
            <label class="field-label">Recent topics</label>
            <div class="sheet__presets">${recentTopics.map((t) => `<button type="button" class="preset-chip" data-topic="${t.replace(/"/g, '&quot;')}">${escapeHtml(t)}</button>`).join('')}</div>
          ` : ''}
          <label class="field-label">Topic</label>
          <input type="text" class="text-field" id="nb-topic" placeholder="e.g. Universal basic income" />

          <label class="field-label">Category</label>
          <div class="chip-select" id="nb-category">
            ${BELIEF_CATEGORIES.map((c) => `<button type="button" class="chip-select__opt ${c === lastCategory ? 'is-selected' : ''}" data-cat="${c}">${c}</button>`).join('')}
          </div>

          <label class="field-label">Current stance</label>
          <textarea class="text-field text-field--area" id="nb-stance" placeholder="Where do you stand on this right now?"></textarea>

          <button class="btn btn--primary" id="nb-save">Create topic</button>
        `;
        let category = lastCategory;
        body.querySelectorAll('.preset-chip').forEach((chip) => {
          chip.addEventListener('click', () => { body.querySelector('#nb-topic').value = chip.dataset.topic; });
        });
        body.querySelectorAll('.chip-select__opt').forEach((opt) => {
          opt.addEventListener('click', () => {
            category = opt.dataset.cat;
            body.querySelectorAll('.chip-select__opt').forEach((o) => o.classList.toggle('is-selected', o === opt));
          });
        });
        body.querySelector('#nb-save').addEventListener('click', async () => {
          const topic = body.querySelector('#nb-topic').value.trim();
          if (!topic) { body.querySelector('#nb-topic').focus(); return; }
          const currentStance = body.querySelector('#nb-stance').value.trim();
          const id = await addBelief({ topic, category, currentStance });
          close();
          await refresh();
          openBeliefDetail(id, refresh);
        });
      },
    });
  });
}

async function openBeliefDetail(id, onChange) {
  const belief = await getBelief(id);
  if (!belief) return;

  openFormSheet({
    title: belief.topic,
    mount: (body, close) => {
      function draw(b) {
        body.innerHTML = `
          <span class="belief-row__badge belief-row__badge--${b.category}">${b.category}</span>
          <label class="field-label">Current stance</label>
          <textarea class="text-field text-field--area" id="bd-stance">${escapeHtml(b.currentStance || '')}</textarea>
          <div class="autosave-hint" id="bd-hint">&nbsp;</div>

          <button class="btn btn--secondary" id="bd-update-toggle">+ Add stance update</button>
          <div class="stance-update-form" id="bd-update-form" hidden>
            <label class="field-label">New stance</label>
            <textarea class="text-field text-field--area" id="bd-new-stance">${escapeHtml(b.currentStance || '')}</textarea>
            <label class="field-label">Why did it change? (optional)</label>
            <textarea class="text-field text-field--area" id="bd-note" placeholder="What changed your mind?"></textarea>
            <button class="btn btn--primary" id="bd-save-update">Save update</button>
          </div>

          <label class="field-label">History</label>
          ${b.history && b.history.length ? `
            <ul class="belief-history">
              ${[...b.history].reverse().map((h) => `
                <li class="belief-history__item">
                  <div class="belief-history__date">${escapeHtml(h.date)}</div>
                  <div class="belief-history__stance">${escapeHtml(h.stance)}</div>
                  ${h.note ? `<div class="belief-history__note">${escapeHtml(h.note)}</div>` : ''}
                </li>
              `).join('')}
            </ul>
          ` : `<p class="empty-hint">No history yet -- once you add a stance update, prior stances will appear here.</p>`}

          <button class="btn btn--danger" id="bd-delete">Delete topic</button>
        `;

        const stanceField = body.querySelector('#bd-stance');
        const hint = body.querySelector('#bd-hint');
        const badge = wireAutosave(hint);
        let t;
        stanceField.addEventListener('input', () => {
          badge.saving();
          clearTimeout(t);
          t = setTimeout(async () => {
            await updateBeliefStanceText(b.id, stanceField.value);
            badge.saved();
          }, 500);
        });

        const toggle = body.querySelector('#bd-update-toggle');
        const form = body.querySelector('#bd-update-form');
        toggle.addEventListener('click', () => { form.hidden = !form.hidden; });

        body.querySelector('#bd-save-update').addEventListener('click', async () => {
          const stance = body.querySelector('#bd-new-stance').value.trim();
          const note = body.querySelector('#bd-note').value.trim();
          if (!stance) return;
          await addStanceUpdate(b.id, { stance, note });
          const fresh = await getBelief(b.id);
          draw(fresh);
          onChange?.();
        });

        body.querySelector('#bd-delete').addEventListener('click', async () => {
          await deleteBelief(b.id);
          close();
          onChange?.();
        });
      }
      draw(belief);
    },
  });
}
