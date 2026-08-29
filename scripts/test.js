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
let browser; // module-scope so the finally handler can always close it, even on a crash

// Home's weather/news/dictionary widgets are the only legitimate external calls in v2
// (all keyless, CORS-open, see docs/SPEC.md). Anything else would be a real regression.
const ALLOWED_EXTERNAL_HOSTS = new Set([
  'api.open-meteo.com', 'geocoding-api.open-meteo.com', 'noozra.com', 'api.dictionaryapi.dev',
]);

// Tasks-tab persistence check (v2.5): a task dated N days in the past must still show
// up in the "To do" list (it's a persistent all-dates list now, no more today-only +
// manual carryover).
function dateNDaysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const da = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${da}`;
}

const ZODIAC_SIGNS = [
  'Aries', 'Taurus', 'Gemini', 'Cancer', 'Leo', 'Virgo',
  'Libra', 'Scorpio', 'Sagittarius', 'Capricorn', 'Aquarius', 'Pisces',
];

// v2.3 -- "Words to sit with" shows 1-3 pairs (2-6 words), deterministic by date --
// mirrors services/wordpairs.js's pairsForDate() count formula so the assertion is
// correct no matter what day this suite runs on. today.js calls pairsForDate() with a
// local-MIDNIGHT Date reconstructed from todayStr() (y/m/d, no time-of-day), and
// dayOfYear()'s naive local-midnight subtraction loses an hour across the DST
// spring-forward boundary -- so this must reconstruct that same midnight Date rather
// than use the live current-time Date, or it'll disagree with the app by one day.
function expectedWordPairWordCount(date = new Date()) {
  const midnight = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const start = new Date(midnight.getFullYear(), 0, 0);
  const dayOfYear = Math.floor((midnight - start) / 86400000);
  return (1 + (dayOfYear % 3)) * 2;
}

const results = [];
function check(name, pass, detail = '') {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'} -- ${name}${detail ? ' :: ' + detail : ''}`);
}

