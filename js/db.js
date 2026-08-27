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
