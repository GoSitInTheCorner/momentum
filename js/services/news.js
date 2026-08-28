// services/news.js — Noozra (free JSON headlines, keyless, CORS-open). Response shape
// isn't fully documented, so parsing here is deliberately defensive. Online-only for
// the actual fetch, but a 3h localStorage cache (per topic) lets the widget render
// instantly on repeat visits instead of waiting on the network every load; any
// failure/empty/malformed result falls back to a stale cache, else [] so the caller
// hides the card.
import { fetchWithTimeout } from '../util.js';

const CACHE_KEY = 'momentum-news-cache';
const CACHE_TTL = 3 * 60 * 60 * 1000; // 3 hours

function readCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeCache(topic, items) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now(), topic, items }));
  } catch {
    // private mode / quota exceeded -- fine to skip caching
  }
}

export async function getHeadlines(settings) {
  const topic = settings.newsTopic || '';
  const cache = readCache();
  if (cache && cache.topic === topic && Date.now() - cache.ts < CACHE_TTL) return cache.items;

  try {
    const params = new URLSearchParams();
    if (settings.newsTopic) params.set('category', settings.newsTopic);
    params.set('limit', '2');
    const res = await fetchWithTimeout(`https://noozra.com/api/articles?${params.toString()}`);
    if (!res.ok) throw new Error(`bad status ${res.status}`);
    const data = await res.json();
    const list = Array.isArray(data) ? data
      : Array.isArray(data?.articles) ? data.articles
      : Array.isArray(data?.data) ? data.data
      : [];
    const items = list
      .map((item) => {
        const title = item?.title || item?.headline;
        if (!title || typeof title !== 'string') return null;
        const url = item?.url || item?.link || null;
        return { title, url };
      })
      .filter(Boolean)
      .slice(0, 2);
    if (!items.length) throw new Error('empty result');
    writeCache(topic, items);
    return items;
  } catch (err) {
    console.warn('news: fetch failed', err);
    return cache ? cache.items : [];
  }
}
