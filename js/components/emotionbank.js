// components/emotionbank.js — the Emotion Word Bank: one reusable bottom sheet used by
// both trigger points (journal editor "insert" mode, health-slider "tag" mode). Do not
// fork this markup/logic per call-site — every caller goes through openEmotionBank().
import { getEmotionFrequency, addEmotionTag } from '../store.js';
import { escapeHtml } from '../util.js';

// Shared "tag row" used both on Today (next to the Emotional slider) and in the
// Journal day-detail view — one implementation, two call sites.
export function mountEmotionTagRow(container, { date, tags }) {
  let current = [...(tags || [])];
  container.innerHTML = `
    <div class="emo-row">
      <div class="emo-row__tags"></div>
      <button class="emo-row__add" type="button" aria-label="Tag feelings">+ Feelings</button>
    </div>
  `;
  const tagsEl = container.querySelector('.emo-row__tags');
  function draw() {
    tagsEl.innerHTML = current.map((t) => `<span class="emo-pill">${escapeHtml(t)}</span>`).join('');
  }
  draw();
  container.querySelector('.emo-row__add').addEventListener('click', () => {
    openEmotionBank({
      mode: 'tag',
      selected: current,
      onToggleTag: async (word) => {
        current = await addEmotionTag(date, word);
        draw();
      },
    });
  });
}

const TAXONOMY = {
  Happy: ['Content', 'Proud', 'Optimistic', 'Playful', 'Grateful', 'Relieved', 'Excited', 'Confident', 'Peaceful', 'Amused'],
  Sad: ['Lonely', 'Disappointed', 'Discouraged', 'Regretful', 'Melancholy', 'Grieving', 'Hopeless', 'Homesick', 'Vulnerable'],
  Angry: ['Frustrated', 'Irritated', 'Resentful', 'Jealous', 'Betrayed', 'Defensive', 'Annoyed', 'Bitter', 'Hostile'],
  Fearful: ['Anxious', 'Nervous', 'Insecure', 'Worried', 'Overwhelmed', 'Panicked', 'Uneasy', 'Threatened', 'Hesitant'],
  Surprised: ['Amazed', 'Confused', 'Startled', 'Stunned', 'Curious', 'Astonished', 'Perplexed'],
  Disgusted: ['Repelled', 'Disapproving', 'Judgmental', 'Uncomfortable', 'Contempt', 'Weary'],
};

function shell() {
  const backdrop = document.createElement('div');
  backdrop.className = 'sheet-backdrop';
  const sheet = document.createElement('div');
  sheet.className = 'sheet sheet--form sheet--wordbank';
  backdrop.appendChild(sheet);
  document.body.appendChild(backdrop);
  requestAnimationFrame(() => backdrop.classList.add('is-open'));
  function close() { backdrop.classList.remove('is-open'); setTimeout(() => backdrop.remove(), 220); }
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });
  return { sheet, close };
}

/**
 * @param {{mode:'insert'|'tag', selected?:string[], onInsert?:(word:string)=>void, onToggleTag?:(word:string)=>void}} opts
 */
export async function openEmotionBank({ mode, selected = [], onInsert, onToggleTag }) {
  const { sheet, close } = shell();
  const frequent = (await getEmotionFrequency()).slice(0, 8).map((f) => f.word);

  sheet.innerHTML = `
    <div class="sheet__header">
      <h2 class="sheet__title">Emotion word bank</h2>
      <button class="sheet__close" aria-label="Close">
        <svg viewBox="0 0 24 24" fill="none"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
      </button>
    </div>
    <div class="sheet__body">
      <input type="text" class="wordbank__search" placeholder="Search feelings…" />
      ${frequent.length ? `
        <div class="wordbank__section">
          <h3 class="wordbank__section-title">Most used</h3>
          <div class="wordbank__chips" data-group="frequent">
            ${frequent.map((w) => chipHtml(w, mode, selected)).join('')}
          </div>
        </div>` : ''}
      <div class="wordbank__taxonomy">
        ${Object.entries(TAXONOMY).map(([core, words]) => `
          <div class="wordbank__section" data-core="${core.toLowerCase()}">
            <h3 class="wordbank__section-title">${core}</h3>
            <div class="wordbank__chips">
              ${words.map((w) => chipHtml(w, mode, selected)).join('')}
            </div>
          </div>
        `).join('')}
      </div>
    </div>
  `;

  sheet.querySelector('.sheet__close').addEventListener('click', close);

  sheet.querySelectorAll('.wordbank__chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      const word = chip.dataset.word;
      if (mode === 'insert') {
        onInsert?.(word);
        close();
      } else {
        chip.classList.toggle('is-selected');
        // keep the twin chip (frequent vs taxonomy) in sync if the word appears twice
        sheet.querySelectorAll(`.wordbank__chip[data-word="${cssEscape(word)}"]`).forEach((c) => {
          c.classList.toggle('is-selected', chip.classList.contains('is-selected'));
        });
        onToggleTag?.(word);
      }
    });
  });

  const search = sheet.querySelector('.wordbank__search');
  search.addEventListener('input', () => {
    const q = search.value.trim().toLowerCase();
    sheet.querySelectorAll('.wordbank__section').forEach((section) => {
      let anyVisible = false;
      section.querySelectorAll('.wordbank__chip').forEach((chip) => {
        const match = !q || chip.dataset.word.toLowerCase().includes(q);
        chip.hidden = !match;
        if (match) anyVisible = true;
      });
      section.hidden = !anyVisible;
    });
  });
  setTimeout(() => search.focus(), 80);

  return { close };
}

function chipHtml(word, mode, selected) {
  const isSelected = mode === 'tag' && selected.includes(word);
  return `<button type="button" class="wordbank__chip ${isSelected ? 'is-selected' : ''}" data-word="${word}">${word}</button>`;
}

function cssEscape(s) { return s.replace(/["\\]/g, '\\$&'); }
