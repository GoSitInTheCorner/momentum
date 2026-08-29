// components/slider.js -- compact horizontal rating row used for health tracking.
// One per line: label + value on top, a thin draggable track underneath. Deliberately
// understated (flat accent fill, small thumb) rather than a big gradient "pill" -- reads
// as a refined settings-style control instead of a toy thermometer.

const EMOJI_SCALE = ['😞', '😕', '😐', '🙂', '😄'];

export function createHealthSlider({ key, label, value, scale = '10', desc, onChange }) {
  const max = scale === '5' ? 5 : scale === 'emoji' ? 5 : 10;
  const min = scale === 'emoji' ? 1 : 1;
  // Clamp on entry: a stored value from a previously wider scale (e.g. 10-point) can
  // exceed the current scale's max once the user narrows it (e.g. down to 5 or emoji),
  // which would otherwise push `pct` past 100% and index the emoji array out of bounds.
  let current = Math.min(max, Math.max(min, value ?? Math.round((max + min) / 2)));

  const wrap = document.createElement('div');
  wrap.className = 'hslider';
  wrap.innerHTML = `
    <div class="hslider__head">
      <span class="hslider__label">${label}</span>
      <span class="hslider__value"></span>
    </div>
    <div class="hslider__track" tabindex="0" role="slider" aria-label="${label}" aria-valuemin="${min}" aria-valuemax="${max}" aria-valuenow="${current}">
      <div class="hslider__fill"></div>
      <div class="hslider__thumb"></div>
    </div>
    ${desc ? `<div class="hslider__desc">${desc}</div>` : ''}
  `;

  const track = wrap.querySelector('.hslider__track');
  const fill = wrap.querySelector('.hslider__fill');
  const thumb = wrap.querySelector('.hslider__thumb');
  const valueEl = wrap.querySelector('.hslider__value');

  function render() {
    const pct = ((current - min) / (max - min)) * 100;
    fill.style.width = `${pct}%`;
    thumb.style.left = `${pct}%`;
    valueEl.textContent = scale === 'emoji' ? (EMOJI_SCALE[current - 1] ?? EMOJI_SCALE[EMOJI_SCALE.length - 1]) : current;
    track.setAttribute('aria-valuenow', current);
  }

  function setFromClientX(clientX) {
    const rect = track.getBoundingClientRect();
    let pct = (clientX - rect.left) / rect.width;
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
    setFromClientX(e.clientX);
  });
  track.addEventListener('pointermove', (e) => { if (dragging) setFromClientX(e.clientX); });
  track.addEventListener('pointerup', () => { dragging = false; });
  track.addEventListener('pointercancel', () => { dragging = false; });
  track.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowUp' || e.key === 'ArrowRight') { current = Math.min(max, current + 1); render(); onChange(current); }
    if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') { current = Math.max(min, current - 1); render(); onChange(current); }
  });

  render();
  return { el: wrap, setValue: (v) => { current = Math.min(max, Math.max(min, v)); render(); } };
}
