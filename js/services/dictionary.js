// services/dictionary.js — dictionaryapi.dev (free, keyless). Used only by the
// look-up-any-word box; word-of-the-day itself stays fully offline (see wordbank.js).
import { fetchWithTimeout } from '../util.js';

export async function lookupWord(word) {
  const w = (word || '').trim();
  if (!w) return { found: false };
  try {
    const res = await fetchWithTimeout(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(w)}`);
    if (res.status === 404) return { found: false };
    if (!res.ok) return { found: false, error: true };
    const data = await res.json();
    const entry = Array.isArray(data) ? data[0] : null;
    if (!entry) return { found: false };
    const meaning = entry.meanings?.[0];
    const def = meaning?.definitions?.[0];
    return {
      found: true,
      word: entry.word || w,
      partOfSpeech: meaning?.partOfSpeech || '',
      definition: def?.definition || '',
      example: def?.example || '',
    };
  } catch (err) {
    console.warn('dictionary: lookup failed', err);
    return { found: false, error: true };
  }
}
