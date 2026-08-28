// views/today.js -- Home: a read-mostly launchpad. Arrive & glance; the one exception
// is the compact "Today's tasks" card (v2.2, check off + quick-add in place). Deeper
// editing lives on Journal (writing + check-in), Tasks (full to-do list), and Goals
// (goals/milestones). See docs/SPEC.md "v2 -- Home as an inviting launchpad" + "v2.2".
import { todayStr, addDays } from '../db.js';
import {
  getSettings, getTasksForDate, getActivityStreak, getDay, getLogForDate, addTask, toggleTask,
} from '../store.js';
import { createHomeCalendar } from '../components/homecalendar.js';
import { getWeather } from '../services/weather.js';
import { getHeadlines } from '../services/news.js';
import { pairsForDate } from '../services/wordpairs.js';
import { lookupWord } from '../services/dictionary.js';
import { moonSignFor } from '../services/moon.js';
import { promptsForToday } from './journal.js';
import { escapeHtml, formatWeekday } from '../util.js';

// ---------------- Astrology (fully offline) ----------------
const ZODIAC = [
  { sign: 'Capricorn', start: [12, 22], end: [1, 19], trait: 'disciplined and ambitious, always building toward something bigger' },
  { sign: 'Aquarius', start: [1, 20], end: [2, 18], trait: 'independent and inventive, drawn to ideas ahead of their time' },
  { sign: 'Pisces', start: [2, 19], end: [3, 20], trait: 'intuitive and compassionate, tuned into others’ feelings' },
  { sign: 'Aries', start: [3, 21], end: [4, 19], trait: 'bold and direct, first to jump in' },
  { sign: 'Taurus', start: [4, 20], end: [5, 20], trait: 'steady and grounded, values comfort and follow-through' },
  { sign: 'Gemini', start: [5, 21], end: [6, 20], trait: 'curious and quick-witted, energized by conversation' },
  { sign: 'Cancer', start: [6, 21], end: [7, 22], trait: 'nurturing and perceptive, guided by feeling' },
  { sign: 'Leo', start: [7, 23], end: [8, 22], trait: 'warm and confident, happiest in the spotlight' },
  { sign: 'Virgo', start: [8, 23], end: [9, 22], trait: 'precise and thoughtful, finds order in the details' },
  { sign: 'Libra', start: [9, 23], end: [10, 22], trait: 'diplomatic and fair, drawn to balance and beauty' },
  { sign: 'Scorpio', start: [10, 23], end: [11, 21], trait: 'intense and resolute, all-or-nothing by nature' },
  { sign: 'Sagittarius', start: [11, 22], end: [12, 21], trait: 'adventurous and optimistic, always eyeing the next horizon' },
];

function sunSignFor(birthDate) {
  const parts = (birthDate || '').split('-').map(Number);
  const m = parts[1], d = parts[2];
  if (!m || !d) return null;
  for (const z of ZODIAC) {
    const [sm, sd] = z.start;
    const [em, ed] = z.end;
    if (sm <= em) {
      if ((m === sm && d >= sd) || (m === em && d <= ed) || (m > sm && m < em)) return z;
    } else {
      // Wraps the year boundary (Capricorn: Dec 22 -> Jan 19).
      if ((m === sm && d >= sd) || (m === em && d <= ed)) return z;
    }
  }
  return null;
}

function moonPhase(date = new Date()) {
  const synodic = 29.53058867;
  const knownNewMoon = Date.UTC(2000, 0, 6, 18, 14, 0); // a known new moon reference
  const diffDays = (date.getTime() - knownNewMoon) / 86400000;
  const age = ((diffDays % synodic) + synodic) % synodic;
  const index = Math.floor((age / synodic) * 8 + 0.5) % 8;
  const names = ['New Moon', 'Waxing Crescent', 'First Quarter', 'Waxing Gibbous', 'Full Moon', 'Waning Gibbous', 'Last Quarter', 'Waning Crescent'];
  const emoji = ['\u{1F311}', '\u{1F312}', '\u{1F313}', '\u{1F314}', '\u{1F315}', '\u{1F316}', '\u{1F317}', '\u{1F318}'];
  return { name: names[index], emoji: emoji[index] };
}

