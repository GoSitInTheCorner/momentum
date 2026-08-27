// components/savebadge.js — one reusable "Saving… -> Saved ✓" indicator, replacing the
// ad-hoc text swaps that used to be duplicated in today.js and journal.js. Extends the
// existing .autosave-hint CSS class (see css/styles.css) rather than inventing a new one.
export function wireAutosave(hintEl) {
  let clearTimer = null;
  return {
    saving() {
      if (!hintEl) return;
      clearTimeout(clearTimer);
      hintEl.classList.remove('is-saved');
      hintEl.textContent = 'Saving…';
    },
    saved() {
      if (!hintEl) return;
      hintEl.textContent = 'Saved ✓';
      hintEl.classList.add('is-saved');
      clearTimeout(clearTimer);
      clearTimer = setTimeout(() => {
        hintEl.textContent = ' ';
        hintEl.classList.remove('is-saved');
      }, 1500);
    },
  };
}
