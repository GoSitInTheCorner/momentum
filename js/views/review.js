// views/review.js — the analytics/time-machine tab: period toggle, rollups, charts, focus panel.
import { getSettings, getGoals, getEmotionFrequency, getBeliefs } from '../store.js';
import { periodRange, buildRollup, whereToFocus, avg } from '../analytics.js';
import { renderTrendChart, renderBarChart, renderRadarChart, destroyChart, destroyAllCharts } from '../components/chart.js';
import { formatDate, escapeHtml } from '../util.js';
import { todayStr } from '../db.js';

const PERIODS = [
  { id: 'daily', label: 'Daily' },
  { id: 'weekly', label: 'Weekly' },
  { id: 'monthly', label: 'Monthly' },
  { id: 'yearly', label: 'Yearly' },
  { id: 'custom', label: 'Custom' },
];

export async function renderReview(root) {
  // The view (and its canvases) is rebuilt from scratch on every navigation to this
  // tab; destroy whatever Chart.js instances the previous Review view created before
  // its canvas elements are discarded, or they leak (never got their own destroy()).
  destroyAllCharts();
  const view = document.createElement('div');
  view.className = 'view view--review';
  view.innerHTML = `
    <header class="topbar">
      <div class="topbar__eyebrow">The time machine</div>
      <h1 class="topbar__title">Review</h1>
    </header>
    <div class="period-toggle" id="period-toggle">
      ${PERIODS.map((p) => `<button class="period-toggle__btn" data-period="${p.id}">${p.label}</button>`).join('')}
    </div>
    <div class="custom-range" id="custom-range" hidden>
      <input type="date" id="custom-start" /> <span>to</span> <input type="date" id="custom-end" />
    </div>
    <div class="scroll-area">
      <div class="stat-row" id="stat-row"></div>

      <section class="card">
        <h2 class="card__title">Health trend</h2>
        <div class="chart-box"><canvas id="health-chart"></canvas></div>
        <p class="empty-hint" id="health-empty" hidden>No health ratings logged for this period yet.</p>
      </section>

      <section class="card">
        <h2 class="card__title">Wheel of Life</h2>
        <div class="chart-box"><canvas id="wheel-chart"></canvas></div>
        <p class="empty-hint" id="wheel-empty" hidden>No ratings logged for this period yet.</p>
      </section>

      <section class="card">
        <h2 class="card__title">Tasks completed / day</h2>
        <div class="chart-box"><canvas id="tasks-chart"></canvas></div>
      </section>

      <section class="card">
        <h2 class="card__title">Most-frequent emotions</h2>
        <div class="emo-freq" id="emo-freq"></div>
        <p class="empty-hint" id="emo-freq-empty" hidden>No feelings tagged for this period yet.</p>
      </section>

      <section class="card focus-card">
        <h2 class="card__title">Where to focus</h2>
        <ul class="focus-list" id="focus-list"></ul>
      </section>

      <section class="card" id="beliefs-changed-card" hidden>
        <h2 class="card__title">Views that changed recently</h2>
        <ul class="focus-list" id="beliefs-changed-list"></ul>
      </section>
      <div class="scroll-spacer"></div>
    </div>
  `;
  root.appendChild(view);

  const settings = await getSettings();
  let period = 'weekly';
  let custom = { start: todayStr(), end: todayStr() };

  const toggleEl = view.querySelector('#period-toggle');
  const customRangeEl = view.querySelector('#custom-range');
  view.querySelector('#custom-start').value = custom.start;
  view.querySelector('#custom-end').value = custom.end;

  function setActivePeriod(p) {
    period = p;
    toggleEl.querySelectorAll('.period-toggle__btn').forEach((b) => b.classList.toggle('is-active', b.dataset.period === p));
    customRangeEl.hidden = p !== 'custom';
    load();
  }

  toggleEl.addEventListener('click', (e) => {
    const btn = e.target.closest('.period-toggle__btn');
    if (btn) setActivePeriod(btn.dataset.period);
  });
  view.querySelector('#custom-start').addEventListener('change', (e) => { custom.start = e.target.value; if (period === 'custom') load(); });
  view.querySelector('#custom-end').addEventListener('change', (e) => { custom.end = e.target.value; if (period === 'custom') load(); });

  async function load() {
    const { start, end } = periodRange(period, todayStr(), custom);
    const rollup = await buildRollup(start, end, settings.healthDims);
    renderStats(view, rollup);
    renderHealthChart(view, rollup, settings);
    renderWheelChart(view, rollup, settings);
    renderTasksChart(view, rollup);
    await renderFocus(view, rollup, settings);
    await renderEmotionFrequency(view, start, end);
    await renderBeliefsChanged(view, start, end);
  }

  setActivePeriod('weekly');
}

