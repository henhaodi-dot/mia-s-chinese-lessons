// 今日小剧场 (daily micro-story): looks up the pre-generated story for a
// given triple of new characters. Stories are keyed by the sorted-by-rank
// triple so a story only plays when today's actual new-character triple
// matches what stories.json was built from — if the known-characters list
// changes later and the triples shift, this naturally (and silently)
// returns null, and the caller skips the story round gracefully rather
// than showing a mismatched one.

let storiesCache = null;

async function loadStories() {
  if (!storiesCache) {
    const res = await fetch("./data/stories.json");
    const list = await res.json();
    storiesCache = new Map(list.map((story) => [story.chars.join(""), story]));
  }
  return storiesCache;
}

// Synchronous lookup against an already-warmed cache; callers that need
// this before the cache is loaded should await warmStoriesCache() first.
// (Kept synchronous here because session.js's round structure calls this
// mid-flow without wanting to sprinkle awaits through unrelated code.)
export function getStoryForTriple(chars) {
  if (!storiesCache) return null;
  return storiesCache.get([...chars].join("")) || null;
}

export async function warmStoriesCache() {
  await loadStories();
}

// Every story, for the speaking room's A4 retell activity (which wants any
// story, not one keyed to today's exact new-character triple).
export async function getAllStories() {
  const cache = await loadStories();
  return [...cache.values()];
}
