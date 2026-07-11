// Loads the two static data files. Both are fetched once at startup and
// kept in memory for the rest of the session — nothing here ever changes
// at runtime, so there's no need to re-fetch.

let charactersCache = null;
let uiLinesCache = null;

export async function loadCharacters() {
  if (!charactersCache) {
    const res = await fetch("./data/characters.json");
    charactersCache = await res.json();
  }
  return charactersCache;
}

export async function loadUiLines() {
  if (!uiLinesCache) {
    const res = await fetch("./data/ui_lines.json");
    uiLinesCache = await res.json();
  }
  return uiLinesCache;
}

// Convenience: characters.json as a Map keyed by char, since almost every
// lookup in the app is "give me the entry for this character".
let charByCharCache = null;

export async function loadCharacterMap() {
  if (!charByCharCache) {
    const list = await loadCharacters();
    charByCharCache = new Map(list.map((entry) => [entry.char, entry]));
  }
  return charByCharCache;
}