function renderStats(view, rollup) {
  const row = view.querySelector('#stat-row');
  row.innerHTML = `
    <div class="stat-tile"><span class="stat-tile__num">${rollup.completedTasks}</span><span class="stat-tile__label">tasks done</span></div>
    <div class="stat-tile"><span class="stat-tile__num">${rollup.streak.current}</span><span class="stat-tile__label">day streak</span></div>
    <div class="stat-tile"><span class="stat-tile__num">${rollup.streak.longest}</span><span class="stat-tile__label">longest streak</span></div>
    <div class="stat-tile"><span class="stat-tile__num">${rollup.learnedTotal}</span><span class="stat-tile__label">learned</span></div>
    <div class="stat-tile"><span class="stat-tile__num">${rollup.doneTotal}</span><span class="stat-tile__label">done logs</span></div>
  `;
}

function renderHealthChart(view, rollup, settings) {
  const canvas = view.querySelector('#health-chart');
  const enabled = settings.healthDims.filter((d) => d.enabled);
  const hasAny = enabled.some((d) => (rollup.health[d.key] || []).some((v) => v !== null));
  view.querySelector('#health-empty').hidden = hasAny;
  if (!hasAny) { destroyChart(canvas); return; }
  const labels = rollup.dates.map((d) => formatDate(d, settings.dateFormat));
  const series = enabled.map((d) => ({ label: d.label, data: rollup.health[d.key] }));
  renderTrendChart(canvas, { labels, series });
}

// Wheel of Life radar -- one axis per enabled life area, averaged over the period.
// Areas with no data at all in this period (avg() === null) are dropped from the
// wheel rather than plotted as a misleading 0 -- an unrated area isn't the same as a
// bottomed-out rating.
function renderWheelChart(view, rollup, settings) {
  const canvas = view.querySelector('#wheel-chart');
  const enabled = settings.healthDims.filter((d) => d.enabled);
  const points = enabled
    .map((d) => ({ label: d.label, mean: avg(rollup.health[d.key] || []) }))
    .filter((p) => p.mean !== null);
  view.querySelector('#wheel-empty').hidden = points.length > 0;
  if (!points.length) { destroyChart(canvas); return; }
  const max = settings.ratingScale === '5' || settings.ratingScale === 'emoji' ? 5 : 10;
  renderRadarChart(canvas, { labels: points.map((p) => p.label), data: points.map((p) => p.mean), max });
}

function renderTasksChart(view, rollup) {
  const canvas = view.querySelector('#tasks-chart');
  const labels = rollup.dates.map((d) => formatDate(d));
  renderBarChart(canvas, { labels, data: rollup.tasksCompletedPerDay });
}

async function renderEmotionFrequency(view, start, end) {
  const freq = (await getEmotionFrequency({ start, end })).slice(0, 8);
  const box = view.querySelector('#emo-freq');
  view.querySelector('#emo-freq-empty').hidden = freq.length > 0;
  box.innerHTML = freq.map((f) => `<span class="emo-freq__pill">${escapeHtml(f.word)} <b>${f.count}</b></span>`).join('');
}

async function renderBeliefsChanged(view, start, end) {
  const beliefs = await getBeliefs();
  const changed = beliefs.filter((b) => (b.history || []).some((h) => h.date >= start && h.date <= end));
  const card = view.querySelector('#beliefs-changed-card');
  card.hidden = changed.length === 0;
  if (!changed.length) return;
  view.querySelector('#beliefs-changed-list').innerHTML = changed.map((b) => `
    <li class="focus-item"><span class="focus-item__icon">&#9670;</span><span>"${escapeHtml(b.topic)}" -- your view shifted during this period.</span></li>
  `).join('');
}

async function renderFocus(view, rollup, settings) {
  const list = view.querySelector('#focus-list');
  const suggestions = await whereToFocus(rollup, settings.healthDims);
  list.innerHTML = suggestions.map((s) => `
    <li class="focus-item"><span class="focus-item__icon">${s.icon === 'goal' ? '◆' : '▲'}</span><span>${escapeHtml(s.text)}</span></li>
  `).join('');
}
