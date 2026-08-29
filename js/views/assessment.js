// views/assessment.js -- "Life Assessment": a guided deep self-reflection across the
// app's life areas (Burchard's 10 + Emotional, from settings.healthDims). Per area:
// 3 free-text reflection questions + a 1-10 score slider. Saving stores a dated
// snapshot (store.js saveAssessment). Immersive full-screen layout, same idiom as
// journal.js's renderJournalWrite -- own header/back arrow, no tab bar/FAB (app.js).
// Area LABELS/DESCRIPTIONS come from settings.healthDims (joined by key) -- never
// duplicated here; this view only lays out the bundled question text (data/assessment.json).
import { getSettings, saveAssessment, getLatestAssessment, todayStr } from '../store.js';
import { loadAssessmentQuestions } from '../services/assessment.js';
import { createHealthSlider } from '../components/slider.js';
import { escapeHtml } from '../util.js';

export async function renderAssessment(root) {
  try {
    const [settings, areas, latest] = await Promise.all([
      getSettings(), loadAssessmentQuestions(), getLatestAssessment(),
    ]);
    const dimByKey = new Map(settings.healthDims.map((d) => [d.key, d]));

    const view = document.createElement('div');
    view.className = 'view view--assessment';
    view.innerHTML = `
      <div class="journal-write__header">
        <button class="icon-btn journal-write__back" id="la-back" aria-label="Back to Review">
          <svg viewBox="0 0 24 24" fill="none"><path d="M15 5l-7 7 7 7" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
      </div>
      <div class="assessment-intro-block">
        <h1 class="assessment-title">Life Assessment</h1>
        <p class="assessment-intro">A deeper look across your life. There are no wrong answers.</p>
        <p class="assessment-progress" id="la-progress">&nbsp;</p>
      </div>
      <div class="assessment-body" id="la-body"></div>
      <div class="assessment-save-bar">
        <button class="btn btn--primary" id="la-save">Save assessment</button>
      </div>
    `;
    root.appendChild(view);

    view.querySelector('#la-back').addEventListener('click', () => { location.hash = '#/review'; });

    const body = view.querySelector('#la-body');
    const progressEl = view.querySelector('#la-progress');
    const scores = {};
    const touched = new Set();

    function updateProgress() {
      progressEl.textContent = `${touched.size} of ${areas.length} scored`;
    }

    for (const area of areas) {
      const dim = dimByKey.get(area.key);
      const label = dim ? dim.label : area.key;
      const desc = dim ? dim.desc : '';

      const section = document.createElement('section');
      section.className = 'card assessment-area';
      section.innerHTML = `
        <h2 class="card__title">${escapeHtml(label)}</h2>
        ${desc ? `<p class="assessment-area__desc">${escapeHtml(desc)}</p>` : ''}
        ${area.questions.map((q, i) => `
          <div class="assessment-q">
            <label class="field-label">${escapeHtml(q)}</label>
            <textarea class="text-field text-field--area" data-key="${area.key}.${i}"></textarea>
          </div>
        `).join('')}
        <div class="assessment-slider-mount" data-key="${area.key}"></div>
      `;
      body.appendChild(section);

      // Prefill from the latest assessment -- fully editable, matches the app's
      // prefill-everywhere convention (see journal.js's makeHealthSlider).
      area.questions.forEach((_, i) => {
        const ta = section.querySelector(`textarea[data-key="${area.key}.${i}"]`);
        const prevText = latest?.reflections?.[`${area.key}.${i}`];
        if (prevText) ta.value = prevText;
      });

      const prevScore = latest?.scores?.[area.key];
      if (typeof prevScore === 'number') { scores[area.key] = prevScore; touched.add(area.key); }

      const slider = createHealthSlider({
        key: area.key, label: 'Score this area', value: prevScore, scale: '10',
        onChange: (v) => { scores[area.key] = v; touched.add(area.key); updateProgress(); },
      });
      section.querySelector('.assessment-slider-mount').appendChild(slider.el);
    }
    updateProgress();

    view.querySelector('#la-save').addEventListener('click', async () => {
      const finalScores = {};
      for (const key of touched) finalScores[key] = scores[key];
      const reflections = {};
      for (const area of areas) {
        area.questions.forEach((_, i) => {
          const ta = body.querySelector(`textarea[data-key="${area.key}.${i}"]`);
          const text = ta.value.trim();
          if (text) reflections[`${area.key}.${i}`] = text;
        });
      }
      await saveAssessment({ date: todayStr(), scores: finalScores, reflections });
      location.hash = '#/review';
    });
  } catch (err) {
    console.error('assessment view failed', err);
    root.innerHTML = `<div class="view"><p class="empty-hint">Something went wrong loading the Life Assessment.</p></div>`;
  }
}
