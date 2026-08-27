// views/journal.js -- two segments in one screen: "Entries" (daily journal list +
// search + day detail) and "Beliefs" (topics with dated stance history). A local
// segmented toggle, not a 6th tab -- the bottom bar stays at 5 tabs per spec.
import { getAllDaysSorted, getTasksForDate, getLogForDate, saveDay, getDay, getSettings } from '../store.js';
import {
  getBeliefs, getBelief, addBelief, updateBeliefStanceText, addStanceUpdate, deleteBelief,
  getLastUsedBeliefCategory, getRecentBeliefTopics,
} from '../store.js';
import { openFormSheet, openPrompt } from '../components/sheet.js';
import { openEmotionBank, mountEmotionTagRow } from '../components/emotionbank.js';
import { escapeHtml, formatDate, renderMarkdownLite } from '../util.js';

const BELIEF_CATEGORIES = ['political', 'ideology', 'other'];

export async function renderJournal(root, { segment = 'entries' } = {}) {
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

  await renderEntriesPane(paneEntries);
  await renderBeliefsPane(paneBeliefs);
}

// ---------------- Entries pane ----------------
async function renderEntriesPane(pane) {
  pane.innerHTML = `
    <div class="search-bar">
      <svg viewBox="0 0 24 24" fill="none" class="search-bar__icon"><circle cx="10.5" cy="10.5" r="6.5" stroke="currentColor" stroke-width="1.8"/><path d="M20 20l-4.5-4.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
      <input type="text" placeholder="Search your journal..." id="journal-search" />
    </div>
    <div class="scroll-area">
      <ul class="entry-list" id="entry-list"></ul>
      <p class="empty-hint" id="entry-empty" hidden>No entries yet. Start writing on Today.</p>
      <div class="scroll-spacer"></div>
    </div>
  `;

  const settings = await getSettings();
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

async function openDayDetail(date, settings) {
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
        let t;
        stanceField.addEventListener('input', () => {
          hint.textContent = 'Saving...';
          clearTimeout(t);
          t = setTimeout(async () => {
            await updateBeliefStanceText(b.id, stanceField.value);
            hint.textContent = 'Saved';
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
