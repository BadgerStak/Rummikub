# Rummikub Score Tracker

A tiny, installable web app for tracking Rummikub scores during a game with friends. No build step, no user accounts. Works fully offline on one phone, and optionally supports shared, live-syncing games at a unique URL if you connect a free Firebase project (a few minutes of setup, see below).

## Features

- Add 2+ players before starting
- Each round: mark who went out, enter the tiles left in everyone else's rack — the app computes the winner's points and everyone else's negative score automatically
- Running totals and a leaderboard, updated live
- Full round history, editable or deletable at any time (totals recalculate)
- Add a player mid-game or rename players
- "No one went out" for blocked rounds
- End-game summary with final standings
- Installable as a home-screen app (PWA) and works fully offline once loaded once
- **Shared games**: once Firebase is connected, starting a game gives it a unique URL (`?g=<id>`) that anyone can open to see live score updates and enter rounds themselves — no login required. Share it from the in-game menu (🔗 Share Game Link). Without Firebase connected, the app still works great as a single-device, local-only tracker (saved to that browser's local storage).

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

## Enabling shared games (Firebase setup)

By default `firebase-config.js` has placeholder values, which keeps the app in local-only mode. To turn on shared, unique-URL games:

1. Go to the [Firebase console](https://console.firebase.google.com/), click **Add project**, give it any name (e.g. "rummikub-tracker"), and skip Google Analytics (not needed). Free tier ("Spark plan") is more than enough.
2. In the new project, go to **Build → Firestore Database → Create database**. Choose **Start in production mode** and pick any region. Click Enable.
3. Go to the **Rules** tab of Firestore and replace the contents with:
   ```
   rules_version = '2';
   service cloud.firestore {
     match /databases/{database}/documents {
       match /games/{gameId} {
         allow read, write: if true;
       }
     }
   }
   ```
   Click **Publish**. This makes any game doc readable/writable by anyone who has (or guesses) its ID — fine for casual score-keeping among friends, since IDs are long random strings, but worth knowing: there's no login, so don't put anything sensitive in a game.
4. Go to **Project settings** (gear icon, top left) → **General** tab → scroll to "Your apps" → click the web icon (`</>`) → register an app (any nickname, skip Firebase Hosting). Firebase will show you a `firebaseConfig` object.
5. Open `firebase-config.js` in this repo and paste those exact values in, replacing the placeholders:
   ```js
   window.FIREBASE_CONFIG = {
     apiKey: 'AIza...',
     authDomain: 'your-project.firebaseapp.com',
     projectId: 'your-project',
     storageBucket: 'your-project.appspot.com',
     messagingSenderId: '...',
     appId: '...'
   };
   ```
6. Commit and push (or edit the file directly on GitHub). Once deployed, starting a new game will automatically get a shareable link, and the in-game menu will show "🔗 Share Game Link".

These config values are not secret — they identify your project, not a credential — so it's fine to commit them; access control is handled entirely by the Firestore rules above.
