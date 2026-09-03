// util.js — small shared helpers with no other dependencies, used across views.
import { todayStr } from './db.js';

export function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
}

export function formatDate(dateStr, format = 'MMM D') {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  if (format === 'D/M') return `${d}/${m}`;
  if (format === 'M/D') return `${m}/${d}`;
  if (format === 'YYYY-MM-DD') return dateStr;
  return dt.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function formatWeekday(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
}

// 'HH:MM' 24h -> '2:00 PM' style 12h string. Never throws on malformed input --
// falls back to the raw string so a bad dueTime degrades gracefully instead of crashing.
export function to12h(hhmm) {
  if (typeof hhmm !== 'string') return '';
  const m = hhmm.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return hhmm;
  let h = Number(m[1]);
  const min = m[2];
  if (h > 23 || h < 0) return hhmm;
  const suffix = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${h}:${min} ${suffix}`;
}

// Renders a task's due date/time per its dueKind, respecting the user's date/time
// display settings. Robust to old records with no dueKind at all (treated as 'date').
export function formatDue(task, settings) {
  const kind = task.dueKind || 'date';
  if (kind === 'life') return 'Someday';
  if (kind === 'year') return String(task.dueYear);
  if (kind === 'datetime') {
    const time = settings.timeFormat === '24' ? task.dueTime : to12h(task.dueTime);
    return `${formatDate(task.date, settings.dateFormat)} ${time || ''}`.trim();
  }
  return task.date === todayStr() ? 'Today' : formatDate(task.date, settings.dateFormat);
}

// Small, safe markdown-lite renderer for the journal day-detail READ view (settings.markdownRender).
// Escapes HTML first, then layers on **bold**, *italic*, "- " bullet lists, line breaks,
// and [text](url) links. No external library -- deliberately not a full markdown spec.
function inlineMarkdown(str) {
  return str
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>');
}

// fetch() has no built-in timeout -- a hung/slow keyless API (no SLA, no key to escalate
// with) would otherwise leave an online-only widget stuck on its skeleton forever instead
// of degrading gracefully. Every cross-origin call in services/ goes through this.
export async function fetchWithTimeout(url, { timeoutMs = 6000, ...opts } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

export function renderMarkdownLite(text) {
  const escaped = escapeHtml(text || ''); // HTML-escape BEFORE any markdown tags are introduced
  const lines = escaped.split('\n');
  const out = [];
  let inList = false;
  for (const line of lines) {
    const bullet = line.match(/^-\s+(.*)$/);
    if (bullet) {
      if (!inList) { out.push('<ul>'); inList = true; }
      out.push(`<li>${inlineMarkdown(bullet[1])}</li>`);
    } else {
      if (inList) { out.push('</ul>'); inList = false; }
      out.push(line.trim() === '' ? '<br>' : `<div>${inlineMarkdown(line)}</div>`);
    }
  }
  if (inList) out.push('</ul>');
  return out.join('');
}
