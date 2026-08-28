// services/wordpairs.js — fully offline "Words to sit with": 1-3 contrast pairs picked
// deterministically by date from a bundled JSON list (data/wordpairs.json), same
// day-of-year approach as services/wordbank.js so every device shows the same pairs
// on the same date, no network required.
const PAIRS_URL = new URL('../../data/wordpairs.json', import.meta.url);

let pairsCache = null;
async function loadPairs() {
  if (pairsCache) return pairsCache;
  const res = await fetch(PAIRS_URL);
  pairsCache = await res.json();
  return pairsCache;
}

function dayOfYear(date) {
  const start = new Date(date.getFullYear(), 0, 0);
  return Math.floor((date - start) / 86400000);
}

// Returns 1-3 {a,b} pairs for the given date -- a shifting window over the bundled
// list, anchored to day-of-year so it rotates daily and wraps around. The count
// itself is also deterministic by date (1-3), so the widget doesn't always show 3.
export async function pairsForDate(date = new Date()) {
  const pairs = await loadPairs();
  if (!pairs.length) return [];
  const base = dayOfYear(date) % pairs.length;
  const count = Math.min(1 + (dayOfYear(date) % 3), pairs.length);
  const out = [];
  for (let i = 0; i < count; i++) out.push(pairs[(base + i) % pairs.length]);
  return out;
}
