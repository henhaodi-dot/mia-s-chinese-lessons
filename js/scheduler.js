// The spaced-repetition engine: Leitner boxes 1-5 with fixed intervals,
// mapped onto the garden's growth stages.
//
// Growth stage shown to her is normally just the box number (1=sprout,
// 2=seedling, 3=bud, 4=flower, 5=golden). The one exception is stage 0
// (种子 seed): a character she was freshly taught *today* always shows as
// a seed for that first day, even though its stored box is already 1 —
// that's a purely cosmetic same-day override, not a real box. Known
// characters imported from Parent Corner skip this, since she already
// knows them and should see their real stage immediately.

import { addDaysToLocalDateString } from "./progress.js";

export const BOX_INTERVAL_DAYS = { 1: 1, 2: 2, 3: 4, 4: 8, 5: 16 };
export const GOLDEN_MAINTENANCE_INTERVAL_DAYS = 30;
export const MIN_BOX = 1;
export const MAX_BOX = 5;

export function growthStageFor(charState, todayStr) {
  if (charState.source === "daily" && charState.dateLearned === todayStr) {
    return 0;
  }
  return charState.box;
}

export function isDue(charState, todayStr) {
  return charState.nextDue <= todayStr;
}

// Call after a character is answered correctly (grows one stage).
export function growAfterCorrect(charState, todayStr) {
  const fromBox = charState.box;
  const toBox = Math.min(MAX_BOX, fromBox + 1);
  charState.box = toBox;
  charState.timesCorrect += 1;
  charState.nextDue = nextDueDate(fromBox, toBox, todayStr);
}

// Call after a character is missed twice in the same session (shrinks one
// stage, minimum sprout, and is always rescheduled for tomorrow regardless
// of what the box interval table would normally say).
export function shrinkAfterSecondMiss(charState, todayStr) {
  charState.box = Math.max(MIN_BOX, charState.box - 1);
  charState.nextDue = addDaysToLocalDateString(todayStr, 1);
}

function nextDueDate(fromBox, toBox, todayStr) {
  let days;
  if (toBox === 5) {
    days = fromBox === 5 ? GOLDEN_MAINTENANCE_INTERVAL_DAYS : BOX_INTERVAL_DAYS[5];
  } else {
    days = BOX_INTERVAL_DAYS[toBox] ?? 1;
  }
  return addDaysToLocalDateString(todayStr, days);
}

// Builds today's watering queue: everything due, most-overdue first,
// capped at 8 so a missed week never turns into a pile-up.
export function buildDueQueue(progress, todayStr, maxItems = 8) {
  const due = Object.entries(progress.characters)
    .filter(([, state]) => isDue(state, todayStr))
    .sort((a, b) => (a[1].nextDue < b[1].nextDue ? -1 : a[1].nextDue > b[1].nextDue ? 1 : 0));

  return due.slice(0, maxItems).map(([char]) => char);
}

// How many daily-source characters she's already learned today — the v2
// session plants all of today's new characters in one go (Round 1), but
// this still matters for the "tap again later" case and for computing
// the remaining budget after auto-throttle.
export function countLearnedToday(progress, todayStr) {
  return Object.values(progress.characters).filter(
    (state) => state.source === "daily" && state.dateLearned === todayStr
  ).length;
}

// Total due reviews, uncapped — used for the auto-throttle decision, which
// cares about total workload, not just what fits in one session's cap of 8.
export function countAllDue(progress, todayStr) {
  return Object.values(progress.characters).filter((state) => isDue(state, todayStr)).length;
}

// Auto-throttle: a heavy review day quietly reduces how many new
// characters get introduced, so the session doesn't balloon past the
// 12-18 minute target. Returns the throttled cap, or null if not throttled.
export function throttledNewCountCap(dueCount) {
  if (dueCount > 22) return 1;
  if (dueCount > 15) return 2;
  return null;
}

// Picks up to `count` not-yet-introduced characters (by rank), respecting
// the daily limit, auto-throttle, and pause toggle. Returns an array
// (possibly empty) — Round 1 introduces all of them in one session.
export function pickTodaysNewCharacters(progress, allCharacters, todayStr) {
  if (progress.settings.paused) return [];

  let budget = progress.settings.dailyNewCount;
  const throttleCap = throttledNewCountCap(countAllDue(progress, todayStr));
  if (throttleCap !== null) budget = Math.min(budget, throttleCap);

  const learnedToday = countLearnedToday(progress, todayStr);
  const remaining = Math.max(0, budget - learnedToday);
  if (remaining < 1) return [];

  const sorted = [...allCharacters].sort((a, b) => a.rank - b.rank);
  const candidates = sorted.filter((entry) => !progress.characters[entry.char]);
  return candidates.slice(0, remaining);
}
