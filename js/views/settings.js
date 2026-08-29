// views/settings.js -- rich, live-applying preferences. Every control here writes
// through saveSettings() immediately (no Save button); app.js reacts to the
// 'settings-changed' event to re-run applyTheme() app-wide.
import { getSettings, saveSettings, exportBackup, importBackup, clearAllData, estimateStorageUsage } from '../store.js';
import { hashPasscode } from '../lock.js';
import { escapeHtml } from '../util.js';
import { APP_VERSION } from '../version.js';

const THEME_OPTIONS = [
  { id: 'light', label: 'Light' }, { id: 'dark', label: 'Dark' },
  { id: 'system', label: 'System' }, { id: 'amoled', label: 'AMOLED' },
];
const FONT_OPTIONS = [
  { id: 'system', label: 'System' }, { id: 'serif', label: 'Serif' },
  { id: 'rounded', label: 'Rounded' }, { id: 'mono', label: 'Mono' }, { id: 'dyslexic', label: 'Dyslexia-friendly' },
];
const SIZE_OPTIONS = ['S', 'M', 'L', 'XL'];
const ACCENT_PRESETS = ['#c1622d', '#4a7a63', '#5b6ea8', '#a24a72', '#b08a2e', '#5c8a9e'];

export async function renderSettings(root) {
  const view = document.createElement('div');
  view.className = 'view view--settings';
  view.innerHTML = `
    <header class="topbar">
      <div class="topbar__eyebrow">Make it yours</div>
      <h1 class="topbar__title">Settings</h1>
    </header>
    <div class="scroll-area">
      <section class="card"><h2 class="card__title">Appearance</h2><div id="s-appearance"></div></section>
      <section class="card"><h2 class="card__title">Behavior</h2><div id="s-behavior"></div></section>
      <section class="card"><h2 class="card__title">Home &amp; widgets</h2><div id="s-home"></div></section>
      <section class="card"><h2 class="card__title">Health tracking</h2><div id="s-health"></div></section>
      <section class="card"><h2 class="card__title">Journal</h2><div id="s-journal"></div></section>
      <section class="card"><h2 class="card__title">Privacy &amp; lock</h2><div id="s-lock"></div></section>
      <section class="card"><h2 class="card__title">Data</h2><div id="s-data"></div></section>
      <p style="text-align:center;opacity:.55;font-size:.8rem;margin:18px 0 8px;">Momentum v${APP_VERSION}</p>
      <button class="btn" id="s-force-refresh" style="opacity:.85">Force refresh (clear cache &amp; reload)</button>
      <div class="scroll-spacer"></div>
    </div>
  `;
  root.appendChild(view);

  // Nuke all caches + service workers, then hard-reload -- the bulletproof "I still see
  // the old version" escape hatch. (Normal updates apply automatically via app.js.)
  view.querySelector('#s-force-refresh').addEventListener('click', async () => {
    try {
      if ('caches' in window) { const keys = await caches.keys(); await Promise.all(keys.map((k) => caches.delete(k))); }
      if ('serviceWorker' in navigator) { const regs = await navigator.serviceWorker.getRegistrations(); await Promise.all(regs.map((r) => r.unregister())); }
    } catch (_) { /* ignore */ }
    window.location.reload();
  });

  let settings = await getSettings();
  async function update(patch) {
    settings = await saveSettings(patch);
  }

  renderAppearance(view.querySelector('#s-appearance'), settings, update);
  renderBehavior(view.querySelector('#s-behavior'), settings, update);
  renderHome(view.querySelector('#s-home'), settings, update);
  renderHealth(view.querySelector('#s-health'), settings, update);
  renderJournalSection(view.querySelector('#s-journal'), settings, update);
  renderLock(view.querySelector('#s-lock'), settings, update);
  await renderData(view.querySelector('#s-data'), settings, update);
}

function row(labelHtml, controlHtml) {
  return `<div class="settings-row"><div class="settings-row__label">${labelHtml}</div><div class="settings-row__control">${controlHtml}</div></div>`;
}

function segButtons(name, options, current, attr = 'data-val') {
  return `<div class="segmented segmented--settings" data-field="${name}">
    ${options.map((o) => `<button class="segmented__btn ${(o.id ?? o) === current ? 'is-active' : ''}" ${attr}="${o.id ?? o}">${o.label ?? o}</button>`).join('')}
  </div>`;
}

