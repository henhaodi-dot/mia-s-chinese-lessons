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

## Every deploy needs a three-way version bump

`sw.js` caches the app shell, data, stroke files, audio, and images so the
app works fully offline. **On every deploy that changes any cached file**
(any HTML/CSS/JS edit, new characters, new audio, new images), bump the
version string in all three of these places:

1. `CACHE_VERSION` at the top of `sw.js`
2. the `"v"` field in `version.json`
3. `APP_VERSION` in `js/version.js`

Why three places: (1) is what makes `install()` build a fresh cache under a
new name and `activate()` delete the old one. But a tablet/phone with the
app already open won't pick up new JS just because a new service worker
installed in the background — and browsers only check a service worker
script for changes occasionally (often once a day), so relying on that
alone can leave old code running for hours. (2) and (3) close that gap:
`js/updateCheck.js` fetches `version.json` fresh on every app open (a tiny
request that always bypasses every cache layer) and compares it to the
version baked into the JS that's currently running. A mismatch means a new
deploy exists that hasn't been picked up yet — the app shows a small "有新
内容，正在更新…" toast, nudges the service worker to update, and reloads once
the new one has taken over. If `version.json` is unreachable (offline), the
app just keeps running the cached version silently.

Forgetting any one of the three defeats the others — e.g. bumping
`CACHE_VERSION` without bumping `version.json` means `updateCheck.js` never
notices anything changed, and a tablet with the app already open could sit
on stale JS until it happens to fully close and reopen while online.

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

## Extending the daily micro-story (今日小剧场)

`data/stories.json` has a short story + comprehension question for each of
the first 20 new-character triples at the default pace (3 new characters a
day, no throttle — ranks 1-60). `js/stories.js` looks a story up by the
exact rank-sorted triple of characters being taught that day; if a family's
actual pace differs (a different daily count, or auto-throttle kicking in
on a heavy review day) or the triple simply isn't written yet, Round 3.5
just skips silently — this is by design, not a bug, and Parent Corner's
"今日小剧场" section tells you whether *today's* upcoming triple has one.

To add more: each entry needs `chars` (the triple, rank order), `text` (the
story), `audioKey`, and a `question` with `audioKey`, three `{char, emoji}`
`options` (usually just that day's own three characters), and the correct
`answer`. Add the `audioKey`/`question.audioKey` text to `data/ui_lines.json`
like any other line, then run `scripts/generate_audio.py` — no code changes
needed, since it already reads every `ui_lines.json` entry.

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

### Batch-generating illustrations with Gemini

`scripts/generate_illustrations.py` fills in `assets/img/` for every
character automatically, using Gemini's Imagen model.

```
pip install google-genai Pillow
python scripts/generate_illustrations.py --api-key YOUR_GEMINI_KEY
```

It reads `data/characters.json`, skips characters already marked
`"picturable": false` (pure grammatical particles / measure words /
demonstratives — there's nothing concrete to draw) and any character that
already has a PNG, then generates the rest (~4 seconds each, so budget
about 4 seconds × however many are left). Costs real money per image on
your Gemini account — run it yourself rather than asking an assistant to
run it unattended.

After it finishes, open `review/illustration-review.html` in a browser: a
grid of every generated image plus a list of any picturable character
still missing one. Click any image that looks wrong to add it to a text
box at the bottom, then re-run with `--redo` and that character list to
regenerate just those (see the script's own docstring for the exact
flags). If a character keeps coming out wrong, add an `"illustrationHint"`
field to its `characters.json` entry with a more concrete description —
the script prefers that over the auto-built prompt when present.

`--review-only` rebuilds the review page from whatever images already
exist, with no API calls — safe to run anytime, including with a fake
`--api-key` value.

Once you're happy with a batch: `git add assets/img/`, commit, push, and
— as always — bump the three version markers above so devices actually
pick up the new pictures.

## Project layout

```
index.html          the app shell (garden, session, cards, parent corner)
print.html           standalone 田字格 worksheet generator, for printing
manifest.json         PWA manifest
sw.js                 service worker (offline caching)
version.json           tiny {"v": "..."} file used to detect a new deploy —
                       see "Every deploy needs a three-way version bump"
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
scripts/               the setup scripts above, plus dev_server.py
                       (a no-cache local server, handy while developing —
                       not needed for actual deployment)
review/                illustration-review.html (generated, gitignored) —
                       see "Batch-generating illustrations with Gemini"
```
