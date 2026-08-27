// services/news.js — Noozra (free JSON headlines, keyless, CORS-open). Response shape
// isn't fully documented, so parsing here is deliberately defensive. Online-only;
// any failure/empty/malformed result collapses to [] so the caller hides the card.
import { fetchWithTimeout } from '../util.js';

export async function getHeadlines(settings) {
  try {
    const params = new URLSearchParams();
    if (settings.newsTopic) params.set('category', settings.newsTopic);
    params.set('limit', '3');
    const res = await fetchWithTimeout(`https://noozra.com/api/articles?${params.toString()}`);
    if (!res.ok) return [];
    const data = await res.json();
    const list = Array.isArray(data) ? data
      : Array.isArray(data?.articles) ? data.articles
      : Array.isArray(data?.data) ? data.data
      : [];
    return list
      .map((item) => {
        const title = item?.title || item?.headline;
        if (!title || typeof title !== 'string') return null;
        const url = item?.url || item?.link || null;
        return { title, url };
      })
      .filter(Boolean)
      .slice(0, 3);
  } catch (err) {
    console.warn('news: fetch failed', err);
    return [];
  }
}