function renderAppearance(el, settings, update) {
  el.innerHTML = `
    ${row('Theme', segButtons('theme', THEME_OPTIONS, settings.theme))}
    ${row('Accent color', `
      <div class="accent-row">
        ${ACCENT_PRESETS.map((c) => `<button class="accent-swatch ${c === settings.accent ? 'is-active' : ''}" style="background:${c}" data-accent="${c}"></button>`).join('')}
        <input type="color" class="accent-picker" value="${settings.accent}" id="s-accent-custom" />
      </div>`)}
    ${row('Font family', segButtons('fontFamily', FONT_OPTIONS, settings.fontFamily))}
    ${row('Font size', segButtons('fontSize', SIZE_OPTIONS, settings.fontSize))}
    ${row('Line spacing', segButtons('lineSpacing', ['compact', 'normal', 'relaxed'], settings.lineSpacing))}
    ${row('Density', segButtons('density', ['comfortable', 'compact'], settings.density))}
    ${row('Corner radius', segButtons('radius', SIZE_OPTIONS.slice(0, 3), settings.radius))}
  `;
  el.querySelectorAll('.segmented[data-field]').forEach((seg) => {
    seg.addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-val]');
      if (!btn) return;
      seg.querySelectorAll('.segmented__btn').forEach((b) => b.classList.toggle('is-active', b === btn));
      await update({ [seg.dataset.field]: btn.dataset.val });
    });
  });
  el.querySelectorAll('.accent-swatch').forEach((sw) => {
    sw.addEventListener('click', async () => {
      el.querySelectorAll('.accent-swatch').forEach((s) => s.classList.toggle('is-active', s === sw));
      el.querySelector('#s-accent-custom').value = sw.dataset.accent;
      await update({ accent: sw.dataset.accent });
    });
  });
  el.querySelector('#s-accent-custom').addEventListener('input', async (e) => {
    el.querySelectorAll('.accent-swatch').forEach((s) => s.classList.remove('is-active'));
    await update({ accent: e.target.value });
  });
}

function renderBehavior(el, settings, update) {
  el.innerHTML = `
    ${row('Default landing tab', segButtons('landingTab', ['today', 'journal', 'tasks', 'goals', 'review'], settings.landingTab))}
    ${row('Week starts on', segButtons('weekStart', ['sun', 'mon'], settings.weekStart))}
    ${row('Date format', segButtons('dateFormat', ['MMM D', 'D/M', 'M/D', 'YYYY-MM-DD'], settings.dateFormat))}
    ${row('Time format', segButtons('timeFormat', ['12', '24'], settings.timeFormat))}
  `;
  el.querySelectorAll('.segmented[data-field]').forEach((seg) => {
    seg.addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-val]');
      if (!btn) return;
      seg.querySelectorAll('.segmented__btn').forEach((b) => b.classList.toggle('is-active', b === btn));
      await update({ [seg.dataset.field]: btn.dataset.val });
    });
  });
}

const HOME_WIDGET_ROWS = [
  ['weather', 'Weather'], ['news', 'News peek'], ['wordOfDay', 'Words to sit with'],
  ['astrology', 'Astrology'], ['calendar', 'Calendar'], ['atAGlance', 'At-a-glance strip'],
  ['todayTasks', "Today's tasks"], ['checkin', 'Daily check-in'],
];

