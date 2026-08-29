// app.js -- app shell: boot sequence, hash router, persistent tab bar + gear. The FAB
// (quick-capture "+") was retired in v2.6 -- inline capture on Tasks/Today/Journal
// covers everything it used to route to (see docs/SPEC.md v2.6).
import { getSettings, on } from './store.js';
import { applyTheme, watchSystemTheme } from './theme.js';
import { maybeShowLock, startIdleWatch } from './lock.js';
import { renderTabBar, setActiveTab, iconGear } from './components/tabbar.js';
import { renderToday } from './views/today.js';
import { renderJournal } from './views/journal.js';
import { renderReview } from './views/review.js';
import { renderGoals } from './views/goals.js';
import { renderTasks } from './views/tasks.js';
import { renderSettings } from './views/settings.js';
import { renderAssessment } from './views/assessment.js';

const RENDERERS = {
  today: renderToday,
  journal: renderJournal,
  review: renderReview,
  goals: renderGoals,
  tasks: renderTasks,
  settings: renderSettings,
  assessment: renderAssessment,
};
let viewHost, tabBarEl, appGearEl;
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

  // Persistent Settings gear on document.body -- kept OUT of the view-slots because their
  // transform traps position:fixed. Stays docked top-right while page content scrolls.
  appGearEl = document.createElement('button');
  appGearEl.className = 'icon-btn app-gear topbar__gear';
  appGearEl.setAttribute('aria-label', 'Settings');
  appGearEl.innerHTML = iconGear();
  appGearEl.addEventListener('click', () => { location.hash = '#/settings'; });
  document.body.appendChild(appGearEl);

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

async function route() {
  const { tab, params } = parseHash();
  const resolvedTab = tab || 'today';
  const renderer = RENDERERS[resolvedTab];

  const incoming = document.createElement('div');
  incoming.className = 'view-slot view-slot--enter';

  const opts = {};
  // v2.2 -- the Journal tab's dedicated full-screen writing view (?write=1, optionally
  // scoped to a past day via &date=YYYY-MM-DD). It replaces the whole hub UI, so the
  // tab bar is hidden for it below (immersive, one-thing-at-a-time).
  const isJournalWrite = resolvedTab === 'journal' && !!params.write;
  // The Life Assessment view is also immersive (own header/back-arrow, no tab bar,
  // full-bleed layout) but is reached only via buttons (Today/Review), never the tab
  // bar -- see isJournalWrite's opts below, which stay journal-specific.
  const isImmersive = isJournalWrite || resolvedTab === 'assessment';
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
  tabBarEl.classList.toggle('is-hidden', isImmersive);
  incoming.classList.toggle('view-slot--full', isImmersive);
  currentTab = resolvedTab;

  // The persistent gear (on document.body) hides on the immersive writing/assessment
  // screens and on Settings itself; everywhere else it stays fixed top-right, even
  // while content scrolls.
  appGearEl.classList.toggle('is-hidden', isImmersive || resolvedTab === 'settings');

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

boot();

if ('serviceWorker' in navigator) {
  let updateReady = false;
  // Reload only for a genuine update (a new SW replacing an old one) -- never on the
  // first-visit clients.claim(), and guarded against a reload loop. sw.js calls
  // skipWaiting(), so a new deploy activates and fires controllerchange on its own.
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (updateReady) { updateReady = false; window.location.reload(); }
  });
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').then((reg) => {
      reg.update().catch(() => {});
      reg.addEventListener('updatefound', () => {
        const nw = reg.installing;
        if (!nw) return;
        nw.addEventListener('statechange', () => {
          if (nw.state === 'installed' && navigator.serviceWorker.controller) updateReady = true;
        });
      });
      // Re-check for a new deploy every 5 min while the app stays open.
      setInterval(() => reg.update().catch(() => {}), 5 * 60 * 1000);
    }).catch((err) => console.warn('SW registration failed', err));
  });
}
