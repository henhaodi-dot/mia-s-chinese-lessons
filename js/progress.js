// Manages the single versioned progress blob in localStorage. This is the
// only place in the app that reads or writes that key directly — everything
// else goes through the functions here so the storage format can change
// (via schemaVersion + a migration step) without touching the rest of the app.

// rest.js imports addDaysToLocalDateString back from here — a circular
// import that's safe because every use is deferred to call time, never
// module-evaluation time.
import { isResting, recentMissCount, shelve, MISS_THRESHOLD } from "./rest.js";

const STORAGE_KEY = "hanziGardenProgress";
const SCHEMA_VERSION = 4;

// ---------- local-date helpers ----------
// Everything in this app keys off the device's local calendar date, never
// UTC, so "today" always means "today where the tablet is", not GMT.

export function todayLocalDateString(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function addDaysToLocalDateString(dateStr, days) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + days);
  return todayLocalDateString(dt);
}

export function daysBetweenLocalDateStrings(fromStr, toStr) {
  const [fy, fm, fd] = fromStr.split("-").map(Number);
  const [ty, tm, td] = toStr.split("-").map(Number);
  const from = new Date(fy, fm - 1, fd);
  const to = new Date(ty, tm - 1, td);
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.round((to - from) / msPerDay);
}

// ---------- default shape ----------

function makeDefaultProgress() {
  return {
    schemaVersion: SCHEMA_VERSION,
    pandaName: "熊猫",
    settings: {
      dailyNewCount: 3,
      paused: false,
      startDate: todayLocalDateString(),
    },
    lastSessionDate: null,
    streakCalendar: {}, // { "2026-07-08": true, ... }
    characters: {}, // char -> { box, nextDue, timesSeen, timesCorrect, dateLearned, source, shaky, gamesSeen }
    sessionLog: [], // { date, newChars: [char,...], exitStars: {char: 1-3}, throttled: false|"2"|"1" }
  };
}

// ---------- load / save ----------

export function loadProgress() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return makeDefaultProgress();
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Corrupt data is treated the same as no data — we never guess-repair
    // JSON, since a half-wrong blob is worse than a fresh start.
    return makeDefaultProgress();
  }

  const migrated = migrate(parsed);
  // Persist any repair/migration right away, so the stored blob is always in
  // the current shape (an export taken before the next save would otherwise
  // still carry the old one).
  if (JSON.stringify(migrated) !== raw) saveProgress(migrated);
  return migrated;
}

// True for a plain object (not null, not an array) — the only shape a saved
// progress blob or any of its sub-records can have.
function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function migrate(progress) {
  const fromVersion = progress.schemaVersion || 1;

  // Structural repair, before any versioned migration: every top-level
  // container the rest of the app dereferences without checking must exist
  // with the right shape. A blob missing one of these (a hand-edited or
  // partially-written export, an older build's format, a wrong file that
  // slipped past the import check) used to throw during the very first
  // garden render — a blank screen until site data was cleared. Missing
  // pieces get defaults; present ones are never touched.
  const defaults = makeDefaultProgress();
  if (!isRecord(progress.settings)) progress.settings = {};
  for (const [key, value] of Object.entries(defaults.settings)) {
    if (progress.settings[key] === undefined) progress.settings[key] = value;
  }
  if (typeof progress.pandaName !== "string" || !progress.pandaName) progress.pandaName = defaults.pandaName;
  if (!isRecord(progress.characters)) progress.characters = {};
  for (const [char, state] of Object.entries(progress.characters)) {
    // A character record without a box/nextDue can't be scheduled — drop
    // it rather than let every isDue()/growthStageFor() call trip on it.
    if (!isRecord(state) || typeof state.box !== "number" || typeof state.nextDue !== "string") {
      delete progress.characters[char];
    }
  }
  if (!Array.isArray(progress.sessionLog)) progress.sessionLog = [];

  if (fromVersion < 2) {
    // v2 adds: sessionLog (empty is fine, it's just history), and per-
    // character shaky/gamesSeen (undefined reads the same as "never
    // tested"/0 everywhere they're used, so existing character records
    // don't need to be touched). We only ADD missing fields here — a
    // parent's already-chosen settings (like dailyNewCount) must survive
    // untouched, not get silently reset to v2's new default.
    if (!progress.sessionLog) progress.sessionLog = [];
  }

  // v3 adds: per-character hearts (cumulative), heartsToday + heartsTodayDate
  // (device-local daily cap tracking), and visitors[] — all read via
  // reviewRules.js, which already treats undefined the same as "zero/none"
  // everywhere it's used. No per-character loop needed; existing box/
  // nextDue/shaky data is untouched either way.

  // v4 adds: per-character restUntil (null/absent = active), recentMisses[]
  // (rolling miss log for auto-shelve), needsReintro; plus top-level
  // sessionSeq (review-session counter) and characterOrder (custom new-char
  // sequence). All read as "absent = default" everywhere (isResting treats
  // no restUntil as active, recentMisses||[], characterOrder falls back to
  // rank order), so existing data needs no touch-up.

  // Backfill streakCalendar for all days from startDate to today.
  if (!isRecord(progress.streakCalendar)) progress.streakCalendar = {};
  const start = progress.settings?.startDate;
  if (start && Object.keys(progress.streakCalendar).length === 0) {
    const today = todayLocalDateString();
    let d = new Date(start + "T00:00:00");
    const end = new Date(today + "T00:00:00");
    while (d <= end) {
      const ds = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      progress.streakCalendar[ds] = true;
      d.setDate(d.getDate() + 1);
    }
  }

  progress.schemaVersion = SCHEMA_VERSION;
  return progress;
}

