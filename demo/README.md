# Demo site

**Try it live: [binarybananallc.github.io/ArghBox](https://binarybananallc.github.io/ArghBox/).** Admin password: `demo`.

This folder is "Contoso Tasks", a made-up to-do app website with ArghBox installed. It has the real widget, the real admin page and, in the "on your phone" section, the real mobile app page in a phone, next to the messages a native app receives from it.

Try it in three steps:

1. Open **Feedback** (the tab on the right edge). Vote, or add an idea.
2. Open the **admin page** with the password `demo` and publish what you added.
3. Come back: it is on the board, on the page and in the phone.

## Two ways to run it

| | Backend | Admin sign-in |
|---|---|---|
| **GitHub Pages** (`npm run demo` on your machine, at http://127.0.0.1:8790/ArghBox/) | `backend.js` answers `api.php` in the browser and keeps the box in `localStorage`. Nothing leaves the browser; "Reset the demo" starts over. No PHP needed. | Password `demo` |
| **Dev server** (`npm run dev`, at http://localhost:8787/) | The real PHP and SQLite box, seeded with sample entries, with a fake Turnstile | The owner token printed in the terminal |

`npm run demo` runs `tools/build-pages.mjs`, which copies this folder and the browser files of `arghbox/` into `dist/pages/` and adds `backend.js` (plus `admin-note.js` on the admin page and `phone-bridge.js` on the app page). The **Demo** workflow (`.github/workflows/demo.yml`) publishes that folder to GitHub Pages after each release. None of these demo files are part of ArghBox itself: a real install never loads them.

Both need Node.js 22+; the dev server also needs PHP 8.1+ with SQLite.

## Try the triage

With the dev server running, the terminal prints a `Triage:` command. Run the [triage skill](../docs/triage.md) against the local box the same way you would against a real site.
