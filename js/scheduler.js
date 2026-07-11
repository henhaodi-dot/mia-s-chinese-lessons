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

// Picks the next not-yet-introduced character (by rank) for today's seed,
// respecting the daily limit and pause toggle.
export function pickTodaysNewCharacter(progress, allCharacters, todayStr) {
  if (progress.settings.paused) return null;
  if (progress.settings.dailyNewCount < 1) return null;

  const alreadyLearnedToday = Object.values(progress.characters).some(
    (state) => state.source === "daily" && state.dateLearned === todayStr
  );
  if (alreadyLearnedToday) return null;

  const sorted = [...allCharacters].sort((a, b) => a.rank - b.rank);
  return sorted.find((entry) => !progress.characters[entry.char]) || null;
}
