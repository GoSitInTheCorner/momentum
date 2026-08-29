// views/journal.js -- the deep daily-reflection tab, restructured in v2.2 around a
// dedicated FULL-SCREEN writing view (see renderJournalWrite below): the only things on
// screen while actually writing are the full date + the textarea + a Back/Done control
// -- no sliders, tags, or logs, and the tab bar is hidden for it (app.js). The Journal
// tab itself is a "hub": [ Entries | Beliefs ] segmented toggle; Entries leads with a
// compact "Today" card + past entries, with the mood/health/emotions/done-learned
// check-in tucked under a collapsible "Daily check-in" (collapsed by default) so the
// hub reads as focused, not a wall of controls.
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
import { escapeHtml, formatDate, formatWeekday, renderMarkdownLite } from '../util.js';

const BELIEF_CATEGORIES = ['political', 'ideology', 'other'];

// Core mood trio: always rendered first, in this exact order, regardless of the
// stored healthDims array order (v2.1 -- Burchard's 10 Life Areas).
const CORE_HEALTH_KEYS = ['mental', 'emotional', 'physical'];

// Rotating daily-prompt suggestions -- shared with today.js (Home's one-line reflection
// prompt reuses promptsForToday()[0] above the "Write today's entry" CTA, and the
// full-screen writing view offers all 3 as tappable placeholder suggestions), so this
// lives in exactly one place.
const JOURNAL_PROMPTS = [
  'What went well today?', 'What is on your mind?', 'What are you grateful for right now?',
  'What felt hard today, and why?', 'What is one thing you want to remember about today?',
];
export function promptsForToday() {
  const dayOfYear = Math.floor((Date.now() - new Date(new Date().getFullYear(), 0, 0)) / 86400000);
  return [0, 1, 2].map((i) => JOURNAL_PROMPTS[(dayOfYear + i) % JOURNAL_PROMPTS.length]);
}

export async function renderJournal(root, { segment = 'entries', pendingAction, write, date } = {}) {
  if (write) {
    await renderJournalWrite(root, { date: date || todayStr() });
    return;
  }

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

  await renderEntriesPane(paneEntries, { pendingAction });
  await renderBeliefsPane(paneBeliefs);
}

// ---------------- Full-screen writing view (v2.2) ----------------
// Distraction-free: date header + textarea + Back/Done, nothing else. Autosaves the
// same way the old inline entry did. Entry field always starts EMPTY except for the
// user's own previously-saved text for that date -- the daily prompt is offered only
// as a dynamic placeholder / tappable suggestion, NEVER written into the value, so
// there is never prefilled content the user has to erase before typing.
async function renderJournalWrite(root, { date }) {
  const settings = await getSettings();
  const day = await getDay(date);
  const isToday = date === todayStr();

  const view = document.createElement('div');
  view.className = 'view view--journal-write';
  view.innerHTML = `
    <div class="journal-write__header">
      <button class="icon-btn journal-write__back" id="jw-back" aria-label="Back to Journal">
        <svg viewBox="0 0 24 24" fill="none"><path d="M15 5l-7 7 7 7" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </button>
      <div class="journal-write__header-actions">
        <button class="icon-btn" id="jw-emo-btn" aria-label="Insert feeling word" title="Insert a feeling word">&#9786;</button>
        <button type="button" class="journal-write__done" id="jw-done">Done</button>
      </div>
    </div>
    <h1 class="journal-write__date">${escapeHtml(formatWeekday(date))}</h1>
    <div class="journal-write__body">
      <div class="journal-write__prompts" id="jw-prompts" hidden></div>
      <textarea class="journal-input journal-write__textarea" id="jw-textarea" placeholder="What's on your mind today?" style="font-family:var(--journal-font); font-size:calc(1.05rem * var(--journal-scale));"></textarea>
      <div class="autosave-hint journal-write__hint" id="jw-hint">&nbsp;</div>
    </div>
  `;
  root.appendChild(view);

  const goBack = () => { location.hash = '#/journal?segment=entries'; };
  view.querySelector('#jw-back').addEventListener('click', goBack);
  view.querySelector('#jw-done').addEventListener('click', goBack);

  const badge = wireAutosave(view.querySelector('#jw-hint'));
  const textarea = view.querySelector('#jw-textarea');
  textarea.value = day.journal || ''; // real saved text only -- never a prompt

  view.querySelector('#jw-emo-btn').addEventListener('click', () => {
    openEmotionBank({
      mode: 'insert',
      onInsert: (word) => {
        const start = textarea.selectionStart ?? textarea.value.length;
        const end = textarea.selectionEnd ?? textarea.value.length;
        textarea.value = textarea.value.slice(0, start) + word + textarea.value.slice(end);
        textarea.focus();
        textarea.selectionStart = textarea.selectionEnd = start + word.length;
        textarea.dispatchEvent(new Event('input'));
      },
    });
  });

  const promptsEl = view.querySelector('#jw-prompts');
  if (isToday && settings.dailyPrompt && !textarea.value.trim()) {
    const prompts = promptsForToday();
    textarea.placeholder = prompts[0];
    promptsEl.hidden = false;
    promptsEl.innerHTML = prompts.map((p) => `<button type="button" class="preset-chip">${escapeHtml(p)}</button>`).join('');
    promptsEl.querySelectorAll('.preset-chip').forEach((chip) => {
      chip.addEventListener('click', () => {
        // Tapping a suggestion sets it as the field's placeholder and focuses the
        // field -- it never writes into the value, so there's nothing to erase.
        textarea.placeholder = chip.textContent;
        textarea.focus();
      });
    });
  }

  let debounceTimer = null;
  textarea.addEventListener('input', () => {
    promptsEl.hidden = true;
    badge.saving();
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(async () => {
      await saveDay(date, { journal: textarea.value });
      badge.saved();
    }, 500);
  });

  setTimeout(() => textarea.focus(), 60);
}

