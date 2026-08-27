// app.js -- app shell: boot sequence, hash router, persistent tab bar + FAB.
import { getSettings, on } from './store.js';
import { applyTheme, watchSystemTheme } from './theme.js';
import { maybeShowLock, startIdleWatch } from './lock.js';
import { renderTabBar, setActiveTab } from './components/tabbar.js';
import { renderFab } from './components/fab.js';
import { renderToday } from './views/today.js';
import { renderJournal } from './views/journal.js';
import { renderReview } from './views/review.js';
import { renderGoals } from './views/goals.js';
import { renderSettings } from './views/settings.js';

const RENDERERS = {
  today: renderToday,
  journal: renderJournal,
  review: renderReview,
  goals: renderGoals,
  settings: renderSettings,
};
const FAB_TABS = new Set(['today', 'journal']);

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

function handleFabAction(actionId) {
  const newHash = `#/today?action=${actionId}`;
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
  if (resolvedTab === 'today' && params.action) opts.pendingAction = params.action;
  if (resolvedTab === 'journal' && params.segment) opts.segment = params.segment;

  await renderer(incoming, opts);

  const outgoing = viewHost.querySelector('.view-slot');
  viewHost.appendChild(incoming);
  requestAnimationFrame(() => incoming.classList.add('is-active'));

  if (outgoing) {
    outgoing.classList.add('is-leaving');
    setTimeout(() => outgoing.remove(), 260);
  }

  setActiveTab(tabBarEl, resolvedTab);
  fabEl.classList.toggle('is-hidden', !FAB_TABS.has(resolvedTab));
  currentTab = resolvedTab;

  // Strip one-shot action params from the URL so a reload doesn't re-trigger them.
  if (params.action) history.replaceState(null, '', `#/${resolvedTab}`);
}

boot();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch((err) => console.warn('SW registration failed', err));
  });
}
