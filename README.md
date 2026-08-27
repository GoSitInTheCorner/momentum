# Momentum

A mobile-first, offline-first personal growth journal (PWA). Local-only data — nothing leaves your device.

Daily journal, to-dos, done/learned logs, Burchard's three health ratings (mental / emotional / physical), an emotion word bank, goals with milestones, a Beliefs & Views section that tracks how your positions evolve, and Daily/Weekly/Monthly/Yearly review with trends and a "where to focus" panel. Smart-prefill everywhere, everything customizable.

## Run locally
Serve over http (service workers + ES modules need a server, not `file://`):

```
npx http-server . -p 8080 -c-1
```

Then open http://localhost:8080 . On iPhone, open the deployed URL in Safari and **Add to Home Screen** to install it.

## Tech
Vanilla JS ES modules, no build step. IndexedDB via Dexie, charts via Chart.js — both vendored locally in `/vendor/` for full offline use. PWA manifest + service worker precache the shell.

See `docs/SPEC.md` for the full spec.
