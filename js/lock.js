// lock.js -- optional passcode lock (OFF by default). Small, self-contained: hashing,
// the full-screen entry overlay, and an idle timer that re-locks after the configured
// auto-lock timeout. app.js calls maybeShowLock() once at boot and startIdleWatch()
// after the app renders.
import { getSettings } from './store.js';

export async function hashPasscode(str) {
  const enc = new TextEncoder().encode(str);
  const buf = await crypto.subtle.digest('SHA-256', enc);
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function overlay(onSubmit, { title = 'Enter passcode', error = '' } = {}) {
  const el = document.createElement('div');
  el.className = 'lock-overlay';
  el.innerHTML = `
    <div class="lock-card">
      <div class="lock-icon">&#128274;</div>
      <h1>${title}</h1>
      <input type="password" inputmode="numeric" pattern="[0-9]*" class="lock-input" maxlength="8" autocomplete="off" />
      ${error ? `<p class="lock-error">${error}</p>` : ''}
      <button class="btn btn--primary lock-submit">Unlock</button>
    </div>
  `;
  document.body.appendChild(el);
  const input = el.querySelector('.lock-input');
  setTimeout(() => input.focus(), 50);
  function submit() { onSubmit(input.value, el); }
  el.querySelector('.lock-submit').addEventListener('click', submit);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
  return el;
}

export async function maybeShowLock() {
  const settings = await getSettings();
  if (!settings.lockEnabled || !settings.passcodeHash) return Promise.resolve();
  return new Promise((resolve) => {
    function attempt() {
      overlay(async (value, el) => {
        const hash = await hashPasscode(value);
        if (hash === settings.passcodeHash) {
          el.remove();
          resolve();
        } else {
          el.remove();
          overlay(async (v2, el2) => {
            const h2 = await hashPasscode(v2);
            if (h2 === settings.passcodeHash) { el2.remove(); resolve(); } else { el2.remove(); attempt(); }
          }, { error: 'Incorrect passcode -- try again.' });
        }
      });
    }
    attempt();
  });
}

let idleTimer = null;
let lockCallback = null;
export function startIdleWatch() {
  if (idleTimer) return;
  const reset = () => { lastActivity = Date.now(); };
  let lastActivity = Date.now();
  ['pointerdown', 'keydown', 'touchstart'].forEach((ev) => document.addEventListener(ev, reset, { passive: true }));
  idleTimer = setInterval(async () => {
    const settings = await getSettings();
    if (!settings.lockEnabled || !settings.passcodeHash) return;
    const minutes = settings.autoLockMinutes || 5;
    if (Date.now() - lastActivity > minutes * 60 * 1000) {
      lastActivity = Date.now();
      await maybeShowLock();
    }
  }, 15000);
}
