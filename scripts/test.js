// Playwright end-to-end self-test for Momentum. Run with:
//   node scripts/test.js
// Requires the app to be served over http (see server command in the final report)
// and a `playwright` install accessible from this script's own node_modules path.
const path = require('path');
const { chromium } = require(path.join(
  'C:', 'Users', 'User', 'AppData', 'Local', 'Temp', 'claude',
  'C--Users-User-AI', '7a68ed11-77e2-4d45-87ea-1caa0da9f06a', 'scratchpad', 'pwtest', 'node_modules', 'playwright'
));

const BASE = 'http://localhost:8080';
const SHOT_DIR = 'C:\\Users\\User\\AI\\momentum\\screenshots';

const results = [];
function check(name, pass, detail = '') {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'} -- ${name}${detail ? ' :: ' + detail : ''}`);
}

async function main() {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({
    viewport: { width: 402, height: 874 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    colorScheme: 'light',
    acceptDownloads: true,
  });
  context.setDefaultTimeout(8000);

  const consoleErrors = [];
  const externalRequests = [];

  const page = await context.newPage();
  page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
  page.on('pageerror', (err) => consoleErrors.push('pageerror: ' + err.message));
  context.on('request', (req) => {
    const url = new URL(req.url());
    if (url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') {
      externalRequests.push(req.url());
    }
  });

  await page.goto(`${BASE}/index.html`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.tabbar', { timeout: 5000 });

  async function overflowOK(label) {
    const w = await page.evaluate(() => document.scrollingElement.scrollWidth);
    check(`no horizontal overflow (${label})`, w <= 402, `scrollWidth=${w}`);
  }
  async function gotoTab(tab) {
    // Defensive: a leftover open sheet would intercept the tab-bar click and hang
    // the whole run. If one is present (should not be, but don't cascade if so),
    // dismiss it first so a single UI bug fails one check instead of everything after it.
    const openSheets = await page.locator('.sheet-backdrop.is-open').count();
    if (openSheets > 0) {
      check('no unexpected open sheet before navigating to ' + tab, false, `found ${openSheets} open sheet(s)`);
      await page.mouse.click(200, 40);
      await page.waitForTimeout(300);
    }
    await page.click(`.tabbar__item[data-tab="${tab}"]`);
    await page.waitForTimeout(350);
  }
  async function screenshot(name) {
    await page.screenshot({ path: path.join(SHOT_DIR, name) });
  }

  // ---------- 1. Today: to-dos, journal, sliders, log ----------
  await gotoTab('today');
  await overflowOK('today-initial');

  await page.click('#add-task-btn');
  await page.fill('.sheet--prompt .sheet__input', 'Finish project proposal');
  await page.click('.sheet--prompt .sheet__submit');
  await page.waitForTimeout(200);

  await page.click('#add-task-btn');
  await page.fill('.sheet--prompt .sheet__input', 'Water the office plants');
  await page.click('.sheet--prompt .sheet__submit');
  await page.waitForTimeout(200);

  let taskCount = await page.locator('.task-row').count();
  check('two to-dos added', taskCount === 2, `count=${taskCount}`);

  await page.click('.task-row >> nth=0 >> .task-check');
  await page.waitForTimeout(700);
  const doneCount = await page.locator('.task-row.is-done').count();
  check('one to-do checked off (animated)', doneCount === 1, `is-done count=${doneCount}`);

  await page.fill('.journal-input', 'Reflecting on a solid, productive day. Feeling steady and focused.');
  await page.waitForTimeout(700);
  const journalVal = await page.inputValue('.journal-input');
  check('journal text entered', journalVal.includes('solid, productive day'));

  // Health sliders -- click near top of each track for a high value.
  const sliders = await page.locator('.hslider__track').all();
  for (const slider of sliders) {
    const box = await slider.boundingBox();
    await page.mouse.click(box.x + box.width / 2, box.y + box.height * 0.2);
    await page.waitForTimeout(150);
  }
  const sliderValues = await page.locator('.hslider__value').allTextContents();
  check('all 3 health sliders set', sliderValues.length === 3 && sliderValues.every((v) => v.trim().length > 0), JSON.stringify(sliderValues));

  await page.click('#add-done-btn');
  await page.fill('.sheet--prompt .sheet__input', 'Shipped the onboarding flow redesign');
  await page.click('.sheet--prompt .sheet__submit');
  await page.waitForTimeout(200);

  await page.click('#add-learned-btn');
  await page.fill('.sheet--prompt .sheet__input', 'Learned how CSS clip-path can fake a torn-paper edge');
  await page.click('.sheet--prompt .sheet__submit');
  await page.waitForTimeout(200);

  const logCount = await page.locator('.log-row').count();
  check('done + learned log items added', logCount === 2, `count=${logCount}`);

  // Emotion word bank -- tag mode (next to health sliders).
  await page.click('.emo-row__add');
  await page.waitForSelector('.sheet--wordbank', { timeout: 3000 });
  await page.fill('.wordbank__search', 'Proud');
  await page.waitForTimeout(150);
  await screenshot('emotion-wordbank-light.png');
  await page.click('.wordbank__chip:visible >> nth=0');
  await page.waitForTimeout(150);
  await page.mouse.click(200, 40); // tap backdrop area above the sheet to close
  await page.waitForTimeout(300);
  const tagText = await page.locator('.emo-pill').allTextContents();
  check('emotion tag added via slider trigger', tagText.some((t) => t.toLowerCase().includes('proud')), JSON.stringify(tagText));

  // Emotion word bank -- insert mode (journal toolbar).
  const beforeJournal = await page.inputValue('.journal-input');
  await page.click('#journal-emo-btn');
  await page.waitForSelector('.sheet--wordbank', { timeout: 3000 });
  await page.fill('.wordbank__search', 'Grateful');
  await page.waitForTimeout(150);
  await page.click('.wordbank__chip:visible >> nth=0');
  await page.waitForTimeout(300);
  const afterJournal = await page.inputValue('.journal-input');
  check('emotion word inserted into journal at cursor', afterJournal.length > beforeJournal.length && afterJournal.includes('Grateful'));
  await page.waitForTimeout(600); // let autosave debounce flush

  await overflowOK('today-populated');

  // ---------- 2. Goals ----------
  await gotoTab('goals');
  await page.click('#new-goal-btn');
  await page.waitForSelector('.sheet--form', { timeout: 3000 });
  await page.fill('#g-title', 'Read 12 books this year');
  await page.click('.chip-select__opt[data-cat="Learning"]');
  await page.fill('#g-new-milestone', 'Finish book one');
  await page.click('#g-add-milestone');
  await page.click('#g-save');
  await page.waitForTimeout(400);
  const goalCount = await page.locator('.goal-card').count();
  check('goal with milestone created', goalCount === 1, `count=${goalCount}`);
  await overflowOK('goals');

  // ---------- 3. Review: cycle all periods ----------
  await gotoTab('review');
  for (const period of ['daily', 'weekly', 'monthly', 'yearly']) {
    await page.click(`.period-toggle__btn[data-period="${period}"]`);
    await page.waitForTimeout(400);
  }
  await page.click('.period-toggle__btn[data-period="custom"]');
  await page.waitForTimeout(300);
  await overflowOK('review');
  const reviewCrashed = consoleErrors.length > 0;
  check('Review cycles all 4 periods + custom without console errors', !reviewCrashed, consoleErrors.join(' | '));

  // ---------- 4. Journal: entries + beliefs segment ----------
  await gotoTab('journal');
  await screenshot('journal-light.png');
  await page.click('.segmented__btn[data-segment="beliefs"]');
  await page.waitForTimeout(200);

  await page.click('#new-belief-btn');
  await page.waitForSelector('.sheet--form', { timeout: 3000 });
  await page.fill('#nb-topic', 'Universal basic income');
  await page.click('.chip-select__opt[data-cat="political"]');
  await page.fill('#nb-stance', 'Cautiously supportive, want to see more pilot data first.');
  await page.click('#nb-save');
  await page.waitForTimeout(400);

  await page.waitForSelector('.sheet--form .stance-update-form', { state: 'attached', timeout: 3000 });
  await page.click('#bd-update-toggle');
  await page.fill('#bd-new-stance', 'Supportive after reviewing the Finland/Kenya pilot results.');
  await page.fill('#bd-note', 'Read a summary of long-running UBI pilot outcomes.');
  await page.click('#bd-save-update');
  await page.waitForTimeout(400);
  // Expect 2: the "Initial stance" entry seeded by addBelief() + the one real update
  // just made above. Also confirm the newest entry (rendered first -- history is
  // shown reversed) actually records the NEW stance text, not a duplicate of the old one.
  const historyCount = await page.locator('.belief-history__item').count();
  check('belief stance update appended to history', historyCount === 2, `history items=${historyCount}`);
  const newestStance = await page.locator('.belief-history__item').first().locator('.belief-history__stance').textContent();
  check('newest history entry records the NEW stance value', (newestStance || '').includes('Finland/Kenya pilot results'), newestStance || '');
  await screenshot('journal-beliefs-light.png');
  await page.mouse.click(200, 40);
  await page.waitForTimeout(300);

  await gotoTab('journal');
  await page.click('.segmented__btn[data-segment="entries"]');
  await overflowOK('journal');

  // ---------- 5. Settings: theme, accent, font ----------
  await gotoTab('settings');
  await screenshot('settings-light.png');
  await overflowOK('settings');

  // Light-theme screenshots for the remaining tabs (today/goals/review already
  // implicitly light; capture the canonical set now that content exists).
  await gotoTab('today');
  await screenshot('today-light.png');
  await gotoTab('goals');
  await screenshot('goals-light.png');
  await gotoTab('review');
  await screenshot('review-light.png');
  await gotoTab('settings');

  await page.click('.segmented[data-field="theme"] [data-val="dark"]');
  await page.waitForTimeout(300);
  await screenshot('settings-dark.png');
  await overflowOK('settings-dark');

  await page.click('.accent-swatch[data-accent="#5b6ea8"]');
  await page.waitForTimeout(150);
  await page.click('.segmented[data-field="fontFamily"] [data-val="serif"]');
  await page.waitForTimeout(150);
  const accentVar = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--accent').trim());
  check('accent color setting applied live', accentVar.toLowerCase() === '#5b6ea8');

  await gotoTab('today'); await screenshot('today-dark.png'); await overflowOK('today-dark');
  await gotoTab('journal'); await screenshot('journal-dark.png');
  await page.click('.segmented__btn[data-segment="beliefs"]');
  await page.waitForTimeout(200);
  await screenshot('journal-beliefs-dark.png');
  await page.click('.belief-row >> nth=0');
  await page.waitForSelector('.sheet--form', { timeout: 3000 });
  await page.mouse.click(200, 40);
  await page.waitForTimeout(200);
  await page.click('.segmented__btn[data-segment="entries"]');
  await overflowOK('journal-dark');

  await gotoTab('goals'); await screenshot('goals-dark.png'); await overflowOK('goals-dark');
  await gotoTab('review'); await screenshot('review-dark.png'); await overflowOK('review-dark');

  // Emotion word bank screenshot in dark theme (re-open from Today).
  await gotoTab('today');
  await page.click('.emo-row__add');
  await page.waitForSelector('.sheet--wordbank', { timeout: 3000 });
  await screenshot('emotion-wordbank-dark.png');
  await page.mouse.click(200, 40);
  await page.waitForTimeout(200);

  // ---------- AMOLED theme check (not a required screenshot, just a functional check) ----------
  await gotoTab('settings');
  await page.click('.segmented[data-field="theme"] [data-val="amoled"]');
  await page.waitForTimeout(250);
  const bgVar = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--bg').trim());
  check('AMOLED theme applies true-black background', bgVar === '#000000', bgVar);

  // Reset to dark for the rest of the run (avoid confusing later assertions).
  await page.click('.segmented[data-field="theme"] [data-val="dark"]');
  await page.waitForTimeout(150);

  // ---------- Passcode lock: enable, verify it engages, then disable ----------
  // #s-lock-enabled is a real checkbox but visually hidden behind a styled `.switch`
  // track (opacity:0, width/height:0 in CSS), so a plain Playwright click reports it
  // as "not visible" and fails/flakes. Drive it directly: set `checked` and dispatch a
  // real `change` event, same as a user's tap on the visible track would produce.
  await page.locator('#s-lock-enabled').evaluate((el) => {
    el.checked = true;
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.waitForTimeout(150);
  await page.fill('#s-pass1', '1234');
  await page.fill('#s-pass2', '1234');
  await page.click('#s-pass-save');
  await page.waitForTimeout(200);
  await page.reload({ waitUntil: 'networkidle' });
  const lockVisible = await page.locator('.lock-overlay').count();
  check('passcode lock engages on reload when enabled', lockVisible === 1, `overlay count=${lockVisible}`);
  if (lockVisible) {
    await page.fill('.lock-input', '1234');
    await page.click('.lock-submit');
    await page.waitForTimeout(400);
  }
  const unlockedOK = await page.locator('.tabbar').count();
  check('correct passcode unlocks the app', unlockedOK === 1);
  // Disable lock again so remaining reload-based checks are not gated.
  await gotoTab('settings');
  await page.locator('#s-lock-enabled').evaluate((el) => {
    el.checked = false;
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.waitForTimeout(200);

  // ---------- Export / Import ----------
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.click('#s-export'),
  ]);
  const dlPath = await download.path();
  check('export backup produced a downloadable file', !!dlPath, dlPath || '');

  // ---------- Reload persistence check ----------
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('.tabbar', { timeout: 5000 });
  await gotoTab('today');
  const persistedTasks = await page.locator('.task-row').count();
  const persistedJournal = await page.inputValue('.journal-input');
  const persistedTagCount = await page.locator('.emo-pill').count();
  check('to-dos persisted after reload', persistedTasks === 2, `count=${persistedTasks}`);
  check('journal text persisted after reload', persistedJournal.includes('solid, productive day'));
  check('emotion tags persisted after reload', persistedTagCount >= 1, `count=${persistedTagCount}`);
  await gotoTab('goals');
  const persistedGoals = await page.locator('.goal-card').count();
  check('goal persisted after reload', persistedGoals === 1, `count=${persistedGoals}`);
  await gotoTab('journal');
  await page.click('.segmented__btn[data-segment="beliefs"]');
  await page.waitForTimeout(200);
  await page.click('.belief-row >> nth=0');
  await page.waitForSelector('.sheet--form', { timeout: 3000 });
  const persistedHistory = await page.locator('.belief-history__item').count();
  check('belief topic + full stance history persisted after reload', persistedHistory === 2, `history=${persistedHistory}`);
  await page.mouse.click(200, 40);
  // Sheet removal is timer-driven at 220ms (see components/sheet.js close()); 200ms here
  // raced it often enough to leave a stale open sheet for the next gotoTab() check.
  // Match the 300ms margin already used elsewhere in this file for the same idiom.
  await page.waitForTimeout(300);
  const themeAfterReload = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
  check('theme setting persisted after reload', themeAfterReload === 'dark', themeAfterReload);

  // ---------- Sparse-data Review check (fresh custom range with no data) ----------
  await gotoTab('review');
  await page.click('.period-toggle__btn[data-period="custom"]');
  await page.fill('#custom-start', '2020-01-01');
  await page.fill('#custom-end', '2020-01-07');
  await page.waitForTimeout(400);
  check('Review handles an empty custom range without crashing', consoleErrors.length === 0, consoleErrors.join(' | '));

  // ---------- Offline mode ----------
  await context.setOffline(true);
  await page.reload({ waitUntil: 'load' }).catch((e) => check('offline reload did not throw', false, e.message));
  await page.waitForTimeout(1000);
  const offlineTabbar = await page.locator('.tabbar').count();
  check('app renders while offline (service worker cache hit)', offlineTabbar === 1, `tabbar count=${offlineTabbar}`);
  await gotoTab('journal');
  const offlineOverflow = await page.evaluate(() => document.scrollingElement.scrollWidth);
  check('offline navigation works (Journal tab reachable)', offlineOverflow <= 402);
  await context.setOffline(false);

  // ---------- Final assertions: console + network ----------
  check('zero console errors across full run', consoleErrors.length === 0, consoleErrors.slice(0, 10).join(' | '));
  check('zero external network requests (vendored libs only)', externalRequests.length === 0, externalRequests.slice(0, 10).join(' | '));

  await browser.close();

  const failed = results.filter((r) => !r.pass);
  console.log('\n=== SUMMARY ===');
  console.log(`${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) {
    console.log('FAILURES:');
    failed.forEach((f) => console.log(` - ${f.name}: ${f.detail}`));
    process.exitCode = 1;
  }
}

main().catch((err) => { console.error('TEST SCRIPT CRASHED:', err); process.exitCode = 1; });
