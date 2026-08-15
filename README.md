# Rummikub Score Tracker

A tiny, installable web app for tracking Rummikub scores during an offline game with friends. No backend, no build step, no account — everything is stored locally on the phone that opens it.

## Features

- Add 2+ players before starting
- Each round: mark who went out, enter the tiles left in everyone else's rack — the app computes the winner's points and everyone else's negative score automatically
- Running totals and a leaderboard, updated live
- Full round history, editable or deletable at any time (totals recalculate)
- Add a player mid-game or rename players
- "No one went out" for blocked rounds
- End-game summary with final standings
- Progress is saved to the browser's local storage, so closing the tab/app or losing signal doesn't lose the game
- Installable as a home-screen app (PWA) and works fully offline once loaded once

## Running it

This is a static site — three files (`index.html`, `styles.css`, `app.js`) plus a manifest/service worker for installability. No npm install, no server required for local use.

### Open it directly on your phone

The simplest path is to host it somewhere reachable from your phone's browser, then use "Add to Home Screen":

- **GitHub Pages** (recommended): in this repo's Settings → Pages, set the source to the branch/folder containing these files. GitHub gives you a URL like `https://<user>.github.io/Rummikub/`. Open that on your phone, then use your browser's "Add to Home Screen" (Safari: Share → Add to Home Screen; Chrome: ⋮ menu → Add to Home Screen). It'll launch full-screen like a native app.
- **Any static host** (Netlify, Vercel, S3, etc.) works the same way — just point it at this folder.

### Run it locally on your computer, use it from your phone

If your phone and computer are on the same Wi-Fi:

```bash
cd Rummikub
python3 -m http.server 8000
```

Then find your computer's local IP (e.g. `192.168.1.23`) and open `http://192.168.1.23:8000` on your phone.

### Just open the file

You can also double-click `index.html` to open it in any browser — it works with no server at all. (Some browsers restrict service workers on `file://`, so offline caching won't kick in, but the app itself works fine.)

## Scoring model

Standard Rummikub rules: whoever plays their last tile ("goes out") scores the sum of the tile values remaining in everyone else's rack; everyone else scores the negative of their own remaining tiles. If the pool runs out and no one can play (a blocked round), everyone just scores negative their own tiles with no bonus for anyone — use the "No one went out" checkbox for that case.
