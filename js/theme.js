// theme.js — translates Settings into CSS custom properties / data-attributes on <html>.
// Nothing here touches the DB; app.js calls applyTheme(settings) whenever settings change.

const FONT_STACKS = {
  system: `-apple-system, ui-rounded, "SF Pro Rounded", "Segoe UI", Roboto, sans-serif`,
  serif: `ui-serif, "Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif`,
  rounded: `ui-rounded, "SF Pro Rounded", "Segoe UI Rounded", "Varela Round", sans-serif`,
  mono: `ui-monospace, "SF Mono", "Cascadia Code", "Consolas", monospace`,
  dyslexic: `"Comic Sans MS", "Comic Sans", "Trebuchet MS", sans-serif`,
};

const DISPLAY_STACK = `ui-serif, "Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif`;

const FONT_SIZE_SCALE = { S: 0.9, M: 1, L: 1.12, XL: 1.28 };
const LINE_SPACING = { compact: 1.3, normal: 1.55, relaxed: 1.85 };
const RADIUS_SCALE = { S: '8px', M: '16px', L: '26px' };

let mql = null;

function hexToRgb(hex) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!m) return { r: 193, g: 98, b: 45 };
  return { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) };
}
function mix(a, b, t) { return Math.round(a + (b - a) * t); }

export function applyTheme(settings) {
  const root = document.documentElement;

  // ---- color mode ----
  let mode = settings.theme;
  if (mode === 'system') {
    if (!mql) mql = window.matchMedia('(prefers-color-scheme: dark)');
    mode = mql.matches ? 'dark' : 'light';
  }
  root.setAttribute('data-theme', mode === 'amoled' ? 'amoled' : mode);

  // ---- accent ----
  const { r, g, b } = hexToRgb(settings.accent || '#c1622d');
  root.style.setProperty('--accent', settings.accent || '#c1622d');
  root.style.setProperty('--accent-rgb', `${r}, ${g}, ${b}`);
  const isDarkish = mode !== 'light';
  root.style.setProperty('--accent-soft', `rgba(${r}, ${g}, ${b}, ${isDarkish ? 0.22 : 0.14})`);
  root.style.setProperty('--accent-strong', `rgb(${mix(r, isDarkish ? 255 : 0, 0.15)}, ${mix(g, isDarkish ? 255 : 0, 0.15)}, ${mix(b, isDarkish ? 255 : 0, 0.15)})`);

  // ---- typography ----
  root.style.setProperty('--font-body', FONT_STACKS[settings.fontFamily] || FONT_STACKS.system);
  root.style.setProperty('--font-display', settings.fontFamily === 'mono' ? FONT_STACKS.mono : DISPLAY_STACK);
  root.style.setProperty('--font-scale', FONT_SIZE_SCALE[settings.fontSize] ?? 1);
  root.style.setProperty('--line-spacing', LINE_SPACING[settings.lineSpacing] ?? 1.55);

  // ---- density / radius ----
  root.setAttribute('data-density', settings.density || 'comfortable');
  root.style.setProperty('--radius', RADIUS_SCALE[settings.radius] ?? '16px');

  // ---- journal-specific ----
  root.style.setProperty('--journal-font', FONT_STACKS[settings.journalFont] || FONT_STACKS.serif);
  root.style.setProperty('--journal-scale', FONT_SIZE_SCALE[settings.journalFontSize] ?? 1);
}

// Re-apply automatically if the OS theme flips while settings.theme === 'system'.
export function watchSystemTheme(getSettings) {
  if (!mql) mql = window.matchMedia('(prefers-color-scheme: dark)');
  mql.addEventListener('change', async () => {
    const s = await getSettings();
    if (s.theme === 'system') applyTheme(s);
  });
}
