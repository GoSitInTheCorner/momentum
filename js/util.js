// util.js — small shared helpers with no other dependencies, used across views.
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
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
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
