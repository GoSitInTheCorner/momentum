// db.js — Dexie schema definition. Single source of truth for IndexedDB shape.
// Dexie is loaded as a classic <script> in index.html (vendor/dexie.min.js), which
// attaches itself to globalThis. We reference it here rather than re-vendoring an
// ESM build, keeping exactly one copy of the library on disk.
const Dexie = window.Dexie;

export const db = new Dexie('MomentumDB');

db.version(1).stores({
  days: 'date, updatedAt',
  tasks: '++id, date, goalId, order',
  logItems: '++id, date, type, createdAt',
  goals: '++id, targetDate, createdAt',
  beliefs: '++id, category, updatedAt',
  settings: 'id',
});

// v2.4 -- Life Assessment: dated snapshots (per-area 1-10 scores + free-text
// reflections). Additive upgrade only -- every v1 store is repeated unchanged.
db.version(2).stores({
  days: 'date, updatedAt',
  tasks: '++id, date, goalId, order',
  logItems: '++id, date, type, createdAt',
  goals: '++id, targetDate, createdAt',
  beliefs: '++id, category, updatedAt',
  settings: 'id',
  assessments: '++id, date',
});

// Local-only debug handle so automated tests can seed data. Never active on the
// deployed site (GitHub Pages host is not 'localhost').
if (typeof location !== 'undefined' && location.hostname === 'localhost') {
  try { window.__momentumDb = db; } catch (_) { /* ignore */ }
}

export function todayStr(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function addDays(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + n);
  return todayStr(dt);
}
