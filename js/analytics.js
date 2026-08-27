// analytics.js — pure functions that turn raw days/tasks/logItems into Review-tab rollups.
// Nothing here touches the DOM; views call these and render the results.
import { addDays, todayStr } from './db.js';
import {
  getDaysInRange, getAllTasksInRange, getLogInRange, getGoals, getTasksForGoal,
} from './store.js';

export function periodRange(period, anchorDate = todayStr(), custom = null) {
  if (period === 'custom' && custom?.start && custom?.end) {
    return { start: custom.start, end: custom.end };
  }
  const [y, m, d] = anchorDate.split('-').map(Number);
  const anchor = new Date(y, m - 1, d);
  if (period === 'daily') return { start: anchorDate, end: anchorDate };
  if (period === 'weekly') {
    const dow = anchor.getDay(); // 0=Sun
    const start = addDays(anchorDate, -dow);
    const end = addDays(start, 6);
    return { start, end };
  }
  if (period === 'monthly') {
    const start = `${y}-${String(m).padStart(2, '0')}-01`;
    const lastDay = new Date(y, m, 0).getDate();
    const end = `${y}-${String(m).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
    return { start, end };
  }
  if (period === 'yearly') {
    return { start: `${y}-01-01`, end: `${y}-12-31` };
  }
  return { start: anchorDate, end: anchorDate };
}

function listDates(start, end) {
  const out = [];
  let cur = start;
  let guard = 0;
  while (cur <= end && guard < 400) {
    out.push(cur);
    cur = addDays(cur, 1);
    guard++;
  }
  return out;
}

export async function buildRollup(start, end, healthDims) {
  const [days, tasks, logItems] = await Promise.all([
    getDaysInRange(start, end),
    getAllTasksInRange(start, end),
    getLogInRange(start, end),
  ]);
  const dates = listDates(start, end);
  const dayByDate = new Map(days.map((d) => [d.date, d]));

  // Health trend series, one array per enabled dimension, aligned to `dates`.
  const health = {};
  for (const dim of healthDims.filter((d) => d.enabled)) {
    health[dim.key] = dates.map((date) => {
      const day = dayByDate.get(date);
      const v = day?.ratings?.[dim.key];
      return typeof v === 'number' ? v : null;
    });
  }

  // Tasks completed per day
  const tasksByDate = new Map();
  for (const t of tasks) {
    if (!tasksByDate.has(t.date)) tasksByDate.set(t.date, []);
    tasksByDate.get(t.date).push(t);
  }
  const tasksCompletedPerDay = dates.map((date) => (tasksByDate.get(date) || []).filter((t) => t.done).length);
  const totalTasks = tasks.length;
  const completedTasks = tasks.filter((t) => t.done).length;

  // Learning / done volume per day
  const doneByDate = new Map();
  const learnedByDate = new Map();
  for (const item of logItems) {
    const map = item.type === 'learned' ? learnedByDate : doneByDate;
    map.set(item.date, (map.get(item.date) || 0) + 1);
  }
  const doneVolume = dates.map((date) => doneByDate.get(date) || 0);
  const learnedVolume = dates.map((date) => learnedByDate.get(date) || 0);

  // Streak (consecutive days, up to *today*, with >=1 completed task), computed globally
  // not just within the window, so short periods still show a meaningful streak.
  const { current, longest } = await computeStreaks();

  return {
    dates, health, tasksCompletedPerDay, totalTasks, completedTasks,
    doneVolume, learnedVolume,
    doneTotal: logItems.filter((i) => i.type === 'done').length,
    learnedTotal: logItems.filter((i) => i.type === 'learned').length,
    streak: { current, longest },
  };
}

export async function computeStreaks() {
  const today = todayStr();
  // Look back up to a year to find streak boundaries.
  const start = addDays(today, -365);
  const tasks = await getAllTasksInRange(start, today);
  const byDate = new Map();
  for (const t of tasks) {
    if (!t.done) continue;
    byDate.set(t.date, (byDate.get(t.date) || 0) + 1);
  }
  let current = 0;
  let cursor = today;
  // current streak: walk backward from today while each day has >=1 completed task
  while (byDate.has(cursor)) {
    current++;
    cursor = addDays(cursor, -1);
  }
  // longest streak: scan all dates with activity
  const activeDates = [...byDate.keys()].sort();
  let longest = 0, run = 0, prev = null;
  for (const date of activeDates) {
    if (prev && addDays(prev, 1) === date) run++; else run = 1;
    longest = Math.max(longest, run);
    prev = date;
  }
  longest = Math.max(longest, current);
  return { current, longest };
}

export function avg(arr) {
  const vals = arr.filter((v) => typeof v === 'number');
  if (!vals.length) return null;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

export async function whereToFocus(rollup, healthDims) {
  const suggestions = [];

  // Lowest-trending health dimension
  const enabled = healthDims.filter((d) => d.enabled);
  let lowest = null;
  for (const dim of enabled) {
    const series = rollup.health[dim.key] || [];
    const mean = avg(series);
    if (mean === null) continue;
    if (!lowest || mean < lowest.mean) lowest = { key: dim.key, label: dim.label, mean };
  }
  if (lowest) {
    suggestions.push({
      icon: 'trend',
      text: `${lowest.label} has been your lowest-rated dimension this period (avg ${lowest.mean.toFixed(1)}). A short walk, a call with a friend, or an earlier bedtime tonight could help.`,
    });
  } else {
    suggestions.push({ icon: 'trend', text: 'Log a health rating for a few days to unlock a focus suggestion here.' });
  }

  // Goals with no recent linked activity (no completed task or milestone tick in 14 days)
  const goals = await getGoals();
  const cutoff = addDays(todayStr(), -14);
  const stale = [];
  for (const g of goals) {
    const linked = await getTasksForGoal(g.id);
    const recentTaskActivity = linked.some((t) => t.done && t.doneAt && new Date(t.doneAt).toISOString().slice(0, 10) >= cutoff);
    if (!recentTaskActivity && !g.archived) stale.push(g);
  }
  if (stale.length) {
    const g = stale[0];
    suggestions.push({
      icon: 'goal',
      text: `"${g.title}" hasn't seen linked activity in 2+ weeks. Add one small task toward it today to keep momentum.`,
    });
  }

  return suggestions.slice(0, 2);
}
