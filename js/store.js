// store.js — all reads/writes to IndexedDB funnel through here, plus a tiny
// pub/sub bus so views can react to data changes without polling.
import { db, todayStr, addDays } from './db.js';

const bus = new EventTarget();
export function on(event, fn) { bus.addEventListener(event, fn); }
export function off(event, fn) { bus.removeEventListener(event, fn); }
function emit(event, detail) { bus.dispatchEvent(new CustomEvent(event, { detail })); }

// ---------- Settings ----------
export const DEFAULT_SETTINGS = {
  id: 'app',
  theme: 'system',            // light | dark | system | amoled
  accent: '#c1622d',
  fontFamily: 'system',       // system | serif | rounded | mono | dyslexic
  fontSize: 'M',              // S | M | L | XL
  lineSpacing: 'normal',      // compact | normal | relaxed
  density: 'comfortable',     // comfortable | compact
  radius: 'M',                // S | M | L
  landingTab: 'today',
  weekStart: 'sun',           // sun | mon
  dateFormat: 'MMM D',        // MMM D | D/M | M/D | YYYY-MM-DD
  timeFormat: '12',           // 12 | 24
  healthDims: [
    { key: 'mental', label: 'Mental', enabled: true },
    { key: 'emotional', label: 'Emotional', enabled: true },
    { key: 'physical', label: 'Physical', enabled: true },
  ],
  ratingScale: '10',          // 5 | 10 | emoji
  journalFont: 'serif',
  journalFontSize: 'M',
  dailyPrompt: true,
  markdownRender: true,
  lockEnabled: false,
  passcodeHash: null,
  autoLockMinutes: 5,
  birthDate: null,           // 'YYYY-MM-DD' or null
  weatherCity: '',           // fallback city name, '' = unset
  weatherUnits: 'F',         // 'C' | 'F'
  newsTopic: '',             // '' = no filter, else a Noozra category slug
  homeWidgets: {              // per-widget on/off, all default true
    weather: true, news: true, wordOfDay: true, astrology: true, calendar: true, atAGlance: true,
  },
};

export async function getSettings() {
  const s = await db.settings.get('app');
  if (!s) {
    await db.settings.put(DEFAULT_SETTINGS);
    return { ...DEFAULT_SETTINGS };
  }
  // merge to backfill any new fields added since the record was created
  return {
    ...DEFAULT_SETTINGS, ...s,
    healthDims: s.healthDims || DEFAULT_SETTINGS.healthDims,
    homeWidgets: { ...DEFAULT_SETTINGS.homeWidgets, ...(s.homeWidgets || {}) },
  };
}

export async function saveSettings(patch) {
  const cur = await getSettings();
  const next = { ...cur, ...patch, id: 'app' };
  await db.settings.put(next);
  emit('settings-changed', next);
  return next;
}

// ---------- Days (journal + ratings) ----------
export async function getDay(date) {
  const day = await db.days.get(date);
  return day || { date, journal: '', ratings: {}, updatedAt: null };
}

export async function saveDay(date, patch) {
  const cur = await getDay(date);
  const next = { ...cur, ...patch, date, updatedAt: Date.now() };
  await db.days.put(next);
  emit('day-changed', next);
  return next;
}

export async function getAllDaysSorted() {
  return db.days.orderBy('date').reverse().toArray();
}

export async function getDaysInRange(startDate, endDate) {
  return db.days.where('date').between(startDate, endDate, true, true).toArray();
}