function renderHome(el, settings, update) {
  el.innerHTML = `
    ${row('Birth date', `<input type="date" class="text-field" id="s-birth-date" value="${settings.birthDate || ''}" />`)}
    ${row('Birth time (optional)', `<input type="time" class="text-field" id="s-birth-time" value="${settings.birthTime || ''}" />`)}
    <p class="settings-hint">Birth time refines your Moon sign -- without it, the Moon sign shown is approximate.</p>
    ${row('Weather city (fallback)', `<input type="text" class="text-field" id="s-weather-city" placeholder="e.g. Kansas City" value="${escapeHtml(settings.weatherCity || '')}" />`)}
    ${row('Weather units', segButtons('weatherUnits', ['C', 'F'], settings.weatherUnits))}
    ${row('News topic (optional)', `<input type="text" class="text-field" id="s-news-topic" placeholder="e.g. technology" value="${escapeHtml(settings.newsTopic || '')}" />`)}
    <label class="field-label">Home widgets</label>
    ${HOME_WIDGET_ROWS.map(([key, label]) => row(label, `<label class="switch"><input type="checkbox" data-widget="${key}" ${settings.homeWidgets?.[key] !== false ? 'checked' : ''}/><span class="switch__track"></span></label>`)).join('')}
  `;
  el.querySelector('.segmented[data-field="weatherUnits"]').addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-val]');
    if (!btn) return;
    el.querySelectorAll('.segmented[data-field="weatherUnits"] .segmented__btn').forEach((b) => b.classList.toggle('is-active', b === btn));
    await update({ weatherUnits: btn.dataset.val });
  });
  el.querySelector('#s-birth-date').addEventListener('change', (e) => update({ birthDate: e.target.value || null }));
  el.querySelector('#s-birth-time').addEventListener('change', (e) => update({ birthTime: e.target.value || null }));
  el.querySelector('#s-weather-city').addEventListener('change', (e) => update({ weatherCity: e.target.value.trim() }));
  el.querySelector('#s-news-topic').addEventListener('change', (e) => update({ newsTopic: e.target.value.trim() }));
  el.querySelectorAll('[data-widget]').forEach((cb) => {
    cb.addEventListener('change', async (e) => {
      const key = e.target.dataset.widget;
      await update({ homeWidgets: { ...settings.homeWidgets, [key]: e.target.checked } });
    });
  });
}

function renderHealth(el, settings, update) {
  function draw() {
    el.innerHTML = `
      <ul class="dim-list">
        ${settings.healthDims.map((d, i) => `
          <li class="dim-row">
            <label class="switch"><input type="checkbox" data-i="${i}" class="dim-toggle" ${d.enabled ? 'checked' : ''}/><span class="switch__track"></span></label>
            <span class="dim-row__label">${d.label}</span>
          </li>
        `).join('')}
      </ul>
      <div class="milestone-add">
        <input type="text" class="text-field" id="s-new-dim" placeholder="Add custom dimension" />
        <button class="chip-btn" id="s-add-dim">+ Add</button>
      </div>
      ${row('Rating scale', segButtons('ratingScale', ['5', '10', 'emoji'], settings.ratingScale))}
    `;
    el.querySelectorAll('.dim-toggle').forEach((cb) => {
      cb.addEventListener('change', async (e) => {
        const i = Number(e.target.dataset.i);
        settings.healthDims[i].enabled = e.target.checked;
        await update({ healthDims: settings.healthDims });
      });
    });
    el.querySelector('.segmented[data-field="ratingScale"]').addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-val]');
      if (!btn) return;
      await update({ ratingScale: btn.dataset.val });
      draw();
    });
    el.querySelector('#s-add-dim').addEventListener('click', async () => {
      const input = el.querySelector('#s-new-dim');
      const label = input.value.trim();
      if (!label) return;
      const key = 'custom_' + label.toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 24);
      settings.healthDims.push({ key, label, enabled: true });
      await update({ healthDims: settings.healthDims });
      draw();
    });
  }
  draw();
}

function renderJournalSection(el, settings, update) {
  el.innerHTML = `
    ${row('Journal font', segButtons('journalFont', FONT_OPTIONS, settings.journalFont))}
    ${row('Journal font size', segButtons('journalFontSize', SIZE_OPTIONS, settings.journalFontSize))}
    ${row('Daily prompt', `<label class="switch"><input type="checkbox" id="s-prompt" ${settings.dailyPrompt ? 'checked' : ''}/><span class="switch__track"></span></label>`)}
    ${row('Markdown rendering', `<label class="switch"><input type="checkbox" id="s-md" ${settings.markdownRender ? 'checked' : ''}/><span class="switch__track"></span></label>`)}
  `;
  el.querySelectorAll('.segmented[data-field]').forEach((seg) => {
    seg.addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-val]');
      if (!btn) return;
      seg.querySelectorAll('.segmented__btn').forEach((b) => b.classList.toggle('is-active', b === btn));
      await update({ [seg.dataset.field]: btn.dataset.val });
    });
  });
  el.querySelector('#s-prompt').addEventListener('change', (e) => update({ dailyPrompt: e.target.checked }));
  el.querySelector('#s-md').addEventListener('change', (e) => update({ markdownRender: e.target.checked }));
}

