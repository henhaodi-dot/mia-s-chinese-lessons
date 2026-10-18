# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

汉字花园 (Hanzi Garden): an offline-first PWA that helps a young Mandarin-speaking child (Mia) speak more and learn to recognize and write characters. Runs on a Fire tablet (Silk browser), deployed to GitHub Pages from `master`. Vanilla HTML/CSS/JS ES modules, **no build step, no npm dependencies, no backend**. `README.md` is detailed and current — read it for feature-level background.

## Commands

- **Dev server:** `python scripts/dev_server.py 8420` (no-cache static server; this is the `hanzi-garden-static` config in `.claude/launch.json`). `file://` does not work — ES modules and `fetch()` need HTTP.
- **Tests:** open `http://localhost:8420/tests/run-tests.html`. There is one suite (`tests/reviewRules.test.js`, a hand-rolled `test()` harness, no framework). Results are also exposed as `window.__testResults` and logged to the console, so they can be checked from the browser tools. To add tests, add `test(...)` calls to that file or import a new file from `run-tests.html`.
- **Asset generation** (after adding characters to `data/characters.json` or lines to `data/ui_lines.json`): `node scripts/fetch_strokes.mjs` (stroke data → `assets/strokes/`) and `python scripts/generate_audio.py` (edge-tts → `assets/audio/`). Both skip existing files.
- `scripts/generate_illustrations.py` calls a paid Gemini API — don't run it unattended; the user runs it.
- No linter or formatter is configured.

## Every deploy: three-way version bump

Any change to a cached file (HTML/CSS/JS/data/audio/images) must bump **all three**, kept in sync:
1. `CACHE_VERSION` in `sw.js` (e.g. `"v38"`)
2. `"v"` in `version.json` (e.g. `"3.3.0"`)
3. `APP_VERSION` in `js/version.js` (same value as `version.json`)

`js/updateCheck.js` compares (2) against (3) on every app open to force-reload stale tablets; (1) rotates the SW cache. Missing any one leaves devices on old code. The rationale is in README and the top of `sw.js`.

**New JS module or data file?** Also add it to `SHELL_FILES` in `sw.js`, or it won't work offline.

## Architecture

**Entry and rooms.** `index.html` loads `js/app.js`, which renders the garden home screen and opens one "room" at a time: 说说话 speaking (`speaking.js`), 认认字 characters (`characterRoom.js` + `games.js`), 故事 story mode (`storyMode.js`), garden plant tap review (`gardenReview.js`), and the writing studio (`studio.js`). Parent Corner (`parent.js`) sits behind an arithmetic gate.

**Cancellable runs (`js/nav.js`) — the key invariant.** Each room is an async function running under a single `AbortController`. Leaving via the tablet back button or the 🏠 button fires `popstate` → `app.js` calls `abortRun()` → every pending await rejects with `RunAborted` → the room unwinds through its `finally` blocks. Rules for any room code:
- Never await a bare `new Promise`/`setTimeout`. Use nav.js helpers (`sleep`, `waitForTap`, `waitForClick`, `untilAborted`) or `playLine` in `audio.js`, so every await is an abort point.
- Rooms call `enterScreen` at the start and `leaveScreen` in `finally` (pushes and pops a history entry so the back stack doesn't grow).
- `RunAborted` is a normal exit: catch it or let it propagate, but don't log it as an error (see the `guarded()` wrapper in `storyMode.js`).
- Anything that makes sound or holds the mic needs a stop path wired into `stopAllAudio()` in `app.js` or the room's `finally` (e.g. `releaseMic()` in story mode).

**State.**
- Learning progress is one versioned JSON blob in localStorage (`hanziGardenProgress`, `SCHEMA_VERSION` in `js/progress.js`). Only `progress.js` touches that key. Schema changes need a migration step there, since export/import of progress JSON is supported.
- Dates are always **local** `YYYY-MM-DD` strings via the helpers in `progress.js`, never UTC.
- Voice recordings live in IndexedDB (`js/recordings.js`) and never leave the device.

**Scheduling and review.** `scheduler.js` (Leitner boxes, due dates, daily new-character pick), `reviewRules.js` (pure functions: garden-tap outcomes, daily hearts cap, visitor thresholds — this is the tested module), `rest.js` (auto-rests often-missed characters for two weeks). Key invariant from the tests: a success on a not-due character must never change `box` or `nextDue`.

**Data** (`data/`): `characters.json` (the 200-character curriculum, rank order), `ui_lines.json` (every spoken UI line by stable key = audio filename), `dialogues.json` (speaking room A3), `stories.json` (daily micro-stories, keyed by that day's exact character triple; missing ones skip silently by design).

**Audio lookup.** Keys map to `assets/audio/{key}.mp3`; `assets/audio/custom/{key}.mp3` overrides any line if present. Illustrations are `assets/img/{char}.png`, with emoji as the fallback.

**Story mode episodes.** Each episode is `data/story-epNN.json` (`id`, `title`, `titleEmoji`, `assetBase`, `characters` for the 写一写 tracing layer, and `scenes[]` with `image`, `narration`, `phrase`, and `hotspots[]` positioned in percent `x/y/w/h`). Assets live in `assets/story/epNN/` (`.webp` images, `.m4a` recordings made by the family, not generated). **Adding an episode means registering the file in three places:** the `files` list in `loadEpisodes()` in `storyMode.js`, the `epFile` loop in `sw.js`, and `SHELL_FILES` in `sw.js`.

## Conventions

- Code is heavily commented with the *why* (often a bug that happened before). Keep that style and match the surrounding comment density.
- Child-facing text is Simplified Chinese. The child can't read yet, so everything she needs is spoken. No fail states or negative feedback toward her.
- Commits are descriptive, multi-line messages that mention the version bump.