// ---------------- Mood (at-a-glance) ----------------
const MOOD_EMOJI = ['\u{1F61E}', '\u{1F615}', '\u{1F610}', '\u{1F642}', '\u{1F604}'];
function moodFor(day, ratingScale) {
  if (day.emotions && day.emotions.length) return { kind: 'word', value: day.emotions[day.emotions.length - 1] };
  const vals = Object.values(day.ratings || {}).filter((v) => typeof v === 'number');
  if (!vals.length) return null;
  const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
  const max = ratingScale === '5' || ratingScale === 'emoji' ? 5 : 10;
  const idx = Math.max(0, Math.min(MOOD_EMOJI.length - 1, Math.round(((avg - 1) / (max - 1)) * (MOOD_EMOJI.length - 1))));
  return { kind: 'emoji', value: MOOD_EMOJI[idx] };
}

export async function renderToday(root) {
  const settings = await getSettings();
  const date = todayStr();
  const w = settings.homeWidgets || {};

  const view = document.createElement('div');
  view.className = 'view view--today';
  view.innerHTML = `
    <header class="topbar">
      <div class="topbar__row">
        <div class="topbar__eyebrow">${greeting()}</div>
        <div class="topbar__weather" id="w-weather" ${w.weather ? '' : 'hidden'}></div>
      </div>
      <h1 class="topbar__title">${formatHeaderDate(date)}</h1>
    </header>
    <div class="scroll-area">
      <section class="card home-widget home-widget--recap" id="w-recap" hidden></section>

      <section class="card home-widget home-widget--tasks" id="w-tasks" ${w.todayTasks ? '' : 'hidden'}></section>

      <section class="card home-widget home-widget--calendar" id="w-calendar" ${w.calendar ? '' : 'hidden'}>
        <div class="card__title-row"><h2 class="card__title">Your month</h2></div>
        <div id="home-cal-mount"></div>
      </section>

      <section class="card home-cta-card">
        <p class="home-cta__prompt" id="home-prompt">${escapeHtml(promptsForToday()[0])}</p>
        <button class="btn btn--home-cta" id="home-cta-btn">Write today's entry &rarr;</button>
      </section>

      <section class="card home-widget home-widget--news" id="w-news" ${w.news ? '' : 'hidden'}></section>
      <section class="card home-widget home-widget--word" id="w-word" ${w.wordOfDay ? '' : 'hidden'}></section>
      <section class="card home-widget home-widget--astro" id="w-astro" ${w.astrology ? '' : 'hidden'}></section>

      <section class="card home-widget home-widget--glance" id="w-glance" ${w.atAGlance ? '' : 'hidden'}></section>
      <div class="scroll-spacer"></div>
    </div>
  `;
  root.appendChild(view);

  // v2.2 -- the CTA now opens the dedicated full-screen writing view directly (no
  // detour through the Journal hub), see docs/SPEC.md's Journal-writing refinement.
  view.querySelector('#home-cta-btn').addEventListener('click', () => {
    location.hash = '#/journal?write=1';
  });

  if (w.calendar) {
    view.querySelector('#home-cal-mount').appendChild(createHomeCalendar({ settings }));
  }

  // Each widget below fails independently -- a broken one collapses to nothing,
  // it never breaks the rest of the page.
  if (w.weather) renderWeatherWidget(view.querySelector('#w-weather'), settings);
  if (w.news) renderNewsWidget(view.querySelector('#w-news'), settings);
  if (w.wordOfDay) renderWordWidget(view.querySelector('#w-word'), date);
  if (w.astrology) renderAstroWidget(view.querySelector('#w-astro'), settings);
  if (w.todayTasks) renderTasksWidget(view.querySelector('#w-tasks'), date);
  if (w.atAGlance) renderGlanceWidget(view.querySelector('#w-glance'), settings, date);
  if (w.yesterdayRecap !== false) renderRecapWidget(view.querySelector('#w-recap'), settings, date);
}

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

// Header title -- short form so it never wraps to two lines at the 30px display font,
// e.g. "Friday, Aug 28". formatWeekday() (util.js) stays the full "Friday, August 28,
// 2026" form used elsewhere (journal.js).
function formatHeaderDate(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
}

