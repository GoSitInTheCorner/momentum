// components/fab.js — floating + button that opens a quick-capture action sheet.
import { openSheet } from './sheet.js';

export function renderFab(onAction) {
  const btn = document.createElement('button');
  btn.className = 'fab';
  btn.setAttribute('aria-label', 'Quick capture');
  btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>`;
  btn.addEventListener('click', () => {
    openSheet({
      title: 'Quick capture',
      actions: [
        { id: 'task', label: 'New to-do', hint: 'Add it to today', icon: '✓' },
        { id: 'done', label: 'I did…', hint: 'Log something you accomplished', icon: '●' },
        { id: 'learned', label: 'I learned…', hint: 'Log something you learned', icon: '◆' },
        { id: 'journal', label: 'Journal note', hint: 'Jump to today’s entry', icon: '✎' },
      ],
      onSelect: (id) => onAction(id),
    });
  });
  return btn;
}