export function saveProgress(progress) {
  progress.streakCalendar[todayLocalDateString()] = true;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
  } catch (err) {
    // Storage full or blocked (private mode, quota). The in-memory state is
    // still right for this session; better to keep playing than to crash
    // mid-game over a save.
    console.warn("Could not save progress:", err);
  }
}

// ---------- character state helpers ----------

export function getCharacterState(progress, char) {
  return progress.characters[char] || null;
}

export function hasMetCharacter(progress, char) {
  return Boolean(progress.characters[char]);
}

export function seedCharacter(progress, char, { box, source, dateLearned }) {
  progress.characters[char] = {
    box,
    nextDue: addDaysToLocalDateString(dateLearned, box === 5 ? 16 : box),
    timesSeen: 1,
    timesCorrect: 0,
    dateLearned,
    source,
  };
}

export function markStreakDay(progress, dateStr) {
  progress.streakCalendar[dateStr] = true;
}

// ---------- v2: games, exit test, session log ----------

export function recordGameSeen(progress, char) {
  const state = progress.characters[char];
  if (!state) return;
  state.gamesSeen = (state.gamesSeen || 0) + 1;
}

export function setShaky(progress, char, isShaky) {
  const state = progress.characters[char];
  if (!state) return;
  state.shaky = isShaky;
}

// ---------- v4: review sessions + auto-shelve miss tracking ----------

// Bumped at the start of every review session (a character-room game set, a
// garden tap review, an exit test) so recentMisses can be windowed to "the
// last N sessions".
export function startReviewSession(progress) {
  progress.sessionSeq = (progress.sessionSeq || 0) + 1;
  return progress.sessionSeq;
}

// Logs one miss for a character in the current session and shelves it if it
// has now missed too many times within the recent-session window. No-op for
// a character that's already resting or unknown.
export function recordMiss(progress, char, todayStr) {
  const state = progress.characters[char];
  if (!state || isResting(state, todayStr)) return;
  const seq = progress.sessionSeq || 0;
  if (!state.recentMisses) state.recentMisses = [];
  state.recentMisses.push(seq);
  if (state.recentMisses.length > 12) state.recentMisses = state.recentMisses.slice(-12);
  if (recentMissCount(state, seq) >= MISS_THRESHOLD) {
    shelve(progress, char, todayStr);
  }
}

export function isShaky(progress, char) {
  return Boolean(progress.characters[char]?.shaky);
}

export function appendSessionLogEntry(progress, entry) {
  if (!progress.sessionLog) progress.sessionLog = [];
  progress.sessionLog.push(entry);
  // Keep the log from growing without bound — recent history is what's
  // useful in Parent Corner, not a permanent ledger.
  const MAX_LOG_ENTRIES = 60;
  if (progress.sessionLog.length > MAX_LOG_ENTRIES) {
    progress.sessionLog = progress.sessionLog.slice(-MAX_LOG_ENTRIES);
  }
}

// ---------- practice stickers (studio + any future source) ----------
// Additive/optional field: older saved blobs simply have no stickers yet,
// which reads the same as "zero" everywhere this is used.

export function awardSticker(progress, char) {
  if (!progress.stickers) progress.stickers = {};
  progress.stickers[char] = (progress.stickers[char] || 0) + 1;
}

export function getStickerCount(progress, char) {
  return progress.stickers?.[char] || 0;
}

// ---------- practice studio ink bottle (v2.3) ----------
// Device-local, resets daily, purely decorative — never touches box,
// hearts, or the review schedule. Every completed 描/写 in the studio adds
// one drop; a full bottle (10) awards a sticker to whatever character was
// being practiced and empties back to 0, so it can fill again the same day.

export const INK_BOTTLE_CAPACITY = 10;

// Returns { drops, bottleFilled } — bottleFilled is true exactly on the
// drop that fills the bottle, so the caller knows to award a sticker.
export function addInkDrop(progress, todayStr) {
  if (progress.inkDropsDate !== todayStr) {
    progress.inkDrops = 0;
    progress.inkDropsDate = todayStr;
  }
  progress.inkDrops = (progress.inkDrops || 0) + 1;

  if (progress.inkDrops >= INK_BOTTLE_CAPACITY) {
    progress.inkDrops = 0;
    return { drops: 0, bottleFilled: true };
  }
  return { drops: progress.inkDrops, bottleFilled: false };
}

export function getInkDrops(progress, todayStr) {
  if (progress.inkDropsDate !== todayStr) return 0;
  return progress.inkDrops || 0;
}

// ---------- export / import (Parent Corner sync path) ----------

export function exportProgressJson(progress) {
  return JSON.stringify(progress, null, 2);
}

// Throws on anything that isn't a Hanzi Garden progress export, so Parent
// Corner can say "not a progress file" instead of overwriting good data
// with, say, a story episode JSON that happened to be nearby.
export function importProgressJson(json) {
  const parsed = JSON.parse(json);
  if (!isRecord(parsed)) throw new Error("not a progress object");
  if (!isRecord(parsed.characters) || !isRecord(parsed.settings)) {
    throw new Error("not a progress file");
  }
  return migrate(parsed);
}
