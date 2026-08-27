// views/today.js -- Home: a read-mostly launchpad. Arrive & glance, never edit here.
// Deep editing lives on Journal (reflection + sliders + emotions + log) and Goals
// (to-dos + goals). See docs/SPEC.md "v2 -- Home as an inviting launchpad".
import { todayStr } from '../db.js';
import { getSettings, getTasksForDate, getActivityStreak, getDay } from '../store.js';
import { createHomeCalendar } from '../components/homecalendar.js';
import { getWeather } from '../services/weather.js';
import { getHeadlines } from '../services/news.js';
import { wordForDate } from '../services/wordbank.js';
import { lookupWord } from '../services/dictionary.js';
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
      <div class="topbar__eyebrow">${greeting()}</div>
      <h1 class="topbar__title">${formatWeekday(date)}</h1>
    </header>
    <div class="scroll-area">
      <section class="card home-widget home-widget--weather" id="w-weather" ${w.weather ? '' : 'hidden'}></section>
      <section class="card home-widget home-widget--news" id="w-news" ${w.news ? '' : 'hidden'}></section>
      <section class="card home-widget home-widget--word" id="w-word" ${w.wordOfDay ? '' : 'hidden'}></section>
      <section class="card home-widget home-widget--astro" id="w-astro" ${w.astrology ? '' : 'hidden'}></section>

      <section class="card home-cta-card">
        <p class="home-cta__prompt" id="home-prompt">${escapeHtml(promptsForToday()[0])}</p>
        <button class="btn btn--home-cta" id="home-cta-btn">Write today's entry &rarr;</button>
      </section>

      <section class="card home-widget home-widget--calendar" id="w-calendar" ${w.calendar ? '' : 'hidden'}>
        <div class="card__title-row"><h2 class="card__title">Your month</h2></div>
        <div id="home-cal-mount"></div>
      </section>

      <section class="card home-widget home-widget--glance" id="w-glance" ${w.atAGlance ? '' : 'hidden'}></section>
      <div class="scroll-spacer"></div>
    </div>
  `;
  root.appendChild(view);

  view.querySelector('#home-cta-btn').addEventListener('click', () => {
    location.hash = '#/journal?segment=entries&focus=1';
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
  if (w.atAGlance) renderGlanceWidget(view.querySelector('#w-glance'), settings, date);
}

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

async function renderWeatherWidget(el, settings) {
  el.innerHTML = `<div class="home-widget__skeleton"><div class="skel-line skel-line--w60"></div><div class="skel-line skel-line--w40"></div></div>`;
  try {
    const weather = await getWeather(settings);
    if (!weather) { el.hidden = true; el.innerHTML = ''; return; }
    el.innerHTML = `
      <div class="weather-widget">
        <span class="weather-widget__icon">${weather.icon}</span>
        <div class="weather-widget__body">
          <div class="weather-widget__temp">${weather.temp}&deg;${weather.unit}</div>
          <div class="weather-widget__label">${escapeHtml(weather.label)}${weather.city ? ` &middot; ${escapeHtml(weather.city)}` : ''}</div>
        </div>
      </div>
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

async function renderWordWidget(el, date) {
  el.innerHTML = `<div class="home-widget__skeleton"><div class="skel-line skel-line--w50"></div><div class="skel-line skel-line--w90"></div></div>`;
  try {
    const [y, m, d] = date.split('-').map(Number);
    const entry = await wordForDate(new Date(y, m - 1, d));
    el.innerHTML = `
      <div class="card__title-row"><h2 class="card__title">Word of the day</h2></div>
      ${entry ? `
        <div class="word-widget__entry">
          <span class="word-widget__word">${escapeHtml(entry.word)}</span>
          <span class="word-widget__pos">${escapeHtml(entry.partOfSpeech)}</span>
          <p class="word-widget__def">${escapeHtml(entry.definition)}</p>
          ${entry.example ? `<p class="word-widget__example">&ldquo;${escapeHtml(entry.example)}&rdquo;</p>` : ''}
        </div>
      ` : `<p class="empty-hint">No word bank available.</p>`}
      <div class="word-lookup">
        <label class="field-label">Look up any word</label>
        <div class="word-lookup__row">
          <input type="text" class="text-field word-lookup__input" id="word-lookup-input" placeholder="e.g. luminous" ${navigator.onLine ? '' : 'disabled'} />
          <button class="chip-btn word-lookup__btn" id="word-lookup-btn" ${navigator.onLine ? '' : 'disabled'}>Look up</button>
        </div>
        ${navigator.onLine ? '' : '<p class="settings-hint">Look-up needs a connection -- word of the day still works offline.</p>'}
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
    if (btn) btn.addEventListener('click', doLookup);
    if (input) input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); doLookup(); } });
  } catch (err) {
    console.warn('word-of-day widget failed', err);
    el.hidden = true; el.innerHTML = '';
  }
}

function renderAstroWidget(el, settings) {
  try {
    if (!settings.birthDate) {
      el.innerHTML = `
        <div class="card__title-row"><h2 class="card__title">Astrology</h2></div>
        <p class="empty-hint">Set your birth date in Settings to see your sign.</p>
      `;
      return;
    }
    const z = sunSignFor(settings.birthDate);
    const moon = moonPhase(new Date());
    el.innerHTML = `
      <div class="card__title-row"><h2 class="card__title">Astrology</h2></div>
      ${z ? `
        <div class="astro-row">
          <div class="astro-row__block">
            <div class="astro-row__label">Sun sign</div>
            <div class="astro-row__value">${z.sign}</div>
            <div class="astro-row__trait">${escapeHtml(z.trait)}</div>
          </div>
        </div>
      ` : ''}
      <div class="astro-row">
        <div class="astro-row__block">
          <div class="astro-row__label">Moon today</div>
          <div class="astro-row__value">${moon.emoji} ${moon.name}</div>
        </div>
      </div>
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
    el.querySelector('#glance-task').addEventListener('click', () => { location.hash = '#/goals'; });
    el.querySelector('#glance-streak').addEventListener('click', () => { location.hash = '#/review'; });
  } catch (err) {
    console.warn('at-a-glance widget failed', err);
    el.hidden = true; el.innerHTML = '';
  }
}