// ---------- Tasks ----------
export async function getTasksForDate(date) {
  const tasks = await db.tasks.where('date').equals(date).toArray();
  return tasks.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

export async function addTask(date, text, goalId = null) {
  const existing = await getTasksForDate(date);
  const order = existing.length ? Math.max(...existing.map((t) => t.order ?? 0)) + 1 : 0;
  const id = await db.tasks.add({ date, text, done: false, doneAt: null, goalId, order });
  emit('tasks-changed', { date });
  return id;
}

export async function toggleTask(id) {
  const task = await db.tasks.get(id);
  if (!task) return;
  const done = !task.done;
  await db.tasks.update(id, { done, doneAt: done ? Date.now() : null });
  emit('tasks-changed', { date: task.date });
  return done;
}

export async function updateTask(id, patch) {
  await db.tasks.update(id, patch);
  const task = await db.tasks.get(id);
  emit('tasks-changed', { date: task?.date });
}

export async function deleteTask(id) {
  const task = await db.tasks.get(id);
  await db.tasks.delete(id);
  emit('tasks-changed', { date: task?.date });
}

export async function reorderTasks(date, orderedIds) {
  await db.transaction('rw', db.tasks, async () => {
    for (let i = 0; i < orderedIds.length; i++) {
      await db.tasks.update(orderedIds[i], { order: i });
    }
  });
  emit('tasks-changed', { date });
}

export async function getTasksForGoal(goalId) {
  return db.tasks.where('goalId').equals(goalId).toArray();
}

export async function getAllTasksInRange(startDate, endDate) {
  return db.tasks.where('date').between(startDate, endDate, true, true).toArray();
}

// ---------- Home calendar / streak helpers ----------
// One combined range query (instead of four separate full-month scans from the
// calendar view) that unions every date with any journal/ratings/emotions/task/log
// activity into a single Set the calendar can just .has() against.
export async function getActivityDatesInRange(startDate, endDate) {
  const [days, tasks, log] = await Promise.all([
    getDaysInRange(startDate, endDate),
    getAllTasksInRange(startDate, endDate),
    getLogInRange(startDate, endDate),
  ]);
  const set = new Set();
  for (const d of days) {
    if ((d.journal && d.journal.trim()) || Object.keys(d.ratings || {}).length || (d.emotions && d.emotions.length)) {
      set.add(d.date);
    }
  }
  for (const t of tasks) set.add(t.date);
  for (const l of log) set.add(l.date);
  return set;
}

// Consecutive days (walking backward from today, capped at a year) with any activity.
export async function getActivityStreak() {
  const end = todayStr();
  const start = addDays(end, -365);
  const activeDates = await getActivityDatesInRange(start, end);
  let streak = 0;
  let cursor = end;
  while (activeDates.has(cursor)) {
    streak++;
    cursor = addDays(cursor, -1);
  }
  return streak;
}

// ---------- Log items (done / learned) ----------
export async function getLogForDate(date) {
  const items = await db.logItems.where('date').equals(date).toArray();
  return items.sort((a, b) => b.createdAt - a.createdAt);
}

export async function addLogItem(date, type, text) {
  const id = await db.logItems.add({ date, type, text, createdAt: Date.now() });
  emit('log-changed', { date });
  return id;
}

export async function deleteLogItem(id) {
  const item = await db.logItems.get(id);
  await db.logItems.delete(id);
  emit('log-changed', { date: item?.date });
}

export async function getLogInRange(startDate, endDate) {
  return db.logItems.where('date').between(startDate, endDate, true, true).toArray();
}

// ---------- Goals ----------
export async function getGoals(includeArchived = false) {
  const all = await db.goals.toArray();
  return all.filter((g) => includeArchived || !g.archived).sort((a, b) => b.createdAt - a.createdAt);
}

export async function getGoal(id) {
  return db.goals.get(id);
}

export async function addGoal(goal) {
  const id = await db.goals.add({
    title: goal.title,
    category: goal.category || '',
    targetDate: goal.targetDate || null,
    milestones: goal.milestones || [],
    notes: goal.notes || '',
    createdAt: Date.now(),
    archived: false,
  });
  emit('goals-changed');
  return id;
}

export async function updateGoal(id, patch) {
  await db.goals.update(id, patch);
  emit('goals-changed');
}

export async function deleteGoal(id) {
  await db.goals.delete(id);
  // unlink tasks pointing at this goal
  const linked = await getTasksForGoal(id);
  await Promise.all(linked.map((t) => db.tasks.update(t.id, { goalId: null })));
  emit('goals-changed');
}

export async function goalProgress(goal) {
  const milestones = goal.milestones || [];
  const linkedTasks = await getTasksForGoal(goal.id);
  const totalUnits = milestones.length + linkedTasks.length;
  if (totalUnits === 0) return 0;
  const doneUnits = milestones.filter((m) => m.done).length + linkedTasks.filter((t) => t.done).length;
  return Math.round((doneUnits / totalUnits) * 100);
}

// ---------- Beliefs & Views (topics with dated stance history) ----------
export async function getBeliefs() {
  const all = await db.beliefs.toArray();
  return all.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getBelief(id) {
  return db.beliefs.get(id);
}

export async function addBelief({ topic, category, currentStance }) {
  const now = Date.now();
  const id = await db.beliefs.add({
    topic, category: category || 'political', currentStance: currentStance || '',
    history: currentStance ? [{ date: todayStr(), stance: currentStance, note: 'Initial stance' }] : [],
    createdAt: now, updatedAt: now,
  });
  emit('beliefs-changed');
  return id;
}

// Plain inline edit of the current stance text — no history snapshot (e.g. fixing a typo).
export async function updateBeliefStanceText(id, currentStance) {
  await db.beliefs.update(id, { currentStance, updatedAt: Date.now() });
  emit('beliefs-changed');
}

// "Add stance update": snapshot the *old* stance into history (with a note on why it
// changed), then set the new current stance.
export async function addStanceUpdate(id, { stance, note }) {
  const belief = await db.beliefs.get(id);
  if (!belief) return;
  // Append the NEW stance as the next timeline entry (not the old one -- that was
  // already recorded, either by addBelief's initial-stance seed or a prior update).
  const history = [...(belief.history || []), { date: todayStr(), stance, note: note || '' }];
  await db.beliefs.update(id, { currentStance: stance, history, updatedAt: Date.now() });
  emit('beliefs-changed');
}

export async function updateBelief(id, patch) {
  await db.beliefs.update(id, { ...patch, updatedAt: Date.now() });
  emit('beliefs-changed');
}

export async function deleteBelief(id) {
  await db.beliefs.delete(id);
  emit('beliefs-changed');
}

export async function getLastUsedBeliefCategory() {
  const all = await getBeliefs();
  return all[0]?.category || 'political';
}

export async function getRecentBeliefTopics(limit = 5) {
  const all = await getBeliefs();
  return all.slice(0, limit).map((b) => b.topic);
}

// ---------- Smart-prefill helpers ----------
export async function getMostUsedGoalCategory() {
  const goals = await getGoals(true);
  if (!goals.length) return '';
  const counts = {};
  for (const g of goals) if (g.category) counts[g.category] = (counts[g.category] || 0) + 1;
  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  return sorted[0]?.[0] || '';
}

export async function getRecentTaskTexts(limit = 6) {
  const all = await db.tasks.orderBy('date').reverse().limit(200).toArray();
  const seen = new Set();
  const out = [];
  for (const t of all) {
    const key = t.text.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(t.text);
    if (out.length >= limit) break;
  }
  return out;
}

// Tally emotion tag frequency across all days (used to pin "most used" words atop the
// Emotion Word Bank) or within a date range (used by Review's "most-frequent" widget).
export async function getEmotionFrequency({ start, end } = {}) {
  const days = start && end ? await getDaysInRange(start, end) : await db.days.toArray();
  const counts = {};
  for (const d of days) {
    for (const tag of d.emotions || []) counts[tag] = (counts[tag] || 0) + 1;
  }
  return Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([word, count]) => ({ word, count }));
}

export async function addEmotionTag(date, word) {
  const day = await getDay(date);
  const tags = new Set(day.emotions || []);
  if (tags.has(word)) tags.delete(word); else tags.add(word);
  await saveDay(date, { emotions: [...tags] });
  return [...tags];
}

// ---------- Data export / import / clear ----------
export async function exportBackup() {
  const [days, tasks, logItems, goals, beliefs, settings] = await Promise.all([
    db.days.toArray(), db.tasks.toArray(), db.logItems.toArray(), db.goals.toArray(), db.beliefs.toArray(), db.settings.toArray(),
  ]);
  return {
    app: 'momentum',
    version: 1,
    exportedAt: new Date().toISOString(),
    data: { days, tasks, logItems, goals, beliefs, settings },
  };
}

export async function importBackup(payload) {
  if (!payload || payload.app !== 'momentum' || !payload.data) {
    throw new Error('This file is not a valid Momentum backup.');
  }
  const { days = [], tasks = [], logItems = [], goals = [], beliefs = [], settings = [] } = payload.data;
  await db.transaction('rw', db.days, db.tasks, db.logItems, db.goals, db.beliefs, db.settings, async () => {
    await Promise.all([db.days.clear(), db.tasks.clear(), db.logItems.clear(), db.goals.clear(), db.beliefs.clear(), db.settings.clear()]);
    await db.days.bulkAdd(days);
    await db.tasks.bulkAdd(tasks);
    await db.logItems.bulkAdd(logItems);
    await db.goals.bulkAdd(goals);
    await db.beliefs.bulkAdd(beliefs);
    await db.settings.bulkAdd(settings);
  });
  emit('data-imported');
}

export async function clearAllData() {
  await db.transaction('rw', db.days, db.tasks, db.logItems, db.goals, db.beliefs, db.settings, async () => {
    await Promise.all([db.days.clear(), db.tasks.clear(), db.logItems.clear(), db.goals.clear(), db.beliefs.clear(), db.settings.clear()]);
  });
  emit('data-imported');
}

export async function estimateStorageUsage() {
  if (navigator.storage && navigator.storage.estimate) {
    const { usage, quota } = await navigator.storage.estimate();
    return { usage, quota };
  }
  return { usage: null, quota: null };
}

export { todayStr };
