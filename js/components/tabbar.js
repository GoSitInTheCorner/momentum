// components/tabbar.js — bottom navigation. Pure render + click delegation;
// app.js owns the actual routing decision.

const TABS = [
  { id: 'today', label: 'Today', icon: iconSun() },
  { id: 'journal', label: 'Journal', icon: iconBook() },
  { id: 'review', label: 'Review', icon: iconChart() },
  { id: 'goals', label: 'Goals', icon: iconTarget() },
  { id: 'settings', label: 'Settings', icon: iconGear() },
];

function iconSun() {
  return `<svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="4.2" stroke="currentColor" stroke-width="1.8"/><g stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M12 2.5v2.4M12 19.1v2.4M4.2 4.2l1.7 1.7M18.1 18.1l1.7 1.7M2.5 12h2.4M19.1 12h2.4M4.2 19.8l1.7-1.7M18.1 5.9l1.7-1.7"/></g></svg>`;
}
function iconBook() {
  return `<svg viewBox="0 0 24 24" fill="none"><path d="M4 4.8c2.4-1 5.2-1 8 .4v13.6c-2.8-1.4-5.6-1.4-8-.4V4.8Z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M20 4.8c-2.4-1-5.2-1-8 .4v13.6c2.8-1.4 5.6-1.4 8-.4V4.8Z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>`;
}
function iconChart() {
  return `<svg viewBox="0 0 24 24" fill="none"><path d="M4 19V10M10 19V5M16 19v-6M20 19V8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`;
}
function iconTarget() {
  return `<svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="8" stroke="currentColor" stroke-width="1.8"/><circle cx="12" cy="12" r="4" stroke="currentColor" stroke-width="1.8"/><circle cx="12" cy="12" r="0.9" fill="currentColor"/></svg>`;
}
function iconGear() {
  return `<svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="1.8"/><path d="M12 3.5v2.2M12 18.3v2.2M20.5 12h-2.2M5.7 12H3.5M17.7 6.3l-1.5 1.5M7.8 16.2l-1.5 1.5M17.7 17.7l-1.5-1.5M7.8 7.8 6.3 6.3" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`;
}

export function renderTabBar(activeId, onNavigate) {
  const el = document.createElement('nav');
  el.className = 'tabbar';
  el.setAttribute('role', 'tablist');
  el.innerHTML = TABS.map((t) => `
    <button class="tabbar__item ${t.id === activeId ? 'is-active' : ''}" role="tab" aria-selected="${t.id === activeId}" data-tab="${t.id}" aria-label="${t.label}">
      <span class="tabbar__icon">${t.icon}</span>
      <span class="tabbar__label">${t.label}</span>
    </button>
  `).join('');
  el.addEventListener('click', (e) => {
    const btn = e.target.closest('.tabbar__item');
    if (!btn) return;
    onNavigate(btn.dataset.tab);
  });
  return el;
}

export function setActiveTab(el, activeId) {
  el.querySelectorAll('.tabbar__item').forEach((btn) => {
    const active = btn.dataset.tab === activeId;
    btn.classList.toggle('is-active', active);
    btn.setAttribute('aria-selected', String(active));
  });
}