function renderLock(el, settings, update) {
  function draw() {
    const hasPasscode = !!settings.passcodeHash;
    el.innerHTML = `
      ${row('Passcode lock', `<label class="switch"><input type="checkbox" id="s-lock-enabled" ${settings.lockEnabled ? 'checked' : ''}/><span class="switch__track"></span></label>`)}
      <div id="s-lock-setup" ${settings.lockEnabled ? '' : 'hidden'}>
        <label class="field-label">${hasPasscode ? 'Change passcode' : 'Set passcode'}</label>
        <input type="password" inputmode="numeric" class="text-field" id="s-pass1" placeholder="New passcode (4-8 digits)" maxlength="8" />
        <input type="password" inputmode="numeric" class="text-field" id="s-pass2" placeholder="Confirm passcode" maxlength="8" />
        <button class="btn btn--secondary" id="s-pass-save">Save passcode</button>
        <p class="settings-hint" id="s-pass-status">${hasPasscode ? 'Passcode is set.' : 'No passcode set yet -- lock will not engage until one is saved.'}</p>
        ${row('Auto-lock after', segButtons('autoLockMinutes', [1, 5, 15, 30], settings.autoLockMinutes))}
      </div>
    `;
    el.querySelector('#s-lock-enabled').addEventListener('change', async (e) => {
      settings.lockEnabled = e.target.checked;
      await update({ lockEnabled: e.target.checked });
      draw();
    });
    const setupBox = el.querySelector('#s-lock-setup');
    if (setupBox) {
      const seg = el.querySelector('.segmented[data-field="autoLockMinutes"]');
      if (seg) seg.addEventListener('click', async (e) => {
        const btn = e.target.closest('[data-val]');
        if (!btn) return;
        seg.querySelectorAll('.segmented__btn').forEach((b) => b.classList.toggle('is-active', b === btn));
        await update({ autoLockMinutes: Number(btn.dataset.val) });
      });
      el.querySelector('#s-pass-save').addEventListener('click', async () => {
        const p1 = el.querySelector('#s-pass1').value.trim();
        const p2 = el.querySelector('#s-pass2').value.trim();
        const status = el.querySelector('#s-pass-status');
        if (p1.length < 4) { status.textContent = 'Passcode must be at least 4 digits.'; return; }
        if (p1 !== p2) { status.textContent = 'Passcodes do not match.'; return; }
        const hash = await hashPasscode(p1);
        await update({ passcodeHash: hash });
        status.textContent = 'Passcode saved.';
        el.querySelector('#s-pass1').value = '';
        el.querySelector('#s-pass2').value = '';
      });
    }
  }
  draw();
}

async function renderData(el, settings, update) {
  const usage = await estimateStorageUsage();
  const usageText = usage.usage != null ? `${(usage.usage / 1024 / 1024).toFixed(2)} MB used${usage.quota ? ` of ~${(usage.quota / 1024 / 1024 / 1024).toFixed(1)} GB` : ''}` : 'Unavailable in this browser.';
  el.innerHTML = `
    ${row('Storage used', `<span class="settings-hint">${usageText}</span>`)}
    <div class="data-actions">
      <button class="btn btn--secondary" id="s-export">Export backup (JSON)</button>
      <label class="btn btn--secondary" for="s-import-file" id="s-import-label">Import backup</label>
      <input type="file" id="s-import-file" accept="application/json" hidden />
      <button class="btn btn--danger" id="s-clear">Clear all data</button>
    </div>
    <p class="settings-hint" id="s-data-status">&nbsp;</p>
  `;
  const status = el.querySelector('#s-data-status');

  el.querySelector('#s-export').addEventListener('click', async () => {
    const backup = await exportBackup();
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `momentum-backup-${backup.exportedAt.slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    status.textContent = 'Backup downloaded.';
  });

  el.querySelector('#s-import-file').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const payload = JSON.parse(text);
      await importBackup(payload);
      status.textContent = 'Backup imported. Reloading...';
      setTimeout(() => location.reload(), 800);
    } catch (err) {
      status.textContent = `Import failed: ${err.message}`;
    }
    e.target.value = '';
  });

  el.querySelector('#s-clear').addEventListener('click', () => {
    if (!confirm('This will permanently delete all journal entries, to-dos, goals, and settings. Continue?')) return;
    if (!confirm('Are you absolutely sure? This cannot be undone.')) return;
    clearAllData().then(() => {
      status.textContent = 'All data cleared. Reloading...';
      setTimeout(() => location.reload(), 600);
    });
  });
}