// Morning "Yesterday" recap card -- the first thing you see, before the cutoff hour.
// Surfaces yesterday's wins so the day starts with acknowledgement. Dismissable.
async function renderRecapWidget(el, settings, date) {
  try {
    const yesterday = addDays(date, -1);
    const cutoff = typeof settings.recapCutoff === 'number' ? settings.recapCutoff : 12;
    const dismissed = sessionStorage.getItem('momentum-recap-dismissed') === yesterday;
    if (new Date().getHours() >= cutoff || dismissed) { el.hidden = true; return; }

    const [day, tasks, logs] = await Promise.all([
      getDay(yesterday), getTasksForDate(yesterday), getLogForDate(yesterday),
    ]);
    const doneTasks = tasks.filter((t) => t.done);
    const doneItems = logs.filter((l) => l.type === 'done');
    const learnedItems = logs.filter((l) => l.type === 'learned');
    const hasRatings = day && day.ratings && Object.keys(day.ratings).length > 0;
    const wroteJournal = day && day.journal && day.journal.trim();
    if (!doneTasks.length && !doneItems.length && !learnedItems.length && !hasRatings && !wroteJournal) {
      el.hidden = true; return;
    }
    const mood = moodFor(day || {}, settings.ratingScale);
    const stat = (t) => `<span style="opacity:.72">${t}</span>`;
    el.hidden = false;
    el.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;">
        <div class="topbar__eyebrow">Yesterday &middot; ${escapeHtml(formatWeekday(yesterday))}</div>
        <button class="icon-btn" id="recap-dismiss" aria-label="Dismiss recap">&times;</button>
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:6px 14px;margin-top:4px;font-size:.9rem;">
        ${doneTasks.length ? stat('&#10003; ' + doneTasks.length + ' task' + (doneTasks.length === 1 ? '' : 's') + ' done') : ''}
        ${doneItems.length ? stat(doneItems.length + ' accomplished') : ''}
        ${learnedItems.length ? stat(learnedItems.length + ' learned') : ''}
        ${mood && mood.kind === 'emoji' ? `<span>${mood.value}</span>` : (mood ? stat(escapeHtml(mood.value)) : '')}
      </div>
      ${(doneItems.length || learnedItems.length) ? `
        <ul style="list-style:none;margin:10px 0 0;padding:0;display:flex;flex-direction:column;gap:6px;">
          ${[...doneItems.slice(0, 3), ...learnedItems.slice(0, 2)].map((l) => `
            <li style="display:flex;gap:8px;align-items:baseline;font-size:.92rem;">
              <span style="flex:0 0 auto;width:6px;height:6px;border-radius:50%;background:${l.type === 'learned' ? '#4a6fa5' : '#c1622d'};transform:translateY(-1px);"></span>
              <span>${escapeHtml(l.text)}</span>
            </li>`).join('')}
        </ul>` : ''}
    `;
    el.querySelector('#recap-dismiss').addEventListener('click', () => {
      sessionStorage.setItem('momentum-recap-dismissed', yesterday);
      el.hidden = true;
    });
  } catch (err) {
    console.warn('recap widget failed', err);
    el.hidden = true;
  }
}

// Header weather -- compact icon + temp only (no label/city/skeleton); the header row
// has no room for more, and #w-weather now lives there instead of its own card.
async function renderWeatherWidget(el, settings) {
  try {
    const weather = await getWeather(settings);
    if (!weather) { el.hidden = true; el.innerHTML = ''; return; }
    el.innerHTML = `
      <span class="topbar-weather__icon">${weather.icon}</span>
      <span class="topbar-weather__temp">${weather.temp}&deg;${weather.unit}</span>
    `;
  } catch (err) {
    console.warn('weather widget failed', err);
    el.hidden = true; el.innerHTML = '';
  }
}

async function renderNewsWidget(el, settings) {
  el.innerHTML = `<div class="home-widget__skeleton"><div class="skel-line skel-line--w80"></div><div class="skel-line skel-line--w70"></div></div>`;
  try {
    const headlines = await getHeadlines(settings);
    if (!headlines.length) { el.hidden = true; el.innerHTML = ''; return; }
    el.innerHTML = `
      <div class="card__title-row"><h2 class="card__title">In the news</h2></div>
      <ul class="news-widget__list">
        ${headlines.map((h) => h.url
          ? `<li><a class="news-widget__item" href="${h.url}" target="_blank" rel="noopener noreferrer">${escapeHtml(h.title)}</a></li>`
          : `<li><span class="news-widget__item">${escapeHtml(h.title)}</span></li>`
        ).join('')}
      </ul>
    `;
  } catch (err) {
    console.warn('news widget failed', err);
    el.hidden = true; el.innerHTML = '';
  }
}

// v2.2 -- "Words to sit with": 1-3 opposing contrast pairs, no definitions.
// Each word is tappable -> fills + runs the existing dictionary look-up below (so
// curiosity about a word leads straight to its actual meaning instead of a bundled
// one). See data/wordpairs.json + services/wordpairs.js for the offline pair picker.
async function renderWordWidget(el, date) {
  el.innerHTML = `<div class="home-widget__skeleton"><div class="skel-line skel-line--w50"></div><div class="skel-line skel-line--w90"></div></div>`;
  try {
    const [y, m, d] = date.split('-').map(Number);
    const pairs = await pairsForDate(new Date(y, m - 1, d));
    el.innerHTML = `
      <div class="card__title-row"><h2 class="card__title">Words to sit with</h2></div>
      ${pairs.length ? `
        <div class="wordpairs">
          ${pairs.map((p) => `
            <div class="wordpairs__row">
              <button type="button" class="wordpairs__word" data-word="${escapeHtml(p.a)}">${escapeHtml(p.a)}</button>
              <span class="wordpairs__glyph" aria-hidden="true">&#10231;</span>
              <button type="button" class="wordpairs__word" data-word="${escapeHtml(p.b)}">${escapeHtml(p.b)}</button>
            </div>
          `).join('')}
        </div>
      ` : `<p class="empty-hint">No word pairs available.</p>`}
      <div class="word-lookup">
        <label class="field-label">Look up any word</label>
        <div class="word-lookup__row">
          <input type="text" class="text-field word-lookup__input" id="word-lookup-input" placeholder="e.g. luminous" ${navigator.onLine ? '' : 'disabled'} />
          <button class="chip-btn word-lookup__btn" id="word-lookup-btn" ${navigator.onLine ? '' : 'disabled'}>Look up</button>
        </div>
        ${navigator.onLine ? '' : '<p class="settings-hint">Look-up needs a connection -- the word pairs above still work offline.</p>'}
        <div class="word-lookup__result" id="word-lookup-result"></div>
      </div>
    `;
    const input = el.querySelector('#word-lookup-input');
    const btn = el.querySelector('#word-lookup-btn');
    const resultEl = el.querySelector('#word-lookup-result');
    async function doLookup() {
      const word = input.value.trim();
      if (!word) return;
      resultEl.innerHTML = `<div class="home-widget__skeleton"><div class="skel-line skel-line--w70"></div></div>`;
      const res = await lookupWord(word);
      if (!res.found) {
        resultEl.innerHTML = `<p class="empty-hint">${res.error ? 'Look-up failed -- try again.' : `No definition found for "${escapeHtml(word)}".`}</p>`;
        return;
      }
      resultEl.innerHTML = `
        <div class="word-widget__entry">
          <span class="word-widget__word">${escapeHtml(res.word)}</span>
          <span class="word-widget__pos">${escapeHtml(res.partOfSpeech)}</span>
          <p class="word-widget__def">${escapeHtml(res.definition)}</p>
          ${res.example ? `<p class="word-widget__example">&ldquo;${escapeHtml(res.example)}&rdquo;</p>` : ''}
        </div>
      `;
    }
    el.querySelectorAll('.wordpairs__word').forEach((wbtn) => {
      wbtn.addEventListener('click', () => {
        input.value = wbtn.dataset.word;
        doLookup();
      });
    });
    if (btn) btn.addEventListener('click', doLookup);
    if (input) input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); doLookup(); } });
  } catch (err) {
    console.warn('words-to-sit-with widget failed', err);
    el.hidden = true; el.innerHTML = '';
  }
}

// v2.2 -- adds a natal Moon sign next to the Sun sign (see services/moon.js). Without
// a birth time the Moon sign is approximate (the Moon changes sign every ~2-2.5 days,
// so a birth right at the boundary can land on the wrong side) -- an optional birth
// time in Settings refines it to exact.
function renderAstroWidget(el, settings) {
  try {
    if (!settings.birthDate) {
      // No birthday set yet -- hide the whole card instead of a placeholder; it only
      // appears once the user has entered one in Settings.
      el.hidden = true; el.innerHTML = ''; return;
    }
    const z = sunSignFor(settings.birthDate);
    const moonSign = moonSignFor(settings.birthDate, settings.birthTime);
    const moon = moonPhase(new Date());
    el.innerHTML = `
      <div class="card__title-row"><h2 class="card__title">Astrology</h2></div>
      <div class="astro-row astro-row--split">
        ${z ? `
          <div class="astro-row__block">
            <div class="astro-row__label">Sun sign</div>
            <div class="astro-row__value">${z.sign}</div>
          </div>
        ` : ''}
        ${moonSign ? `
          <div class="astro-row__block">
            <div class="astro-row__label">Moon sign</div>
            <div class="astro-row__value">${moonSign}</div>
          </div>
        ` : ''}
      </div>
      ${z ? `<div class="astro-row__trait">${escapeHtml(z.trait)}</div>` : ''}
      <div class="astro-row">
        <div class="astro-row__block">
          <div class="astro-row__label">Moon today</div>
          <div class="astro-row__value">${moon.emoji} ${moon.name}</div>
        </div>
      </div>
      <p class="settings-hint">Moon sign is approximate${settings.birthTime ? '' : ' -- add a birth time in Settings for an exact reading'}.</p>
      <div class="astro-horoscope astro-horoscope--disabled">
        <span>Daily horoscope</span>
        <small>Connect a source in a future update</small>
      </div>
    `;
  } catch (err) {
    console.warn('astrology widget failed', err);
    el.hidden = true; el.innerHTML = '';
  }
}

// v2.2 -- compact "Today's tasks" card, the one Home widget that's editable in place
// (check off + quick-add). Deliberately its own light-weight renderer rather than
// reusing components/tasklist.js's createTaskSection: no drag-reorder or goal-link
// chip here (those stay on the Tasks tab) -- distinct `home-tasklist` classes so this
// never collides with `.task-list`/`.task-row` styling or selectors used elsewhere.
async function renderTasksWidget(el, date) {
  async function draw() {
    const tasks = await getTasksForDate(date);
    el.innerHTML = `
      <div class="card__title-row"><h2 class="card__title">Today's tasks</h2></div>
      <ul class="home-tasklist" id="home-tasklist"></ul>
      <p class="empty-hint" id="home-tasklist-empty" ${tasks.length ? 'hidden' : ''}>Nothing yet -- add one below.</p>
      <div class="home-tasklist-add">
        <input type="text" class="text-field" id="home-tasklist-input" placeholder="Add a to-do..." />
        <button class="chip-btn" id="home-tasklist-add-btn">+ Add</button>
      </div>
    `;
    const listEl = el.querySelector('#home-tasklist');
    listEl.innerHTML = tasks.map((t) => `
      <li class="home-tasklist__row ${t.done ? 'is-done' : ''}" data-id="${t.id}">
        <button class="task-check" aria-label="Toggle done"><svg viewBox="0 0 24 24" fill="none"><path d="M5 12.5l4.5 4.5L19 7.5" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
        <span class="home-tasklist__text">${escapeHtml(t.text)}</span>
      </li>
    `).join('');
    listEl.querySelectorAll('.home-tasklist__row').forEach((row) => {
      row.querySelector('.task-check').addEventListener('click', async () => {
        row.classList.add('is-animating');
        const done = await toggleTask(Number(row.dataset.id));
        row.classList.toggle('is-done', done);
        setTimeout(() => draw(), done ? 550 : 0);
      });
    });
    const input = el.querySelector('#home-tasklist-input');
    async function submitAdd() {
      const text = input.value.trim();
      if (!text) return;
      await addTask(date, text);
      draw();
    }
    el.querySelector('#home-tasklist-add-btn').addEventListener('click', submitAdd);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submitAdd(); } });
  }
  try {
    await draw();
  } catch (err) {
    console.warn('today\'s-tasks widget failed', err);
    el.hidden = true; el.innerHTML = '';
  }
}

async function renderGlanceWidget(el, settings, date) {
  try {
    const [day, tasks, streak] = await Promise.all([
      getDay(date), getTasksForDate(date), getActivityStreak(),
    ]);
    const mood = moodFor(day, settings.ratingScale);
    const nextTask = tasks.find((t) => !t.done);

    el.innerHTML = `
      <div class="glance-row">
        <button type="button" class="glance-tile" id="glance-mood">
          <span class="glance-tile__icon">${mood ? (mood.kind === 'emoji' ? mood.value : '\u{1F3F7}️') : '&mdash;'}</span>
          <span class="glance-tile__label">${mood ? (mood.kind === 'word' ? escapeHtml(mood.value) : 'Mood') : 'No mood yet'}</span>
        </button>
        <button type="button" class="glance-tile" id="glance-task">
          <span class="glance-tile__icon">${nextTask ? '○' : '✓'}</span>
          <span class="glance-tile__label">${nextTask ? escapeHtml(nextTask.text.slice(0, 40)) : 'All done'}</span>
        </button>
        <button type="button" class="glance-tile" id="glance-streak">
          <span class="glance-tile__icon">${streak > 0 ? '\u{1F525}' : '—'}</span>
          <span class="glance-tile__label">${streak} day${streak === 1 ? '' : 's'} streak</span>
        </button>
      </div>
    `;
    el.querySelector('#glance-mood').addEventListener('click', () => { location.hash = '#/journal'; });
    el.querySelector('#glance-task').addEventListener('click', () => { location.hash = '#/tasks'; });
    el.querySelector('#glance-streak').addEventListener('click', () => { location.hash = '#/review'; });
  } catch (err) {
    console.warn('at-a-glance widget failed', err);
    el.hidden = true; el.innerHTML = '';
  }
}
