// components/slider.js — vertical "dial" rating control used for health tracking.
// Distinct from a generic <input type="range"> on purpose: three of these sit
// side-by-side like little thermometers, which reads much more custom than a
// row of native sliders.

const EMOJI_SCALE = ['😞', '😕', '😐', '🙂', '😄'];

export function createHealthSlider({ key, label, value, scale = '10', onChange }) {
  const max = scale === '5' ? 5 : scale === 'emoji' ? 5 : 10;
  const min = scale === 'emoji' ? 1 : 1;
  // Clamp on entry: a stored value from a previously wider scale (e.g. 10-point) can
  // exceed the current scale's max once the user narrows it (e.g. down to 5 or emoji),
  // which would otherwise push `pct` past 100% and index the emoji array out of bounds.
  let current = Math.min(max, Math.max(min, value ?? Math.round((max + min) / 2)));

  const wrap = document.createElement('div');
  wrap.className = 'hslider';
  wrap.innerHTML = `
    <div class="hslider__track" tabindex="0" role="slider" aria-label="${label}" aria-valuemin="${min}" aria-valuemax="${max}" aria-valuenow="${current}">
      <div class="hslider__fill"></div>
      <div class="hslider__thumb">
        <span class="hslider__value"></span>
      </div>
    </div>
    <div class="hslider__label">${label}</div>
  `;

  const track = wrap.querySelector('.hslider__track');
  const fill = wrap.querySelector('.hslider__fill');
  const thumb = wrap.querySelector('.hslider__thumb');
  const valueEl = wrap.querySelector('.hslider__value');

  function render() {
    const pct = ((current - min) / (max - min)) * 100;
    fill.style.height = `${pct}%`;
    thumb.style.bottom = `${pct}%`;
    valueEl.textContent = scale === 'emoji' ? (EMOJI_SCALE[current - 1] ?? EMOJI_SCALE[EMOJI_SCALE.length - 1]) : current;
    track.setAttribute('aria-valuenow', current);
  }

  function setFromClientY(clientY) {
    const rect = track.getBoundingClientRect();
    let pct = 1 - (clientY - rect.top) / rect.height;
    pct = Math.max(0, Math.min(1, pct));
    const raw = min + pct * (max - min);
    const next = Math.round(raw);
    if (next !== current) {
      current = next;
      render();
      onChange(current);
    }
  }

  let dragging = false;
  track.addEventListener('pointerdown', (e) => {
    dragging = true;
    track.setPointerCapture(e.pointerId);
    setFromClientY(e.clientY);
  });
  track.addEventListener('pointermove', (e) => { if (dragging) setFromClientY(e.clientY); });
  track.addEventListener('pointerup', () => { dragging = false; });
  track.addEventListener('pointercancel', () => { dragging = false; });
  track.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowUp' || e.key === 'ArrowRight') { current = Math.min(max, current + 1); render(); onChange(current); }
    if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') { current = Math.max(min, current - 1); render(); onChange(current); }
  });

  render();
  return { el: wrap, setValue: (v) => { current = Math.min(max, Math.max(min, v)); render(); } };
}