// ---------------- Entries pane (hub) ----------------
async function renderEntriesPane(pane, { pendingAction } = {}) {
  const settings = await getSettings();
  const date = todayStr();
  const yDate = addDays(date, -1);
  const day = await getDay(date);
  const yDay = await getDay(yDate);
  const hasEntryToday = !!(day.journal && day.journal.trim());

  pane.innerHTML = `
    <div class="search-bar">
      <svg viewBox="0 0 24 24" fill="none" class="search-bar__icon"><circle cx="10.5" cy="10.5" r="6.5" stroke="currentColor" stroke-width="1.8"/><path d="M20 20l-4.5-4.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
      <input type="text" placeholder="Search your journal..." id="journal-search" />
    </div>
    <div class="scroll-area">
      <section class="card journal-today-card" id="journal-today-card">
        <div class="journal-today-card__date">${escapeHtml(formatWeekday(date))}</div>
        <p class="journal-today-card__preview">${hasEntryToday ? escapeHtml(day.journal.slice(0, 140)) : 'No entry yet today.'}</p>
        <button class="btn btn--home-cta" id="write-today-btn">${hasEntryToday ? 'Continue writing' : "Write today's entry"} &rarr;</button>
      </section>

      <section class="card">
        <button type="button" class="checkin-toggle is-open" id="checkin-toggle" aria-expanded="true">
          <span>Daily check-in</span>
          <span class="checkin-toggle__chevron" aria-hidden="true">&#9662;</span>
        </button>
        <div class="checkin-body" id="checkin-body">
          <div class="card__title-row"><h2 class="card__title">How are you?</h2></div>
          <div class="health-row" id="health-row"></div>
          <button type="button" class="life-areas-toggle" id="life-areas-toggle" hidden>
            <span id="life-areas-toggle-label">Rate more life areas</span>
            <span class="life-areas-toggle__chevron" aria-hidden="true">&#9662;</span>
          </button>
          <div class="health-row--expand" id="health-row-expand" hidden></div>
          <div class="emo-tag-mount" id="emo-tag-mount"></div>

          <div class="field-label">Done &amp; learned</div>
          <div class="log-actions">
            <button class="chip-btn chip-btn--done" id="add-done-btn">&#9679; I did...</button>
            <button class="chip-btn chip-btn--learned" id="add-learned-btn">&#9670; I learned...</button>
          </div>
          <ul class="log-list" id="log-list"></ul>
          <div class="autosave-hint" id="journal-hint">&nbsp;</div>
        </div>
      </section>

      <ul class="entry-list" id="entry-list"></ul>
      <p class="empty-hint" id="entry-empty" hidden>No entries yet. Start writing above.</p>
      <div class="scroll-spacer"></div>
    </div>
  `;

  pane.querySelector('#write-today-btn').addEventListener('click', () => {
    location.hash = '#/journal?write=1';
  });

  // Shared "Saving… / Saved ✓" badge for the check-in block (sliders + log adds).
  const hint = pane.querySelector('#journal-hint');
  const badge = wireAutosave(hint);

  const checkinToggle = pane.querySelector('#checkin-toggle');
  const checkinBody = pane.querySelector('#checkin-body');
  checkinToggle.addEventListener('click', () => {
    const opening = checkinBody.hidden;
    checkinBody.hidden = !opening;
    checkinToggle.setAttribute('aria-expanded', String(opening));
    checkinToggle.classList.toggle('is-open', opening);
  });

  // ---- Health sliders ----
  // Smart prefill: default each slider to *yesterday's* rating for that dimension when
  // today has none yet; fall back to the scale midpoint only if yesterday has no data
  // either. Still fully draggable/editable -- nothing here is written until touched.
  function makeHealthSlider(dim) {
    const todayVal = day.ratings?.[dim.key];
    const prefill = typeof todayVal === 'number' ? todayVal : yDay.ratings?.[dim.key];
    return createHealthSlider({
      key: dim.key, label: dim.label, value: prefill, scale: settings.ratingScale,
      onChange: async (v) => {
        badge.saving();
        const cur = await getDay(date);
        await saveDay(date, { ratings: { ...cur.ratings, [dim.key]: v } });
        badge.saved();
      },
    });
  }

  const healthRow = pane.querySelector('#health-row');
  const byKey = new Map(settings.healthDims.map((d) => [d.key, d]));
  // Core 3 always render first, in this fixed order -- never rely on stored array order.
  for (const key of CORE_HEALTH_KEYS) {
    const dim = byKey.get(key);
    if (dim && dim.enabled) healthRow.appendChild(makeHealthSlider(dim).el);
  }
  // Any non-core area the user has explicitly enabled in Settings joins the
  // always-visible row too (in stored order) -- enabling an area promotes it here.
  const enabledExtras = settings.healthDims.filter((d) => !CORE_HEALTH_KEYS.includes(d.key) && d.enabled);
  for (const dim of enabledExtras) healthRow.appendChild(makeHealthSlider(dim).el);

  // Every remaining disabled area -- core or non-core -- is still always reachable --
  // never hidden behind Settings -- via a collapsed, lazy-mounted "Rate more life
  // areas" group. They don't exist in the DOM at all until first expanded. Row = all
  // enabled dims, expander = all disabled dims -- always disjoint, never both/neither.
  const otherDims = settings.healthDims.filter((d) => !d.enabled);
  const expandToggle = pane.querySelector('#life-areas-toggle');
  const expandToggleLabel = pane.querySelector('#life-areas-toggle-label');
  const expandRow = pane.querySelector('#health-row-expand');
  if (otherDims.length) {
    expandToggle.hidden = false;
    expandToggleLabel.textContent = `Rate more life areas (${otherDims.length})`;
    let mounted = false;
    expandToggle.addEventListener('click', () => {
      const opening = expandRow.hidden;
      if (opening && !mounted) {
        for (const dim of otherDims) expandRow.appendChild(makeHealthSlider(dim).el);
        mounted = true;
      }
      expandRow.hidden = !opening;
      expandToggle.classList.toggle('is-open', opening);
      expandToggleLabel.textContent = opening ? 'Show fewer life areas' : `Rate more life areas (${otherDims.length})`;
    });
  }

  // Emotion tags for today, next to the health sliders (one shared component).
  mountEmotionTagRow(pane.querySelector('#emo-tag-mount'), { date, tags: day.emotions || [] });

  // ---- Done / learned log ----
  // getLogForDate() returns every logItems type for the date, including the Tasks
  // tab's 'thought' entries (v2.5) -- filter down to this section's own two types so a
  // thought doesn't leak into the "I did.../I learned..." list it's not part of.
  async function refreshLog() {
    const items = (await getLogForDate(date)).filter((i) => i.type === 'done' || i.type === 'learned');
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

  // ---- Handle FAB pending action (routed here via #/journal?segment=entries&action=X)
  // -- both actions live inside the collapsible check-in, so expand it first.
  if (pendingAction === 'done' || pendingAction === 'learned') {
    checkinBody.hidden = false;
    checkinToggle.setAttribute('aria-expanded', 'true');
    checkinToggle.classList.add('is-open');
  }
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
  const [tasks, rawLog, day] = await Promise.all([getTasksForDate(date), getLogForDate(date), getDay(date)]);
  // Same 'thought' leak as refreshLog() above -- this section is captioned "Done &
  // learned", so keep it to those two types only.
  const log = rawLog.filter((i) => i.type === 'done' || i.type === 'learned');

  openFormSheet({
    title: formatWeekday(date),
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
