// components/chart.js — thin themed wrapper around the vendored Chart.js UMD
// global. Keeps all chart-styling decisions (colors, fonts, grid) in one place
// so Review's view code just passes data in.
const Chart = window.Chart;

function cssVar(name, fallback) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

const registry = new WeakMap();
// Views (e.g. Review) rebuild their canvases from scratch on every re-render, which
// orphans the old canvas elements' Chart.js instances -- the WeakMap keyed by canvas
// can't reach them anymore once the canvas itself is thrown away. Track every live
// instance here too so a view can force-cleanup everything it created, regardless of
// whether it still holds a reference to the old canvas.
const liveCharts = new Set();

export function renderTrendChart(canvas, { labels, series }) {
  destroyChart(canvas);
  const ink = cssVar('--ink-2', '#8a8371');
  const grid = cssVar('--hairline', 'rgba(0,0,0,0.08)');
  const colors = ['#c1622d', '#4a7a63', '#5b6ea8'];
  const chart = new Chart(canvas.getContext('2d'), {
    type: 'line',
    data: {
      labels,
      datasets: series.map((s, i) => ({
        label: s.label,
        data: s.data,
        borderColor: s.color || colors[i % colors.length],
        backgroundColor: (s.color || colors[i % colors.length]) + '22',
        spanGaps: true,
        tension: 0.35,
        pointRadius: labels.length > 20 ? 0 : 3,
        pointHoverRadius: 5,
        borderWidth: 2.5,
        fill: false,
      })),
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 500 },
      interaction: { mode: 'index', intersect: false },
      scales: {
        x: { ticks: { color: ink, maxRotation: 0, autoSkip: true, font: { size: 10 } }, grid: { display: false } },
        y: { ticks: { color: ink, font: { size: 10 } }, grid: { color: grid }, beginAtZero: true },
      },
      plugins: {
        legend: { position: 'bottom', labels: { color: ink, boxWidth: 10, boxHeight: 10, font: { size: 11 }, usePointStyle: true } },
        tooltip: { backgroundColor: cssVar('--card', '#fff'), titleColor: cssVar('--ink', '#222'), bodyColor: cssVar('--ink', '#222'), borderColor: grid, borderWidth: 1, padding: 10, cornerRadius: 8 },
      },
    },
  });
  registry.set(canvas, chart);
  liveCharts.add(chart);
  return chart;
}

export function renderBarChart(canvas, { labels, data, color }) {
  destroyChart(canvas);
  const ink = cssVar('--ink-2', '#8a8371');
  const grid = cssVar('--hairline', 'rgba(0,0,0,0.08)');
  const chart = new Chart(canvas.getContext('2d'), {
    type: 'bar',
    data: { labels, datasets: [{ data, backgroundColor: color || cssVar('--accent', '#c1622d'), borderRadius: 4, maxBarThickness: 22 }] },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 500 },
      scales: {
        x: { ticks: { color: ink, maxRotation: 0, autoSkip: true, font: { size: 10 } }, grid: { display: false } },
        y: { ticks: { color: ink, stepSize: 1, font: { size: 10 } }, grid: { color: grid }, beginAtZero: true },
      },
      plugins: { legend: { display: false } },
    },
  });
  registry.set(canvas, chart);
  liveCharts.add(chart);
  return chart;
}

// Wheel of Life radar (v2.1) -- one point per enabled life area, averaged over the
// active Review period. `max` should match the active rating-scale setting (5/10, or
// 5 for emoji since that's the slider's internal numeric range) so the ring matches
// what the sliders themselves can produce.
//
// v2.4 -- Life Assessment overlay: pass `series` (array of {label, data, color}) instead
// of `data` to plot 2+ named datasets (e.g. "Now" vs "Last time") with a legend. `data`
// stays supported as the single-dataset, no-legend shorthand the Wheel of Life already
// uses, so that call site needed no changes (DRY -- one radar renderer, two call shapes).
export function renderRadarChart(canvas, { labels, data, series, max = 10 }) {
  destroyChart(canvas);
  const ink = cssVar('--ink-2', '#8a8371');
  const grid = cssVar('--hairline', 'rgba(0,0,0,0.08)');
  const accent = cssVar('--accent', '#c1622d');
  const overlayColors = [accent, cssVar('--ink-2', '#8a8371')];
  const datasets = series
    ? series.map((s, i) => ({
      label: s.label,
      data: s.data,
      borderColor: s.color || overlayColors[i % overlayColors.length],
      backgroundColor: i === 0 ? (s.color || overlayColors[i % overlayColors.length]) + '33' : 'transparent',
      pointBackgroundColor: s.color || overlayColors[i % overlayColors.length],
      borderDash: i === 1 ? [5, 4] : undefined,
      borderWidth: 2.5,
      pointRadius: 3,
      spanGaps: true,
    }))
    : [{
      data,
      borderColor: accent,
      backgroundColor: accent + '33',
      pointBackgroundColor: accent,
      borderWidth: 2.5,
      pointRadius: 3,
    }];
  const chart = new Chart(canvas.getContext('2d'), {
    type: 'radar',
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 500 },
      scales: {
        r: {
          min: 0,
          max,
          ticks: { display: false, stepSize: max / 5 },
          grid: { color: grid },
          angleLines: { color: grid },
          pointLabels: { color: ink, font: { size: 10 } },
        },
      },
      plugins: {
        legend: series ? { position: 'bottom', labels: { color: ink, boxWidth: 10, boxHeight: 10, font: { size: 11 }, usePointStyle: true } } : { display: false },
        tooltip: { backgroundColor: cssVar('--card', '#fff'), titleColor: cssVar('--ink', '#222'), bodyColor: cssVar('--ink', '#222'), borderColor: grid, borderWidth: 1, padding: 10, cornerRadius: 8 },
      },
    },
  });
  registry.set(canvas, chart);
  liveCharts.add(chart);
  return chart;
}

export function destroyChart(canvas) {
  const existing = registry.get(canvas);
  if (existing) { existing.destroy(); registry.delete(canvas); liveCharts.delete(existing); }
}

// Destroy every chart instance this module currently knows about, even ones whose
// canvas element has since been discarded. Call this before a view rebuilds its
// canvases from scratch (innerHTML replace) so the outgoing instances don't leak.
export function destroyAllCharts() {
  for (const chart of liveCharts) chart.destroy();
  liveCharts.clear();
}
