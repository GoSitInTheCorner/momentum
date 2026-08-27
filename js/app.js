// app.js -- app shell: boot sequence, hash router, persistent tab bar + FAB.
import { getSettings, on } from './store.js';
import { applyTheme, watchSystemTheme } from './theme.js';
import { maybeShowLock, startIdleWatch } from './lock.js';
import { renderTabBar, setActiveTab, iconGear } from './components/tabbar.js';
import { renderFab } from './components/fab.js';
import { renderToday } from './views/today.js';
import { renderJournal } from './views/journal.js';
import { renderReview } from './views/review.js';
import { renderGoals } from './views/goals.js';
import { renderTasks } from './views/tasks.js';
import { renderSettings } from './views/settings.js';

const RENDERERS = {
  today: renderToday,
  journal: renderJournal,
  review: renderReview,
  goals: renderGoals,
  tasks: renderTasks,
  settings: renderSettings,
};
// v2.2 -- Settings moved off the tab bar to a gear button (see wireHeaderGear below),
// so it's no longer in this set: FAB stays on Home, Journal, and Tasks -- Home has zero
// inline-edit affordances (besides its compact to-dos card) so it needs the FAB most;
// Journal/Tasks also keep their own inline "+ Add" controls for adding directly
// in-context. Goals only creates goals now (no quick-capture action lives there);
// Review/Settings have no capture action either -- no FAB on any of those three.
const FAB_TABS = new Set(['today', 'journal', 'tasks']);

let viewHost, tabBarEl, fabEl;
let currentTab = null;

function parseHash() {
  const raw = location.hash.replace(/^#\/?/, '') || '';
  const [path, query] = raw.split('?');
  const tab = RENDERERS[path] ? path : null;
  const params = Object.fromEntries(new URLSearchParams(query || ''));
  return { tab, params };
}

async function boot() {
  const settings = await getSettings();
  applyTheme(settings);
  watchSystemTheme(getSettings);

  await maybeShowLock();

  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="view-host" id="view-host"></div>
  `;
  viewHost = document.getElementById('view-host');

  tabBarEl = renderTabBar('today', navigateToTab);
  document.body.appendChild(tabBarEl);

  fabEl = renderFab(handleFabAction);
  document.body.appendChild(fabEl);

  on('settings-changed', async () => { applyTheme(await getSettings()); });

  if (!location.hash) {
    location.hash = `#/${settings.landingTab || 'today'}`;
  }
  window.addEventListener('hashchange', route);
  await route();

  startIdleWatch();
}

function navigateToTab(tab) {
  location.hash = `#/${tab}`;
}

// Each quick-capture action now routes to the deep tab that owns that widget (Home
// itself has no inline editing, apart from its compact to-dos card) -- see
// docs/SPEC.md "Move daily doing/logging OFF Home INTO deep tabs". Journal note now
// opens the dedicated full-screen writing view directly (v2.2 -- see journal.js).
const FAB_ROUTES = {
  task: '#/tasks?action=task',
  done: '#/journal?segment=entries&action=done',
  learned: '#/journal?segment=entries&action=learned',
  journal: '#/journal?write=1',
};

function handleFabAction(actionId) {
  const newHash = FAB_ROUTES[actionId] || '#/today';
  const unchanged = location.hash === newHash;
  location.hash = newHash;
  // hashchange only fires when the hash string actually changes. If we're already on
  // this exact hash (e.g. FAB tapped twice for the same action), force one route pass
  // ourselves -- otherwise let the single hashchange listener own every render.
  if (unchanged) route();
}

async function route() {
  const { tab, params } = parseHash();
  const resolvedTab = tab || 'today';
  const renderer = RENDERERS[resolvedTab];

  const incoming = document.createElement('div');
  incoming.className = 'view-slot view-slot--enter';

  const opts = {};
  // v2.2 -- the Journal tab's dedicated full-screen writing view (?write=1, optionally
  // scoped to a past day via &date=YYYY-MM-DD). It replaces the whole hub UI, so the
  // tab bar + FAB are hidden for it below (immersive, one-thing-at-a-time).
  const isJournalWrite = resolvedTab === 'journal' && !!params.write;
  if (resolvedTab === 'journal') {
    if (params.segment) opts.segment = params.segment;
    if (params.action) opts.pendingAction = params.action;
    if (isJournalWrite) { opts.write = true; if (params.date) opts.date = params.date; }
  }
  if (resolvedTab === 'tasks' && params.action) opts.pendingAction = params.action;

  await renderer(incoming, opts);

  const outgoing = viewHost.querySelector('.view-slot');
  viewHost.appendChild(incoming);
  requestAnimationFrame(() => incoming.classList.add('is-active'));

  if (outgoing) {
    outgoing.classList.add('is-leaving');
    setTimeout(() => outgoing.remove(), 260);
  }

  setActiveTab(tabBarEl, resolvedTab);
  tabBarEl.classList.toggle('is-hidden', isJournalWrite);
  fabEl.classList.toggle('is-hidden', isJournalWrite || !FAB_TABS.has(resolvedTab));
  incoming.classList.toggle('view-slot--full', isJournalWrite);
  currentTab = resolvedTab;

  // Every view except the immersive writing screen and Settings itself gets a gear
  // button wired into its topbar, top-right -- one shared implementation instead of
  // duplicating the button/markup across 5 view files (v2.2: Settings off the tab bar).
  if (!isJournalWrite && resolvedTab !== 'settings') wireHeaderGear(incoming);

  // Strip the one-shot action param from the URL so a reload doesn't re-trigger it
  // (segment/write/date are not one-shot, so preserve them if present).
  if (params.action) {
    const kept = [
      params.segment ? `segment=${params.segment}` : '',
      params.write ? 'write=1' : '',
      params.date ? `date=${params.date}` : '',
    ].filter(Boolean).join('&');
    history.replaceState(null, '', `#/${resolvedTab}${kept ? '?' + kept : ''}`);
  }
}

function wireHeaderGear(incoming) {
  const topbar = incoming.querySelector('.topbar');
  if (!topbar) return;
  const btn = document.createElement('button');
  btn.className = 'icon-btn topbar__gear';
  btn.setAttribute('aria-label', 'Settings');
  btn.innerHTML = iconGear();
  btn.addEventListener('click', () => { location.hash = '#/settings'; });
  topbar.appendChild(btn);
}

boot();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch((err) => console.warn('SW registration failed', err));
  });
}
