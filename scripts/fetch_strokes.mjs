// Downloads stroke-order data for every character we might need, so the app
// can animate and quiz strokes fully offline (no runtime network requests).
//
// Reads:
//   - data/characters.json          (the 200 characters we teach)
//   - data/known_characters.txt     (her already-known characters, any format)
// Writes:
//   - assets/strokes/{char}.json    (one Hanzi Writer stroke-data file per character)
//
// Safe to re-run any time: it skips characters that already have a file on
// disk, so adding new characters later just means "edit characters.json,
// run this again" and only the new ones get downloaded.
//
// Usage: node scripts/fetch_strokes.mjs

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const CHARACTERS_FILE = path.join(ROOT, "data", "characters.json");
const KNOWN_CHARACTERS_FILE = path.join(ROOT, "data", "known_characters.txt");
const STROKES_DIR = path.join(ROOT, "assets", "strokes");

// hanzi-writer-data publishes one JSON file per character at the package
// root. Pinning to major version 2 keeps this working even if new patch
// versions are published later.
const STROKE_DATA_BASE_URL = "https://cdn.jsdelivr.net/npm/hanzi-writer-data@2";

// A tiny pause between requests so we don't hammer the CDN.
const REQUEST_DELAY_MS = 40;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Pulls every CJK character out of a string, ignoring punctuation, English
// notes, numbers, etc. This is the same rule Parent Corner's known-character
// import uses, so both places agree on what counts as "a character".
function extractChineseCharacters(text) {
  const matches = text.match(/[一-鿿]/g) || [];
  return matches;
}

async function loadCharacterSet() {
  const chars = new Set();

  const charactersJson = JSON.parse(await readFile(CHARACTERS_FILE, "utf8"));
  for (const entry of charactersJson) {
    chars.add(entry.char);
  }

  if (existsSync(KNOWN_CHARACTERS_FILE)) {
    const knownText = await readFile(KNOWN_CHARACTERS_FILE, "utf8");
    for (const char of extractChineseCharacters(knownText)) {
      chars.add(char);
    }
  }

  return chars;
}

async function fetchStrokeData(char) {
  const url = `${STROKE_DATA_BASE_URL}/${encodeURIComponent(char)}.json`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return await response.text();
}

async function main() {
  await mkdir(STROKES_DIR, { recursive: true });

  const chars = await loadCharacterSet();
  console.log(`Found ${chars.size} unique characters to check.\n`);

  let fetched = 0;
  let skipped = 0;
  const missing = [];

  for (const char of chars) {
    const outPath = path.join(STROKES_DIR, `${char}.json`);

    if (existsSync(outPath)) {
      skipped++;
      continue;
    }

    try {
      const json = await fetchStrokeData(char);
      await writeFile(outPath, json, "utf8");
      fetched++;
      console.log(`  fetched ${char}`);
    } catch (err) {
      missing.push(char);
      console.log(`  MISSING ${char} (${err.message})`);
    }

    await sleep(REQUEST_DELAY_MS);
  }

  console.log("\n--- Summary ---");
  console.log(`Fetched: ${fetched}`);
  console.log(`Skipped (already had a file): ${skipped}`);
  console.log(`Missing (failed to download): ${missing.length}`);
  if (missing.length > 0) {
    console.log(`  ${missing.join(" ")}`);
    console.log(
      "  These characters have no stroke data yet. Tracing/write-from-memory\n" +
        "  quizzes will be unavailable for them until you re-run this script\n" +
        "  (maybe the character isn't in hanzi-writer-data, or the network\n" +
        "  request failed — try again)."
    );
  }
}

main();
