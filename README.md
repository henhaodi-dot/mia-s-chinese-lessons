# 汉字花园 (Hanzi Garden)

A daily-vocabulary Progressive Web App for a young Mandarin-speaking child who
can't read yet. One new character a day, spaced-repetition review, a garden
that grows as she learns. Vanilla HTML/CSS/JS, no build step, no backend —
everything runs from static files.

## Running locally

Any static file server works. Two options:

```
npx serve .
```

or

```
python -m http.server 8000
```

Then open `http://localhost:8000/index.html` (or whatever port/URL your
server prints). Opening `index.html` directly via a `file://` URL will
**not** work — ES modules and `fetch()` both require an actual HTTP origin.

## First-time setup

Two data-generation scripts need to run once (and again any time you add
characters to `data/characters.json`):

```
node scripts/fetch_strokes.mjs
```

Downloads stroke-order data for every character into `assets/strokes/`.
Requires Node.js (no npm packages needed — it only uses the built-in
`fetch`). Safe to re-run; it skips characters that already have a file.

```
pip install edge-tts
python scripts/generate_audio.py
```

Generates every spoken line (characters, words, sentences, and UI lines)
into `assets/audio/`. Safe to re-run; it skips files that already exist.

Both scripts read from `data/characters.json` and `data/ui_lines.json`, so
adding new characters later is just: edit the JSON, run both scripts again,
bump the service worker cache version (below), and redeploy.

## Deploying to GitHub Pages

1. Push this repo to GitHub.
2. In the repo's Settings → Pages, set the source to the `main` branch,
   root folder.
3. GitHub Pages will serve `index.html` at the repo's Pages URL. No build
   step is needed — it's already a static site.

## Adding to the Fire tablet home screen

1. Open the site's URL in Silk (Fire tablet's browser).
2. Tap the menu (☰) → **Add to Home Screen**.
3. Confirm the name (汉字花园) and add it. It now opens full-screen, like a
   native app, and works offline after the first load.

## Every deploy needs a cache-version bump

`sw.js` caches the app shell, data, stroke files, audio, and images so the
app works fully offline. The cache name is derived from `CACHE_VERSION` at
the top of `sw.js`:

```js
const CACHE_VERSION = "v1";
```

**Bump this string on every deploy that changes any cached file** (any
HTML/CSS/JS edit, new characters, new audio, new images). Without a bump,
a tablet that already installed the app will keep serving the old cached
files indefinitely — the service worker only checks for updates by
comparing its own script byte-for-byte, and won't know the *data* changed.
Bumping `CACHE_VERSION` makes `install()` build a fresh cache under a new
name and `activate()` delete the old one.

## Replacing an audio clip with your own recording

Every spoken line has a stable key (see the generated filenames in
`assets/audio/`, e.g. `char_我.mp3`, `word_我.mp3`, `sentence_我.mp3`, or a UI
line key like `hello_1.mp3`). To override any single line with your own
voice recording:

1. Record an MP3 with the **exact same filename**.
2. Drop it into `assets/audio/custom/` (create the folder if it doesn't
   exist).
3. The app checks `assets/audio/custom/` first for every line and falls
   back to the generated file automatically — no code changes needed.

## Adding character illustrations

The app ships with emoji as a placeholder picture for every character.
To add a real illustration for a character, drop a PNG at:

```
assets/img/{character}.png
```

e.g. `assets/img/我.png`. The app prefers this image over the emoji
whenever it's present. Parent Corner's "缺少插图的字" (missing illustrations)
section lists every character currently in play that still needs one —
open it, copy the list, and work through it in batches.

## Project layout

```
index.html          the app shell (garden, session, cards, parent corner)
print.html           standalone 田字格 worksheet generator, for printing
manifest.json         PWA manifest
sw.js                 service worker (offline caching)
css/                  styles.css (app), print.css (print.html only)
js/                   ES modules — one file per concern (scheduler, quiz,
                       audio, session, garden, parent, print, etc.)
data/characters.json   the 200-character curriculum
data/ui_lines.json     every spoken UI line, keyed by a stable id
assets/strokes/        per-character stroke data (generated)
assets/audio/          per-line MP3s (generated); assets/audio/custom/
                       overrides any single line
assets/img/            character illustrations (optional; emoji is the
                       fallback)
vendor/                Hanzi Writer, vendored locally
scripts/               the two setup scripts above, plus dev_server.py
                       (a no-cache local server, handy while developing —
                       not needed for actual deployment)
```