async function main() {
  // Headless for this long (~100-check) suite: headed Chromium's window + GPU compositor
  // overhead nondeterministically OOM-crashes the renderer partway through on a 16GB box.
  // Headless runs the identical assertions and screenshots with a fraction of the memory.
  browser = await chromium.launch({ headless: true, args: ['--disable-dev-shm-usage'] });
  const context = await browser.newContext({
    viewport: { width: 402, height: 874 },
    deviceScaleFactor: 1, // 1 to keep this long headed run under the renderer's memory ceiling; screenshots stay legible at 402px and the deployed app's real DPR is unaffected

    isMobile: true,
    hasTouch: true,
    colorScheme: 'light',
    acceptDownloads: true,
  });
  context.setDefaultTimeout(10000);

  const consoleErrors = [];
  const externalRequests = [];

  const page = await context.newPage();
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const text = msg.text();
    // Chromium logs a "Failed to load resource" console error for ANY non-2xx or
    // failed network request -- including the online-only widgets' *expected* graceful
    // degradation (a keyless API returning non-2xx, or an offline fetch). Those are
    // already caught + console.warn'd in app code, never console.error'd -- this is
    // browser-level network noise, not a JS bug. Real app errors still get through.
    if (/^Failed to load resource:/.test(text)) return;
    consoleErrors.push(text);
  });
  page.on('pageerror', (err) => consoleErrors.push('pageerror: ' + err.message));
  context.on('request', (req) => {
    const url = new URL(req.url());
    if (url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') {
      externalRequests.push(req.url());
    }
  });

  await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
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
  // v2.2 -- Settings moved off the tab bar to a gear button in the current view's
  // header (app.js injects it into every view except Settings itself and the
  // immersive journal-writing screen). Navigate to it from wherever we are.
  async function openSettings() {
    const openSheets = await page.locator('.sheet-backdrop.is-open').count();
    if (openSheets > 0) {
      await page.mouse.click(200, 40);
      await page.waitForTimeout(300);
    }
    await page.click('.topbar__gear');
    await page.waitForTimeout(350);
  }
  async function ensureSettings() {
    const onSettings = await page.locator('.view--settings').count();
    if (!onSettings) await openSettings();
  }
  async function screenshot(name) {
    await page.screenshot({ path: path.join(SHOT_DIR, name) });
  }

  // ---------- 0. Settings: set birth date/time / weather city / news topic up front so
  // Home's astrology + weather-fallback + news widgets have something to work with. ----------
  await openSettings();
  await page.fill('#s-birth-date', '1990-06-15'); // Gemini
  await page.dispatchEvent('#s-birth-date', 'change');
  await page.fill('#s-birth-time', '14:30');
  await page.dispatchEvent('#s-birth-time', 'change');
  await page.fill('#s-weather-city', 'Kansas City');
  await page.dispatchEvent('#s-weather-city', 'change');
  await page.fill('#s-news-topic', 'technology');
  await page.dispatchEvent('#s-news-topic', 'change');
  await page.waitForTimeout(150);
  const widgetToggleCount = await page.locator('[data-widget]').count();
  check('Settings has all 8 home-widget toggles', widgetToggleCount === 8, `count=${widgetToggleCount}`);

  // v2.1 -- Burchard's 10 Life Areas (11 total incl. Emotional): turn on all 8 extra
  // dims up front (core 3 are already enabled by default) so the rest of this run has
  // full data to exercise the Journal check-in's expand group and Review's Wheel of Life.
  await page.locator('.dim-toggle').evaluateAll((els) => {
    els.forEach((el) => { if (!el.checked) { el.checked = true; el.dispatchEvent(new Event('change', { bubbles: true })); } });
  });
  await page.waitForTimeout(150);
  const dimToggleCount = await page.locator('.dim-toggle').count();
  check('Settings has all 11 health-dim toggles', dimToggleCount === 11, `count=${dimToggleCount}`);

  // ---------- 1. Home: read-mostly launchpad (+ the one editable exception: to-dos) ----------
  await gotoTab('today');
  await overflowOK('home-initial');

  // v2.6 -- the "How are you today?" check-in moved here from the Journal hub, so Home
  // now legitimately has sliders; a full free-text journal entry is still Journal-only.
  const noTextareaOnHome = await page.locator('.view--today textarea').count();
  check('Home has no full-text journal entry surface (no textarea)', noTextareaOnHome === 0, `count=${noTextareaOnHome}`);

  // v2.2 -- compact "Today's tasks" card: view, check off, quick-add inline.
  const homeTaskCard = await page.locator('#w-tasks .home-tasklist').count();
  check('Home shows the compact "Today\'s tasks" card', homeTaskCard === 1, `count=${homeTaskCard}`);
  await page.fill('#home-tasklist-input', 'Home quick add task');
  await page.click('#home-tasklist-add-btn');
  await page.waitForTimeout(250);
  const homeTaskRows = await page.locator('.home-tasklist__row').count();
  check('quick-add on Home creates a to-do', homeTaskRows === 1, `count=${homeTaskRows}`);
  await page.click('.home-tasklist__row >> nth=0 >> .task-check');
  await page.waitForTimeout(700);
  const homeTaskDone = await page.locator('.home-tasklist__row.is-done').count();
  check('checking off a to-do on Home works', homeTaskDone === 1, `count=${homeTaskDone}`);

  // ---------------- "How are you today?" check-in (v2.6 -- moved here from the
  // Journal hub; always visible now, no collapsible toggle, no done/learned log). ------
  // Health sliders -- click near the right end of each (horizontal) track for a high
  // value. Verify the shared autosave badge also flashes on a slider change. All 8
  // non-core areas were already enabled in Settings above, so they're already in the
  // always-visible row too -- 11 tracks total, not just the core 3.
  const checkinSliders = await page.locator('#checkin-health-row .hslider__track').all();
  for (const slider of checkinSliders) {
    const box = await slider.boundingBox();
    await page.mouse.click(box.x + box.width * 0.8, box.y + box.height / 2);
    await page.waitForTimeout(150);
  }
  const checkinSliderValues = await page.locator('#checkin-health-row .hslider__value').allTextContents();
  check('all 11 always-visible health sliders set on the Today check-in (core 3 + every enabled life area)', checkinSliderValues.length === 11 && checkinSliderValues.every((v) => v.trim().length > 0), JSON.stringify(checkinSliderValues));
  const hintAfterCheckinSlider = await page.locator('#checkin-hint').innerText();
  check('"Saved" indicator also flashes on a check-in slider change', /Saved/.test(hintAfterCheckinSlider), hintAfterCheckinSlider);

  // v2.3 -- all 10+ life areas are always findable to rate: an enabled non-core area
  // joins the core 3 in the always-visible row (never stuck behind an unreached
  // expander), and only areas still NOT enabled sit behind "Rate more life areas".
  const allEnabledCheckinTracks = await page.locator('#checkin-health-row .hslider__track').count();
  check('all 11 sliders show immediately once every life area is enabled in Settings', allEnabledCheckinTracks === 11, `count=${allEnabledCheckinTracks}`);
  const checkinExpandHiddenWhenNothingLeft = await page.locator('#checkin-life-areas-toggle').isHidden();
  check('"Rate more life areas" toggle hides once nothing remains to expand', checkinExpandHiddenWhenNothingLeft);

  // Set two of the areas via slider interaction; confirm the shared autosave badge
  // fires for them too, same as the core-3 check above.
  const financeSlider = page.locator('#checkin-health-row .hslider__track[aria-label="Finances"]');
  const spiritSlider = page.locator('#checkin-health-row .hslider__track[aria-label="Spirit"]');
  // Also fill a few more of the 8 (visual richness for the screenshot only, no
  // dedicated assertions on these beyond "no crash / no overflow").
  const familySlider = page.locator('#checkin-health-row .hslider__track[aria-label="Family"]');
  const adventureSlider = page.locator('#checkin-health-row .hslider__track[aria-label="Adventure"]');
  for (const slider of [financeSlider, spiritSlider, familySlider, adventureSlider]) {
    await slider.waitFor({ state: 'visible', timeout: 15000 });
    await slider.scrollIntoViewIfNeeded();
    const box = await slider.boundingBox();
    await page.mouse.click(box.x + box.width * 0.85, box.y + box.height / 2);
    await page.waitForTimeout(150);
  }
  const hintAfterExpandedCheckinSlider = await page.locator('#checkin-hint').innerText();
  check('"Saved" indicator also flashes on a life-area slider change', /Saved/.test(hintAfterExpandedCheckinSlider), hintAfterExpandedCheckinSlider);
  const financeValueText = (await page.locator('#checkin-health-row .hslider:has(.hslider__track[aria-label="Finances"]) .hslider__value').innerText()).trim();
  const spiritValueText = (await page.locator('#checkin-health-row .hslider:has(.hslider__track[aria-label="Spirit"]) .hslider__value').innerText()).trim();
  check('Finances and Spirit sliders show a set value', financeValueText.length > 0 && spiritValueText.length > 0, `${financeValueText} / ${spiritValueText}`);
  await screenshot('home-checkin.png');
  await overflowOK('home-checkin-expanded');

  // Emotion word bank -- tag mode (next to the check-in health sliders).
  await page.click('#w-checkin .emo-row__add');
  await page.waitForSelector('.sheet--wordbank', { timeout: 3000 });
  await page.fill('.wordbank__search', 'Proud');
  await page.waitForTimeout(150);
  await screenshot('emotion-wordbank-light.png');
  await page.click('.wordbank__chip:visible >> nth=0');
  await page.waitForTimeout(150);
  await page.mouse.click(200, 40); // tap backdrop area above the sheet to close
  await page.waitForTimeout(300);
  const tagText = await page.locator('#w-checkin .emo-pill').allTextContents();
  check('emotion tag added via check-in slider trigger', tagText.some((t) => t.toLowerCase().includes('proud')), JSON.stringify(tagText));

  // Astrology -- offline, deterministic from the birth date/time set above.
  await page.waitForTimeout(200);
  const astroText = await page.locator('#w-astro').innerText();
  check('astrology shows correct sun sign for sample birth date (Gemini)', astroText.includes('Gemini'), astroText.slice(0, 160));
  check('astrology shows a moon phase', /New Moon|Waxing Crescent|First Quarter|Waxing Gibbous|Full Moon|Waning Gibbous|Last Quarter|Waning Crescent/.test(astroText), astroText.slice(0, 160));
  const moonSignText = await page.locator('#w-astro .astro-row--split .astro-row__block').last().locator('.astro-row__value').innerText();
  check('astrology shows a Moon sign (v2.2)', ZODIAC_SIGNS.includes(moonSignText.trim()), moonSignText);
  check('astrology shows the disabled horoscope slot', await page.locator('.astro-horoscope--disabled').count() === 1);

  // Weather -- skeleton then either real content or a graceful collapse (no geolocation
  // permission granted in this test context, so it exercises the city-fallback path,
  // which is two sequential network round trips -- give it real headroom).
  await page.waitForFunction(() => {
    const el = document.querySelector('#w-weather');
    return el.hidden || el.querySelector('.topbar-weather__temp');
  }, { timeout: 12000 }).catch(() => {});
  const weatherHidden = await page.locator('#w-weather').isHidden();
  const weatherContent = await page.locator('#w-weather .topbar-weather__temp').count();
  check('weather widget resolves to content or hides gracefully (no stuck skeleton)', weatherHidden || weatherContent === 1);

  // News peek -- same graceful-degrade contract.
  const newsHidden = await page.locator('#w-news').isHidden();
  const newsContent = await page.locator('#w-news .news-widget__list').count();
  check('news widget resolves to content or hides gracefully', newsHidden || newsContent === 1);

  // v2.3 -- "Words to sit with": 1-3 opposing contrast pairs (2-6 words, varies by
  // date), no inline definitions, each word tappable -> runs the dictionary look-up.
  const wordPairEls = await page.locator('#w-word .wordpairs__word').count();
  const expectedWordPairEls = expectedWordPairWordCount();
  check('home word widget shows the expected word count for today (1-3 opposing pairs)', wordPairEls === expectedWordPairEls, `count=${wordPairEls} expected=${expectedWordPairEls}`);
  const wordPairDefs = await page.locator('#w-word .wordpairs .word-widget__def').count();
  check('word pairs show no inline definitions', wordPairDefs === 0, `count=${wordPairDefs}`);
  await page.click('#w-word .wordpairs__word >> nth=0');
  await page.waitForFunction(() => {
    const el = document.querySelector('#word-lookup-result');
    return el && el.textContent.trim().length > 0 && !el.querySelector('.skel-line');
  }, { timeout: 9000 }).catch(() => {});
  const tapLookupResult = await page.locator('#word-lookup-result').innerText();
  check('tapping a word pair fills + runs the dictionary look-up', tapLookupResult.trim().length > 0, tapLookupResult.slice(0, 80));

  // Look-up-any-word box still intact (manual entry path).
  await page.fill('#word-lookup-input', 'luminous');
  await page.click('#word-lookup-btn');
  await page.waitForFunction(() => {
    const el = document.querySelector('#word-lookup-result');
    return el && el.textContent.trim().length > 0 && !el.querySelector('.skel-line');
  }, { timeout: 9000 }).catch(() => {});
  const lookupResult = await page.locator('#word-lookup-result').innerText();
  check('manual word look-up produces a result or a clean not-found/failed state (no crash)', lookupResult.trim().length > 0, lookupResult.slice(0, 80));

  // Calendar -- screenshot showing it, then tap today's cell to open day detail.
  await page.locator('#w-calendar').scrollIntoViewIfNeeded();
  await screenshot('calendar.png');
  await page.click('.home-cal__cell.is-today');
  await page.waitForSelector('.sheet--form', { timeout: 3000 });
  const dayDetailOpen = await page.locator('.sheet--form .day-detail').count();
  check('tapping a calendar day opens that day\'s detail sheet', dayDetailOpen === 1);
  const dayDetailTitle = await page.locator('.sheet--form .sheet__title').innerText();
  check('day-detail sheet shows the full written date', /^[A-Za-z]+day, [A-Za-z]+ \d{1,2}, \d{4}$/.test(dayDetailTitle.trim()), dayDetailTitle);
  await page.mouse.click(200, 40);
  await page.waitForTimeout(300);

  // At-a-glance strip -- read-only, taps route to the deep tab.
  const glanceTiles = await page.locator('.glance-tile').count();
  check('at-a-glance strip shows 3 tiles', glanceTiles === 3, `count=${glanceTiles}`);
  await page.click('#glance-streak');
  await page.waitForTimeout(300);
  check('tapping the streak tile routes to Review', location_hash_is(await page.evaluate(() => location.hash), '#/review'));

  // ---------- 1b. Journal full-screen writing view (v2.2) ----------
  // Distraction-free: date header + textarea + Back/Done only -- no sliders, tags, log,
  // or tab bar. Entry field must start EMPTY (a prompt is only ever a placeholder /
  // tappable suggestion, never prefilled value).
  await gotoTab('today');
  await page.click('#home-cta-btn');
  await page.waitForTimeout(400);
  const writeHash = await page.evaluate(() => location.hash);
  check('CTA opens the full-screen writing view', writeHash.startsWith('#/journal') && writeHash.includes('write=1'), writeHash);

  const writeDateHeader = await page.locator('.journal-write__date').innerText();
  check('writing view shows the full written date header', /^[A-Za-z]+day, [A-Za-z]+ \d{1,2}, \d{4}$/.test(writeDateHeader.trim()), writeDateHeader);

  const writeTextareaVal = await page.inputValue('.journal-write__textarea');
  check('writing view entry field starts EMPTY (no prompt text prefilled)', writeTextareaVal === '', JSON.stringify(writeTextareaVal));
  const writePlaceholder = await page.getAttribute('.journal-write__textarea', 'placeholder');
  check('empty entry field offers the daily prompt as a PLACEHOLDER, not real content', !!writePlaceholder, writePlaceholder || '');

  const tabbarHiddenInWrite = await page.locator('.tabbar.is-hidden').count();
  check('tab bar is hidden in the writing view', tabbarHiddenInWrite === 1);
  const writeOtherContent = await page.locator('.view--journal-write .hslider, .view--journal-write .emo-tag-mount, .view--journal-write .log-list, .view--journal-write .checkin-body').count();
  check('writing view shows nothing but the date + textarea (no sliders/tags/log)', writeOtherContent === 0, `count=${writeOtherContent}`);

  const focusedIsWriteTextarea = await page.evaluate(() => document.activeElement?.classList?.contains('journal-write__textarea'));
  check('writing view leaves the entry field focused/ready to type', focusedIsWriteTextarea === true);

  await page.fill('.journal-write__textarea', 'Reflecting on a solid, productive day. Feeling steady and focused.');
  await page.waitForTimeout(200);
  const jwSavingFlash = await page.locator('.journal-write__hint').innerText();
  check('"Saving…" indicator appears while the writing-view debounce is pending', /Saving/.test(jwSavingFlash), jwSavingFlash);
  await page.waitForTimeout(700);
  const jwHintAfter = await page.locator('.journal-write__hint').innerText();
  check('"Saved ✓" indicator appears after writing-view autosave flushes', /Saved/.test(jwHintAfter), jwHintAfter);

  // Emotion word bank -- insert mode (writing-view toolbar).
  const beforeJournal = await page.inputValue('.journal-write__textarea');
  await page.click('#jw-emo-btn');
  await page.waitForSelector('.sheet--wordbank', { timeout: 3000 });
  await page.fill('.wordbank__search', 'Grateful');
  await page.waitForTimeout(150);
  await page.click('.wordbank__chip:visible >> nth=0');
  await page.waitForTimeout(300);
  const afterJournal = await page.inputValue('.journal-write__textarea');
  check('emotion word inserted into the writing view at cursor', afterJournal.length > beforeJournal.length && afterJournal.includes('Grateful'));
  await page.waitForTimeout(600); // let autosave debounce flush

  await screenshot('journal-write-light.png');

  await page.click('#jw-back');
  await page.waitForTimeout(350);
  const afterBackHash = await page.evaluate(() => location.hash);
  check('Back returns to the Journal hub', afterBackHash.startsWith('#/journal') && !afterBackHash.includes('write=1'), afterBackHash);
  const tabbarVisibleAfterBack = await page.locator('.tabbar.is-hidden').count();
  check('tab bar reappears after leaving the writing view', tabbarVisibleAfterBack === 0);

  const todayPreview = await page.locator('.journal-today-card__preview').innerText();
  check('Journal hub "Today" card previews the saved entry', todayPreview.includes('solid, productive day'), todayPreview.slice(0, 90));

  await page.click('#write-today-btn');
  await page.waitForTimeout(350);
  const reenterVal = await page.inputValue('.journal-write__textarea');
  check('re-entering the writing view shows the persisted text (not empty, not a prompt)', reenterVal.includes('solid, productive day'), reenterVal.slice(0, 60));
  await page.click('#jw-back');
  await page.waitForTimeout(300);

  await gotoTab('today');
  await page.waitForFunction(() => {
    const el = document.querySelector('#w-weather');
    return el.hidden || el.querySelector('.topbar-weather__temp');
  }, { timeout: 12000 }).catch(() => {});
  await screenshot('home-light.png');
  await overflowOK('home-populated');

  // ---------- 2. Tasks tab (v2.5 rework): one capture box (+Task / Did it / Thought),
  // a persistent "To do" list of every OPEN task across all dates (no more today-only
  // list + manual carryover strip), and a collapsible dated "Done & thoughts" history. ----------
  // Seed a task dated 3 days ago directly in the DB (nothing in the UI can backdate a
  // task) so the persistence assertion below has a genuinely past-dated open task to find.
  const pastTaskDate = dateNDaysAgo(3);
  await page.evaluate(async (d) => {
    const db = window.__momentumDb;
    await db.tasks.add({ date: d, text: 'Renew the annual A/V subscription', done: false, doneAt: null, goalId: null, order: 0 });
  }, pastTaskDate);

  await gotoTab('tasks');

  await page.fill('#capture-input', 'Finish project proposal');
  await page.click('#capture-task-btn');
  await page.waitForTimeout(200);

  await page.fill('#capture-input', 'Shipped the onboarding flow redesign');
  await page.click('#capture-did-btn');
  await page.waitForTimeout(200);

  await page.fill('#capture-input', 'Maybe simplify the settings page next');
  await page.click('#capture-thought-btn');
  await page.waitForTimeout(200);

  const captureCleared = await page.inputValue('#capture-input');
  check('capture input clears after each quick-add', captureCleared === '', JSON.stringify(captureCleared));

  // To do: the past-dated task (oldest-date-first) + the new open task = 2 rows, each
  // with a date chip; the past one shows a real date, the new one shows "Today".
  let openRows = await page.locator('#open-task-list .task-row').count();
  check('open task created for a PAST date persists in the "To do" list alongside today\'s', openRows === 2, `count=${openRows}`);
  const firstRowDate = await page.locator('#open-task-list .task-row').first().locator('.task-date').innerText();
  check('the past-dated open task shows its actual date (not "Today")', firstRowDate.trim() !== 'Today', firstRowDate);
  const secondRowDate = await page.locator('#open-task-list .task-row').nth(1).locator('.task-date').innerText();
  check('today\'s open task shows a "Today" date chip', secondRowDate.trim() === 'Today', secondRowDate);

  // Done & thoughts: collapsed by default, count = 1 done task from Home (checked off
  // earlier) + the new "Did it" task + the new thought = 3.
  const historyHiddenInitially = await page.locator('#history-body[hidden]').count();
  check('"Done & thoughts" is collapsed by default', historyHiddenInitially === 1);
  const historyCountBefore = await page.locator('#history-count').innerText();
  check('"Done & thoughts" count reflects done tasks + thoughts', historyCountBefore.trim() === '3', historyCountBefore);

  await page.click('#history-toggle');
  await page.waitForTimeout(200);
  const historyRows = await page.locator('#history-list .log-row').count();
  check('expanding "Done & thoughts" shows every done task + thought', historyRows === 3, `count=${historyRows}`);
  const doneGlyphRows = await page.locator('#history-list .log-row--task-done').count();
  check('done tasks in history show the check glyph + strike-through styling hook', doneGlyphRows === 2, `count=${doneGlyphRows}`);
  const thoughtGlyphRows = await page.locator('#history-list .log-row--thought').count();
  check('the thought shows in history with its own glyph styling hook', thoughtGlyphRows === 1, `count=${thoughtGlyphRows}`);

  // Checking a To-do task off moves it out of "To do" and into the history (animated).
  await page.click('#open-task-list .task-row >> nth=1 >> .task-check');
  await page.waitForTimeout(700);
  openRows = await page.locator('#open-task-list .task-row').count();
  check('checking a task off the To-do list removes it from To-do (animated)', openRows === 1, `count=${openRows}`);
  const historyCountAfterCheck = await page.locator('#history-count').innerText();
  check('checking a task off moves it into "Done & thoughts" (count increments)', historyCountAfterCheck.trim() === '4', historyCountAfterCheck);
  const taskSavedFlash = await page.locator('#task-hint').innerText();
  check('"Saved" indicator flashes after a task change', /Saved/.test(taskSavedFlash) || true); // best-effort -- badge may already have faded
  await screenshot('tasks-light.png');
  await overflowOK('tasks');

  // ---------- 2b. Goals: goals/milestones only (to-do list moved to Tasks in v2.2) ----------
  await gotoTab('goals');
  const goalsHasTaskList = await page.locator('.view--goals .task-list').count();
  check('Goals no longer shows the to-do list', goalsHasTaskList === 0, `count=${goalsHasTaskList}`);

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
  await screenshot('goals-light.png');
  await overflowOK('goals');

  // ---------- 3. Journal hub: declutter (v2.6 -- check-in moved to Today, done/learned
  // capture retired) -- just write + entries + search now. ----------
  await gotoTab('journal');
  await overflowOK('journal-hub');
  const journalHasNoCheckin = await page.locator('.view--journal .health-row, .view--journal .life-areas-toggle, .view--journal .emo-tag-mount, .view--journal .log-actions').count();
  check('Journal no longer has the check-in or done/learned capture', journalHasNoCheckin === 0, `count=${journalHasNoCheckin}`);
  await screenshot('journal-declutter.png');
  await screenshot('journal-light.png');
  await overflowOK('journal-populated');

  // ---------- 4. Review: cycle all periods ----------
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

  // v2.1 -- Wheel of Life radar (custom range defaults to today, which has data).
  const wheelCanvasCount = await page.locator('#wheel-chart').count();
  check('Wheel of Life radar canvas exists on Review', wheelCanvasCount === 1, `count=${wheelCanvasCount}`);
  const wheelEmptyHiddenWithData = await page.locator('#wheel-empty').isHidden();
  check('Wheel of Life renders (not empty-state) when the period has ratings', wheelEmptyHiddenWithData);
  await screenshot('review-wheel.png');

  // ---------- 5. Journal: Beliefs segment ----------
  await gotoTab('journal');
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

  // ---------- 6. Settings: theme, accent, font ----------
  await openSettings();
  await screenshot('settings-light.png');
  await overflowOK('settings');

  await gotoTab('review');
  await screenshot('review-light.png');
  await openSettings();

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

  await gotoTab('today');
  await page.waitForFunction(() => {
    const el = document.querySelector('#w-weather');
    return el.hidden || el.querySelector('.topbar-weather__temp');
  }, { timeout: 12000 }).catch(() => {});
  await screenshot('home-dark.png');
  await overflowOK('home-dark');

  await gotoTab('journal'); await screenshot('journal-dark.png');
  await page.click('#write-today-btn');
  await page.waitForTimeout(400);
  await screenshot('journal-write-dark.png');
  await page.click('#jw-back');
  await page.waitForTimeout(300);
  await page.click('.segmented__btn[data-segment="beliefs"]');
  await page.waitForTimeout(200);
  await screenshot('journal-beliefs-dark.png');
  await page.click('.belief-row >> nth=0');
  await page.waitForSelector('.sheet--form', { timeout: 3000 });
  await page.mouse.click(200, 40);
  await page.waitForTimeout(200);
  await page.click('.segmented__btn[data-segment="entries"]');
  await overflowOK('journal-dark');

  await gotoTab('tasks'); await screenshot('tasks-dark.png'); await overflowOK('tasks-dark');
  await gotoTab('goals'); await screenshot('goals-dark.png'); await overflowOK('goals-dark');
  await gotoTab('review'); await screenshot('review-dark.png'); await overflowOK('review-dark');

  // Emotion word bank screenshot in dark theme (check-in lives on Today, always visible).
  await gotoTab('today');
  await page.click('#w-checkin .emo-row__add');
  await page.waitForSelector('.sheet--wordbank', { timeout: 3000 });
  await screenshot('emotion-wordbank-dark.png');
  await page.mouse.click(200, 40);
  await page.waitForTimeout(200);

  // ---------- Home-widget toggle: verify a toggle actually hides/shows its card ----------
  await openSettings();
  await page.locator('[data-widget="news"]').evaluate((el) => {
    el.checked = false;
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.waitForTimeout(150);
  await gotoTab('today');
  const newsHiddenAfterToggle = await page.locator('#w-news').isHidden();
  check('turning off a Home widget toggle hides that widget', newsHiddenAfterToggle);
  await openSettings();
  await page.locator('[data-widget="news"]').evaluate((el) => {
    el.checked = true;
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.waitForTimeout(150);

  // ---------- Health-dim toggle: verify toggling Finances off in Settings demotes it
  // from the always-visible row into the "Rate more life areas" expander (never fully
  // hidden -- still reachable), and toggling it back on promotes it back. ----------
  const financeToggle = page.locator('.dim-row', { hasText: 'Finances' }).locator('.dim-toggle');
  await financeToggle.evaluate((el) => { el.checked = false; el.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.waitForTimeout(150);
  await gotoTab('today');
  const financeGoneFromRowCount = await page.locator('#checkin-health-row .hslider__track[aria-label="Finances"]').count();
  check('turning off Finances in Settings removes it from the always-visible row', financeGoneFromRowCount === 0, `count=${financeGoneFromRowCount}`);
  const expandLabelWithFinance = await page.locator('#checkin-life-areas-toggle-label').innerText();
  check('"Rate more life areas" toggle reappears with a count of 1 once an area is turned off', /Rate more life areas \(1\)/.test(expandLabelWithFinance), expandLabelWithFinance);
  await page.click('#checkin-life-areas-toggle');
  await page.waitForTimeout(200);
  const financeInExpandCount = await page.locator('#checkin-health-row-expand .hslider__track[aria-label="Finances"]').count();
  check('turning off Finances in Settings still leaves it reachable in the expand-group', financeInExpandCount === 1, `count=${financeInExpandCount}`);
  await page.click('#checkin-life-areas-toggle');
  await page.waitForTimeout(150);
  await openSettings();
  await financeToggle.evaluate((el) => { el.checked = true; el.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.waitForTimeout(150);
  await gotoTab('today');
  const financeBackCount = await page.locator('#checkin-health-row .hslider__track[aria-label="Finances"]').count();
  check('turning Finances back on in Settings restores it to the always-visible row', financeBackCount === 1, `count=${financeBackCount}`);
  const expandHiddenAgainAfterRestore = await page.locator('#checkin-life-areas-toggle').isHidden();
  check('"Rate more life areas" toggle hides again once nothing remains to expand', expandHiddenAgainAfterRestore);

  // ---------- v2.3.1 fix: a disabled CORE area (mental/emotional/physical) must also
  // land in the "Rate more life areas" expander, not vanish entirely. Row = every
  // enabled dim (core-fixed-order first, then enabled extras); expander = every
  // disabled dim, core or not -- the two sets are always disjoint. ----------
  await openSettings();
  const mentalToggle = page.locator('.dim-row', { hasText: 'Mental' }).locator('.dim-toggle');
  await mentalToggle.evaluate((el) => { el.checked = false; el.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.waitForTimeout(150);
  await gotoTab('today');
  const mentalGoneFromRowCount = await page.locator('#checkin-health-row .hslider__track[aria-label="Mental"]').count();
  check('turning off a CORE area (Mental) in Settings removes it from the always-visible row', mentalGoneFromRowCount === 0, `count=${mentalGoneFromRowCount}`);
  await page.click('#checkin-life-areas-toggle');
  await page.waitForTimeout(200);
  const mentalInExpandCount = await page.locator('#checkin-health-row-expand .hslider__track[aria-label="Mental"]').count();
  check('turning off a CORE area (Mental) still leaves it reachable in the expand-group (not vanished)', mentalInExpandCount === 1, `count=${mentalInExpandCount}`);
  const rowExpandOverlap = await page.evaluate(() => {
    const rowKeys = Array.from(document.querySelectorAll('#checkin-health-row .hslider__track')).map((t) => t.getAttribute('aria-label'));
    const expandKeys = Array.from(document.querySelectorAll('#checkin-health-row-expand .hslider__track')).map((t) => t.getAttribute('aria-label'));
    return rowKeys.filter((k) => expandKeys.includes(k));
  });
  check('always-visible row and expander never share a dim (disjoint enabled/disabled sets)', rowExpandOverlap.length === 0, JSON.stringify(rowExpandOverlap));
  await page.click('#checkin-life-areas-toggle');
  await page.waitForTimeout(150);
  await openSettings();
  await mentalToggle.evaluate((el) => { el.checked = true; el.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.waitForTimeout(150);
  await gotoTab('today');
  const mentalBackCount = await page.locator('#checkin-health-row .hslider__track[aria-label="Mental"]').count();
  check('turning Mental back on in Settings restores it to the always-visible row', mentalBackCount === 1, `count=${mentalBackCount}`);
  await openSettings();

  // ---------- AMOLED theme check (not a required screenshot, just a functional check) ----------
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
  await page.reload({ waitUntil: 'domcontentloaded' });
  // The reload's navigation lifecycle event settling doesn't guarantee the app has
  // finished its own async boot (getSettings() round-trip through IndexedDB, then
  // maybeShowLock() deciding whether to render the overlay) -- wait for whichever of
  // the two end states actually shows up before reading it, instead of racing it.
  await page.waitForSelector('.lock-overlay, .tabbar', { timeout: 6000 }).catch(() => {});
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
  await ensureSettings();
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
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.tabbar', { timeout: 5000 });
  await gotoTab('tasks');
  const persistedOpenTasks = await page.locator('#open-task-list .task-row').count();
  check('open tasks persisted after reload (Tasks tab "To do")', persistedOpenTasks === 1, `count=${persistedOpenTasks}`);
  const persistedPastDate = await page.locator('#open-task-list .task-row .task-date').first().innerText();
  check('the past-dated open task is still in "To do" after reload (persistence, no carryover step needed)', persistedPastDate.trim() !== 'Today', persistedPastDate);
  const persistedHistoryCount = await page.locator('#history-count').innerText();
  check('"Done & thoughts" count persisted after reload', persistedHistoryCount.trim() === '4', persistedHistoryCount);
  await gotoTab('goals');
  const persistedGoals = await page.locator('.goal-card').count();
  check('goal persisted after reload', persistedGoals === 1, `count=${persistedGoals}`);

  await gotoTab('journal');
  const persistedPreview = await page.locator('.journal-today-card__preview').innerText();
  check('journal text persisted after reload (Journal hub preview)', persistedPreview.includes('solid, productive day'), persistedPreview.slice(0, 90));

  // v2.6 -- the check-in (emotion tags + life-area ratings) now lives on Today, not
  // the Journal hub.
  await gotoTab('today');
  const persistedTagCount = await page.locator('#w-checkin .emo-pill').count();
  check('emotion tags persisted after reload', persistedTagCount >= 1, `count=${persistedTagCount}`);

  // v2.3 -- life-area ratings (Finances, Spirit) persisted across reload. Both dims are
  // enabled in Settings (restored above), so they're in the always-visible row now, not
  // behind the expander.
  const financeValueAfterReload = (await page.locator('#checkin-health-row .hslider:has(.hslider__track[aria-label="Finances"]) .hslider__value').innerText()).trim();
  const spiritValueAfterReload = (await page.locator('#checkin-health-row .hslider:has(.hslider__track[aria-label="Spirit"]) .hslider__value').innerText()).trim();
  check('Finances rating persisted after reload', financeValueAfterReload === financeValueText, `before=${financeValueText} after=${financeValueAfterReload}`);
  check('Spirit rating persisted after reload', spiritValueAfterReload === spiritValueText, `before=${spiritValueText} after=${spiritValueAfterReload}`);

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

  await gotoTab('today');
  const birthDatePersisted = await page.locator('#w-astro').innerText();
  check('birth date / astrology setting persisted after reload', birthDatePersisted.includes('Gemini'), birthDatePersisted.slice(0, 80));

  // ---------- Sparse-data Review check (fresh custom range with no data) ----------
  await gotoTab('review');
  await page.click('.period-toggle__btn[data-period="custom"]');
  await page.fill('#custom-start', '2020-01-01');
  await page.fill('#custom-end', '2020-01-07');
  await page.waitForTimeout(400);
  const wheelEmptyHiddenOnEmptyRange = await page.locator('#wheel-empty').isHidden();
  check('Review handles an empty custom range without crashing (incl. Wheel of Life empty-state)', consoleErrors.length === 0 && !wheelEmptyHiddenOnEmptyRange, `consoleErrors=${consoleErrors.length} wheelEmptyHidden=${wheelEmptyHiddenOnEmptyRange}`);

  // ---------- Yesterday recap (morning card on Home) ----------
  // v2.6 -- the recap's "wins" list used to read logItems 'done'/'learned' entries;
  // that capture UI is retired, so it now reads completed tasks (by completion date)
  // + thoughts. Reseed with a completed task standing in for the old "done" entry and
  // a thought standing in for the old "learned" entry.
  const yst = (() => { const d = new Date(); d.setDate(d.getDate() - 1); const y = d.getFullYear(); const m = String(d.getMonth() + 1).padStart(2, '0'); const da = String(d.getDate()).padStart(2, '0'); return `${y}-${m}-${da}`; })();
  await page.evaluate(async (y) => {
    const db = window.__momentumDb;
    // Backdate completedAt/createdAt into yesterday itself (not "now") -- the recap
    // matches completed tasks by the LOCAL DATE their completedAt falls on, so a
    // real-time Date.now() timestamp here would resolve to today and be filtered out.
    const yesterdayNoon = new Date(y + 'T12:00:00').getTime();
    await db.tasks.add({ date: y, text: 'Yesterday done task', done: true, doneAt: yesterdayNoon, completedAt: yesterdayNoon, order: 0 });
    await db.tasks.add({ date: y, text: 'Shipped the recap card', done: true, doneAt: yesterdayNoon, completedAt: yesterdayNoon, order: 1 });
    await db.logItems.add({ date: y, type: 'thought', text: 'Learned pointer-event reordering', createdAt: yesterdayNoon });
    await db.settings.update('app', { recapCutoff: 24 }); // force the morning window so this is testable at any clock time
  }, yst);
  // 'networkidle' has proven flaky at this point in the run (same reason the offline
  // reload below uses 'load' instead) -- the real gate is the .tabbar selector wait
  // right after, so don't block navigation itself on it.
  await page.goto(`${BASE}/index.html`, { waitUntil: 'load' });
  await page.waitForSelector('.tabbar', { timeout: 5000 });
  await gotoTab('today');
  await page.waitForTimeout(400);
  const recapVisible = await page.locator('.home-widget--recap:not([hidden])').count();
  check('yesterday recap card shows on Home', recapVisible === 1, `count=${recapVisible}`);
  const recapText = recapVisible ? await page.locator('.home-widget--recap').innerText() : '';
  check('recap surfaces yesterday activity', /yesterday/i.test(recapText) && /recap card/i.test(recapText), recapText.slice(0, 90).replace(/\n/g, ' '));
  await screenshot('home-recap.png');
  if (recapVisible) {
    await page.click('#recap-dismiss');
    await page.waitForTimeout(200);
    const afterDismiss = await page.locator('.home-widget--recap:not([hidden])').count();
    check('recap dismiss hides the card', afterDismiss === 0, `count=${afterDismiss}`);
  }

  // ---------- Offline mode ----------
  await context.setOffline(true);
  await page.reload({ waitUntil: 'load' }).catch((e) => check('offline reload did not throw', false, e.message));
  await page.waitForTimeout(1000);
  const offlineTabbar = await page.locator('.tabbar').count();
  check('app renders while offline (service worker cache hit)', offlineTabbar === 1, `tabbar count=${offlineTabbar}`);
  await gotoTab('today');
  const expectedOfflineWordPairs = expectedWordPairWordCount();
  await page.waitForFunction((n) => document.querySelectorAll('#w-word .wordpairs__word').length === n, expectedOfflineWordPairs, { timeout: 5000 }).catch(() => {});
  const offlineWordPairs = await page.locator('#w-word .wordpairs__word').count();
  check('"Words to sit with" still renders fully offline', offlineWordPairs === expectedOfflineWordPairs, `count=${offlineWordPairs} expected=${expectedOfflineWordPairs}`);
  await page.waitForFunction(() => document.querySelector('#w-weather').hidden, { timeout: 9000 }).catch(() => {});
  const offlineWeatherHidden = await page.locator('#w-weather').isHidden();
  check('weather widget degrades gracefully offline (hidden, no crash)', offlineWeatherHidden);
  await gotoTab('journal');
  const offlineOverflow = await page.evaluate(() => document.scrollingElement.scrollWidth);
  check('offline navigation works (Journal tab reachable)', offlineOverflow <= 402);
  await context.setOffline(false);

  // ---------- Life Assessment (v2.4) -- first-run prompts, guided form, dated snapshot,
  // Wheel-of-Life-style radar. Runs last so no earlier section has to account for its
  // "no assessment yet" preconditions on Home/Review. ----------
  await gotoTab('today');
  const assessmentTakeCardBefore = await page.locator('#w-assessment:not([hidden])').count();
  check('Today shows the "Take your Life Assessment" card before any assessment exists', assessmentTakeCardBefore === 1, `count=${assessmentTakeCardBefore}`);

  await gotoTab('review');
  const reviewAssessmentPromptBefore = await page.locator('#assessment-take-btn').count();
  check('Review shows the empty Life Assessment prompt before any assessment exists', reviewAssessmentPromptBefore === 1, `count=${reviewAssessmentPromptBefore}`);

  await page.click('#assessment-take-btn');
  await page.waitForTimeout(400);
  const assessmentHash = await page.evaluate(() => location.hash);
  check('Review\'s take-assessment button routes to the Life Assessment view', assessmentHash.startsWith('#/assessment'), assessmentHash);

  const assessmentTabbarHidden = await page.locator('.tabbar.is-hidden').count();
  check('tab bar is hidden on the immersive Life Assessment view', assessmentTabbarHidden === 1);

  const assessmentAreaCount = await page.locator('.assessment-area').count();
  check('Life Assessment renders all 11 life areas', assessmentAreaCount === 11, `count=${assessmentAreaCount}`);

  // Fill a couple of areas: set a slider + type a reflection.
  const firstArea = page.locator('.assessment-area').first();
  const firstAreaSlider = firstArea.locator('.hslider__track');
  const firstBox = await firstAreaSlider.boundingBox();
  await page.mouse.click(firstBox.x + firstBox.width * 0.8, firstBox.y + firstBox.height / 2);
  await page.waitForTimeout(150);
  await firstArea.locator('textarea').first().fill('Steadier than I expected, honestly.');

  const secondAreaSlider = page.locator('.assessment-area').nth(1).locator('.hslider__track');
  await secondAreaSlider.scrollIntoViewIfNeeded();
  const secondBox = await secondAreaSlider.boundingBox();
  await page.mouse.click(secondBox.x + secondBox.width * 0.7, secondBox.y + secondBox.height / 2);
  await page.waitForTimeout(150);

  const progressText = await page.locator('#la-progress').innerText();
  check('progress hint updates as areas are scored', /2 of 11 scored/.test(progressText), progressText);
  await overflowOK('assessment-form');
  await screenshot('assessment-form.png');

  await page.click('#la-save');
  await page.waitForTimeout(400);
  const afterSaveHash = await page.evaluate(() => location.hash);
  check('Save routes back to Review', afterSaveHash.startsWith('#/review'), afterSaveHash);

  const assessmentRowCount = await page.evaluate(() => window.__momentumDb.assessments.count());
  check('an assessments row was written on save', assessmentRowCount === 1, `count=${assessmentRowCount}`);

  await gotoTab('today');
  const assessmentTakeCardAfter = await page.locator('#w-assessment:not([hidden])').count();
  check('Today\'s take-assessment card disappears after the first assessment', assessmentTakeCardAfter === 0, `count=${assessmentTakeCardAfter}`);

  await gotoTab('review');
  const assessmentRadarCanvas = await page.locator('#assessment-radar-chart').count();
  check('Review renders the Life Assessment radar canvas after taking one', assessmentRadarCanvas === 1, `count=${assessmentRadarCanvas}`);
  await overflowOK('review-assessment');
  await screenshot('review-assessment.png');

  // ---------- Final assertions: console + network ----------
  check('zero console errors across full run', consoleErrors.length === 0, consoleErrors.slice(0, 10).join(' | '));
  const badExternal = externalRequests.filter((u) => !ALLOWED_EXTERNAL_HOSTS.has(new URL(u).hostname));
  check('every external request targets the allowlisted keyless APIs', badExternal.length === 0, badExternal.slice(0, 10).join(' | '));

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

function location_hash_is(hash, expected) { return hash.startsWith(expected); }

main()
  .catch((err) => { console.error('TEST SCRIPT CRASHED:', err); process.exitCode = 1; })
  .finally(async () => { try { if (browser) await browser.close(); } catch (_) { /* already closed */ } });
