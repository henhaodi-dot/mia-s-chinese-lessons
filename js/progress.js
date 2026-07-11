// Manages the single versioned progress blob in localStorage. This is the
// only place in the app that reads or writes that key directly — everything
// else goes through the functions here so the storage format can change
// (via schemaVersion + a migration step) without touching the rest of the app.

const STORAGE_KEY = "hanziGardenProgress";
const SCHEMA_VERSION = 1;

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
      dailyNewCount: 1,
      paused: false,
      startDate: todayLocalDateString(),
    },
    lastSessionDate: null,
    streakCalendar: {}, // { "2026-07-08": true, ... }
    characters: {}, // char -> { box, nextDue, timesSeen, timesCorrect, dateLearned, source }
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
  // No migrations needed yet — this is where a future schemaVersion bump
  // would add a step to upgrade an older blob in place.
  if (!progress.schemaVersion) {
    progress.schemaVersion = SCHEMA_VERSION;
  }
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
