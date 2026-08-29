// services/assessment.js -- cached fetch loader for the Life Assessment's bundled
// reflection questions (data/assessment.json), same pattern as services/wordpairs.js.
// Area LABELS/DESCRIPTIONS come from settings.healthDims (joined by key elsewhere) --
// this file only owns the per-area question text, one source of truth (DRY).
const QUESTIONS_URL = new URL('../../data/assessment.json', import.meta.url);

let questionsCache = null;
export async function loadAssessmentQuestions() {
  if (questionsCache) return questionsCache;
  const res = await fetch(QUESTIONS_URL);
  questionsCache = await res.json();
  return questionsCache;
}
