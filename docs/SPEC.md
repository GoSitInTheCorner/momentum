# Momentum — Personal Growth Journal (v1 Spec)

A mobile-first, offline-first PWA personal journal + growth tracker. Local-only data. No backend.

## Target & Feel
- **Device:** iPhone 16 Pro. Design to logical viewport **402 x 874 CSS px**, DPR 3. Respect safe-area insets (`env(safe-area-inset-*)`).
- **UX model:** One full screen at a time, everything one tap away (like the Claude mobile app). Bottom tab bar + a floating **+** FAB (like Apple Notes). Smooth, calm, delightful. Satisfying check-off animation. No horizontal page scroll ever.
- **Highly customizable** — settings are a first-class feature (see Settings).

## Navigation
Bottom tab bar, 5 tabs: **Today · Journal · Review · Goals · Settings**. Floating **+** FAB on Today/Journal for quick capture (task / log item / journal note via a small action sheet). Single-page app, hash-based routing, one view visible at a time with a quick fade/slide transition.

## Screens

### 1. Today (landing)
- **Morning "Yesterday" recap card shown FIRST** (before today's content) when current time is before a configurable cutoff (default 12:00), or always if toggled. Recap shows: yesterday's completed tasks, done/learned items, and the 3 health ratings. Dismissable.
- Today's **journal** entry (tap to edit, autosaves).
- **To-dos** for today: add, check off (animated), reorder, optional link to a goal.
- **Done / Learned** log: two quick-add streams ("I did…", "I learned…").
- **Health sliders:** mental, emotional, physical (Brendon Burchard's three elements of health). Rating scale configurable (default 1–10). Optional custom dimensions.
- FAB **+** for instant capture.

### 2. Journal
- All daily entries, newest first. Search. Tap a day to open its full day view (journal + that day's tasks/log/ratings).

### 3. Review (the analytics/time-machine)
- Period toggle: **Daily / Weekly / Monthly / Yearly / Custom range**.
- Rollups for the selected period + charts (Chart.js):
  - Health-rating **trend lines** (mental/emotional/physical) over the period.
  - **Tasks completed** per day + current/longest **streak**.
  - **Learning volume** (# learned items) and **done volume**.
- **"Where to focus" panel:** flags the lowest-trending health dimension and goals with no recent linked activity; 1–2 plain-language suggestions.

### 4. Goals
- Create/edit goals: title, category, target date, milestones, notes.
- Progress bar (from milestones checked and/or linked completed tasks).
- Daily tasks can link to a goal → progress builds automatically.

### 5. Settings (make this rich — "more customization the better")
- **Appearance:** theme (Light / Dark / System / AMOLED-black), accent color picker, font family (System / Serif / Rounded / Mono / Dyslexia-friendly), font size scale (S–XL), line spacing, UI density (Comfortable/Compact), corner radius.
- **Behavior:** default landing tab, "Yesterday recap" toggle + cutoff time, week starts on (Sun/Mon), date format, 12/24h time.
- **Health tracking:** toggle each dimension, add custom dimensions, rating scale (1–5 / 1–10 / emoji).
- **Journal:** default journal font/size, daily prompt toggle, markdown rendering toggle.
- **Privacy / Lock:** passcode lock toggle (OFF by default), set/change passcode, auto-lock timeout.
- **Data:** Export backup (JSON download), Import backup (JSON), storage usage readout, Clear all data (double-confirm).
- All settings persist and apply live.

## Added features (v1.1)

### Beliefs & Views section (political views + other ideologies)
- A reflective section for tracking political views and other ideologies/beliefs over time. Placed as a **segmented toggle inside the Journal tab** ([ Entries | Beliefs ]) to keep the 5-tab bar clean.
- User defines **topics** (e.g. a policy area, an ideology, a philosophical question). Each topic has a **current stance** and a **dated history** of prior stances + notes, so you can see how a view evolved and *why* it changed.
- Non-judgmental, private (local-only). Review can surface "views that changed recently."

### Emotion Word Bank (popup)
- A reusable **bottom-sheet popup** with a categorized **feelings-wheel taxonomy** (core emotions -> nuanced words), searchable.
- Triggered from: the **journal editor** toolbar (inserts selected word(s) at the cursor) and **next to the Emotional-health slider** (tags the day's emotions).
- Selected emotions are stored as tags on the day and can appear in Review (most-frequent emotions over a period).

### Design principle: smart prefill (Apple Timer style)
Prefill/suggest as much as possible, but every value stays user-changeable. Apply everywhere:
- **Defaults:** new items default date/time = now; health sliders start at yesterday's values (midpoint if none); new goal category = most-used; belief category = 'political' or last-used.
- **Tappable recents/presets:** show rows of recently/frequently used values to reuse in one tap — recent to-dos, most-used emotion words pinned atop the word bank, recent belief topics, goal-category chips, journal-prompt suggestions.
- **Carry-overs:** yesterday's unfinished to-dos are suggested for today (prefilled, dismissable).
- **Never trap the user:** any prefilled/suggested value can be edited or cleared. Prefill is a starting point, never a lock.

## Data (IndexedDB via Dexie)
- `days`: `date` (YYYY-MM-DD, PK), `journal` (text), `ratings` ({mental,emotional,physical,...custom}), `updatedAt`.
- `tasks`: `id` (PK, auto), `date`, `text`, `done` (bool), `doneAt`, `goalId?`, `order`.
- `logItems`: `id`, `date`, `type` ('done'|'learned'), `text`, `createdAt`.
- `goals`: `id`, `title`, `category`, `targetDate?`, `milestones` (array of {text,done}), `notes`, `createdAt`, `archived`.
- `days`: also add `emotions` (array of tag strings from the Emotion Word Bank).
- `beliefs`: `id` (PK), `topic`, `category` ('political'|'ideology'|'other'|custom), `currentStance` (text), `history` (array of {date, stance, note}), `createdAt`, `updatedAt`.
- `settings`: single record `id:'app'` holding all preferences.
- Weekly/monthly/yearly views computed on the fly from `days`/`tasks`/`logItems`.

## Tech
- **Vanilla JS ES modules, NO build step.** Plain `<script type="module">`.
- **Dexie.js** (IndexedDB wrapper) and **Chart.js** — **vendored locally** in `/vendor/` (NOT CDN) so the app is fully offline.
- **PWA:** `manifest.webmanifest` + `sw.js` service worker that precaches the app shell + vendor libs for offline; installable "Add to Home Screen". App icons (maskable) in `/assets/`.
- No external network calls at runtime.

## File structure
```
momentum/
  index.html
  manifest.webmanifest
  sw.js
  css/styles.css
  js/app.js  js/db.js  js/store.js  js/theme.js  js/analytics.js
  js/views/{today,journal,review,goals,settings}.js
  js/components/{tabbar,fab,slider,chart,sheet}.js
  vendor/{dexie.min.js,chart.umd.min.js}
  assets/{icon-192.png,icon-512.png,icon-maskable.png,favicon}
  docs/SPEC.md
```

## v2 — Home as an inviting launchpad (2026-08-27)

Rationale: v1 Home was a form to fill out (uninviting) and the FAB overlapped on-screen controls (confusing). Fix: **Home = arrive & glance (no inline editing); deep tabs = focus & manage.** One clear rule kills the "+ vs on-screen" confusion.

### Home ("Today") becomes a read-mostly launchpad, top -> bottom:
1. **Greeting + full date** ("Thursday, August 27, 2026 - Good morning").
2. **Weather** widget - [Open-Meteo](https://open-meteo.com/) (free, no key, CORS-ok). Uses geolocation (one-time permission) with a **city fallback set in Settings**; C/F toggle. Online-only; hides gracefully offline.
3. **News peek** - [Noozra](https://noozra.com/api) (free JSON headlines, no key, open CORS). 2-3 headlines, tap to open. Online-only; hides offline. Topic configurable in Settings.
4. **Word of the day** - a **curated, bundled JSON** of uncommon/beautiful words (word + part of speech + definition + example), picked by date (offline). PLUS a **look-up any word** search box via `https://api.dictionaryapi.dev/api/v2/entries/en/<word>` (free, no key; online-only).
5. **Astrology** - **sun sign + moon sign computed locally** from the user's birth date (set in Settings; no API, offline). A daily-horoscope slot is present but disabled until a keyless source is configured (NO secret keys in this public app).
6. **Reflection prompt + big "Write today's entry ->" CTA** - the single inviting action; opens the Journal deep entry.
7. **Calendar** - month view; days with journal/activity get a dot/glow; tap a day -> opens that day's detail. Streak/ritual pull.
8. **At-a-glance strip** (mood, top task, streak) - read-only; tapping routes to the deep tab.
- Home has **no inline editing**. The **FAB = quick capture** from anywhere; deep tabs own the inline "+ Add" controls.

### Move daily doing/logging OFF Home INTO deep tabs
- **Journal tab** = deep daily reflection: write entry + 3 health sliders (mental/emotional/physical) + emotions + done/learned + past entries + Beliefs (existing segment).
- **Goals tab** = "do": today's **to-dos** + goals/milestones.
- **Review** unchanged (analytics). **Settings** gains: birth date, weather city + units, per-widget on/off toggles, news topic.

### Save feedback (fixes "couldn't tell if it saved")
Add a subtle **autosave status indicator** ("Saving..." -> "Saved ✓") visible wherever data changes (sliders, journal, todos, etc.). Autosave stays silent-fast but now confirms.

### Constraints preserved
402px mobile, PWA/offline for all CORE data. Weather/news/dictionary are additive ONLINE-only widgets (keyless; no secrets). App must fully function offline without them.

## Quality bar
- Mobile-first, 402px, no horizontal scroll, safe-area aware, thumb-reachable.
- Fast, no jank; autosave everywhere (no explicit save buttons).
- Accessible: labels, sufficient contrast in both themes, tap targets >= 44px.
- Clean modular code; each view/component isolated with a clear interface.
