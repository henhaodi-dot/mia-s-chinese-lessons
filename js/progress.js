// Manages the single versioned progress blob in localStorage. This is the
// only place in the app that reads or writes that key directly — everything
// else goes through the functions here so the storage format can change
// (via schemaVersion + a migration step) without touching the rest of the app.

const STORAGE_KEY = "hanziGardenProgress";
const SCHEMA_VERSION = 3;

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

  return migrate(parsed);
}

function migrate(progress) {
  const fromVersion = progress.schemaVersion || 1;

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

  progress.schemaVersion = SCHEMA_VERSION;
  return progress;
}

export function saveProgress(progress) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
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

// ---------- paper-practice stickers ----------
// Additive/optional field: older saved blobs simply have no stickers yet,
// which reads the same as "zero" everywhere this is used.

export function awardSticker(progress, char) {
  if (!progress.stickers) progress.stickers = {};
  progress.stickers[char] = (progress.stickers[char] || 0) + 1;
}

export function getStickerCount(progress, char) {
  return progress.stickers?.[char] || 0;
}

// ---------- export / import (Parent Corner sync path) ----------

export function exportProgressJson(progress) {
  return JSON.stringify(progress, null, 2);
}

export function importProgressJson(json) {
  const parsed = JSON.parse(json);
  return migrate(parsed);
}
