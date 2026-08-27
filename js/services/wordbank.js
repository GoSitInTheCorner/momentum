// services/wordbank.js — fully offline curated "word of the day", bundled as JSON
// (data/words.json) so it works with no network at all. Picked deterministically by
// day-of-year so every device shows the same word on the same date.
const WORDS_URL = new URL('../../data/words.json', import.meta.url);

let wordsCache = null;
async function loadWords() {
  if (wordsCache) return wordsCache;
  const res = await fetch(WORDS_URL);
  wordsCache = await res.json();
  return wordsCache;
}

function dayOfYear(date) {
  const start = new Date(date.getFullYear(), 0, 0);
  return Math.floor((date - start) / 86400000);
}

export async function wordForDate(date = new Date()) {
  const words = await loadWords();
  if (!words.length) return null;
  return words[dayOfYear(date) % words.length];
}
