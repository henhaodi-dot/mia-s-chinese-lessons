// Service worker: cache-first for the app shell, data, strokes, audio, and
// images, so the app is fully usable offline after one online load.
//
// ============================================================
// REMINDER — bump ALL THREE of these on every deploy that changes any
// cached file (any HTML/CSS/JS edit, new characters, new audio, new
// images):
//   1. CACHE_VERSION below
//   2. the "v" field in /version.json
//   3. APP_VERSION in js/version.js
// (1) makes install() build a fresh cache and activate() delete the old
// one. (2) and (3) are how js/updateCheck.js detects — on every app open,
// via a network request that always bypasses every cache — that a new
// deploy exists even before the service worker itself has updated, so it
// can proactively reload instead of waiting on the browser's own (slow,
// throttled) update check. Forgetting any one of the three means a
// tablet/phone that already installed the app can keep serving stale files
// far longer than expected. See README.md.
// ============================================================
const CACHE_VERSION = "v25";
const CACHE_NAME = `hanzi-garden-${CACHE_VERSION}`;

// The app shell — always needed regardless of which characters she's
// learned so far.
const SHELL_FILES = [
  "./",
  "./index.html",
  "./manifest.json",
  "./css/styles.css",
  "./vendor/hanzi-writer.min.js",
  "./js/app.js",
  "./js/audio.js",
  "./js/data.js",
  "./js/exitTest.js",
  "./js/games.js",
  "./js/garden.js",
  "./js/gardenReview.js",
  "./js/reviewRules.js",
  "./js/updateCheck.js",
  "./js/version.js",
  "./js/studio.js",
  "./js/echo.js",
  "./js/arcade.js",
  "./js/speaking.js",
  "./js/recorder.js",
  "./js/recordings.js",
  "./js/parent.js",
  "./js/print.js",
  "./js/progress.js",
  "./js/quiz.js",
  "./js/scheduler.js",
  "./js/session.js",
  "./js/stories.js",
  "./js/strokes.js",
  "./js/weekly.js",
  "./data/characters.json",
  "./data/ui_lines.json",
  "./data/stories.json",
  "./assets/icons/icon-192.png",
  "./assets/icons/icon-512.png",
];

const FETCH_TIMEOUT_MS = 8000;

// Fetches and caches one URL, but never lets a missing/failed resource
// (e.g. audio clips before generate_audio.py has been run) — or one stuck
// on a slow/flaky connection — abort the whole install. Every other file
// should still get cached even if this one never resolves.
async function cacheOne(cache, url) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    if (res.ok) await cache.put(url, res);
  } catch {
    // Offline install, timed out, or the resource genuinely doesn't exist
    // yet — skip it.
  }
}

// Precaches every character's audio + stroke data, and every UI line's
// audio, so a single online load is enough for full offline use — not
// just whatever she happens to review that day.
async function cacheAllCharacterAssets(cache) {
  const [charactersRes, uiLinesRes] = await Promise.all([
    fetch("./data/characters.json"),
    fetch("./data/ui_lines.json"),
  ]);
  const characters = await charactersRes.json();
  const uiLines = await uiLinesRes.json();

  const urls = [];
  for (const entry of characters) {
    const char = entry.char;
    urls.push(`./assets/strokes/${encodeURIComponent(char)}.json`);
    urls.push(`./assets/audio/char_${encodeURIComponent(char)}.mp3`);
    urls.push(`./assets/audio/word_${encodeURIComponent(char)}.mp3`);
    urls.push(`./assets/audio/sentence_${encodeURIComponent(char)}.mp3`);
    urls.push(`./assets/img/${encodeURIComponent(char)}.png`);
  }
  for (const key of Object.keys(uiLines)) {
    urls.push(`./assets/audio/${key}.mp3`);
  }

  // Firing all ~1200 requests at once (Promise.all over the whole list)
  // overwhelms the connection pool and effectively stalls — process in
  // small concurrent batches instead.
  const BATCH_SIZE = 12;
  for (let i = 0; i < urls.length; i += BATCH_SIZE) {
    const batch = urls.slice(i, i + BATCH_SIZE);
    await Promise.all(batch.map((url) => cacheOne(cache, url)));
  }
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      await Promise.all(SHELL_FILES.map((url) => cacheOne(cache, url)));
      await cacheAllCharacterAssets(cache);
      await self.skipWaiting(); // don't wait for old tabs to close before activating
    })()
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names.filter((name) => name.startsWith("hanzi-garden-") && name !== CACHE_NAME).map((name) => caches.delete(name))
      );
      await self.clients.claim(); // take control of already-open tabs immediately
    })()
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return; // only handle our own files

  // version.json is how updateCheck.js detects a new deploy exists — it
  // must always hit the network and must never be cached, or the whole
  // mechanism just checks a frozen copy of itself forever.
  if (url.pathname.endsWith("/version.json")) {
    event.respondWith(fetch(event.request, { cache: "no-store" }));
    return;
  }

  event.respondWith(
    (async () => {
      const cached = await caches.match(event.request);
      if (cached) return cached;

      try {
        const res = await fetch(event.request);
        if (res.ok) {
          const cache = await caches.open(CACHE_NAME);
          cache.put(event.request, res.clone());
        }
        return res;
      } catch (err) {
        // Truly offline and not cached — nothing more we can do for this request.
        throw err;
      }
    })()
  );
});
