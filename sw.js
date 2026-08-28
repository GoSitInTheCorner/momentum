// sw.js -- precaches the full app shell + vendor libs so Momentum works completely
// offline. Cache-first for everything precached; network fallback (same-origin only,
// this app makes no external calls) for anything else.
const CACHE_NAME = 'momentum-v2-6';
const PRECACHE_URLS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/styles.css',
  './js/app.js',
  './js/db.js',
  './js/store.js',
  './js/theme.js',
  './js/analytics.js',
  './js/lock.js',
  './js/util.js',
  './js/version.js',
  './js/views/today.js',
  './js/views/journal.js',
  './js/views/review.js',
  './js/views/goals.js',
  './js/views/tasks.js',
  './js/views/settings.js',
  './js/components/tabbar.js',
  './js/components/fab.js',
  './js/components/slider.js',
  './js/components/chart.js',
  './js/components/sheet.js',
  './js/components/emotionbank.js',
  './js/components/tasklist.js',
  './js/components/savebadge.js',
  './js/components/homecalendar.js',
  './js/services/weather.js',
  './js/services/news.js',
  './js/services/dictionary.js',
  './js/services/wordbank.js',
  './js/services/wordpairs.js',
  './js/services/moon.js',
  './data/words.json',
  './data/wordpairs.json',
  './vendor/dexie.min.js',
  './vendor/chart.umd.min.js',
  './assets/icon-192.png',
  './assets/icon-512.png',
  './assets/icon-maskable.png',
  './assets/favicon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request)
        .then((response) => {
          if (response && response.ok && response.type === 'basic') {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => {
          if (event.request.mode === 'navigate') return caches.match('./index.html');
          return caches.match(event.request);
        });
    })
  );
});
