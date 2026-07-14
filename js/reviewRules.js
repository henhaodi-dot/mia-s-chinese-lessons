// Garden tap-to-review (v2.3): the core rule this module exists to protect
// is that a plant's Leitner box may only ever advance through a review that
// was actually due. Everything else here is either a struggle safety net or
// a purely decorative heart/visitor track that must never leak into box or
// nextDue. These functions mutate the character-state object they're given
// (same convention as scheduler.js's growAfterCorrect) and return a small
// outcome descriptor so the UI knows what to show.

import { addDaysToLocalDateString } from "./progress.js";
import { growAfterCorrect } from "./scheduler.js";

export const HEART_DAILY_CAP = 3;

// Cumulative (lifetime) hearts unlock a permanent decoration on that plant.
export const VISITOR_THRESHOLDS = [
  { hearts: 3, id: "butterfly" },
  { hearts: 7, id: "ladybug" },
  { hearts: 15, id: "firefly" },
];

function resetHeartsTodayIfStale(charState, todayStr) {
  if (charState.heartsTodayDate !== todayStr) {
    charState.heartsToday = 0;
    charState.heartsTodayDate = todayStr;
  }
}

function unlockVisitors(charState) {
  if (!charState.visitors) charState.visitors = [];
  const newlyUnlocked = [];
  for (const { hearts, id } of VISITOR_THRESHOLDS) {
    if (charState.hearts >= hearts && !charState.visitors.includes(id)) {
      charState.visitors.push(id);
      newlyUnlocked.push(id);
    }
  }
  return newlyUnlocked;
}

// Rule 1 — success on a plant that was actually due: the only path that
// grows a plant's box. Reuses scheduler.js's normal reschedule, which also
// clears thirst (nextDue moves into the future) as a side effect.
export function applyDueSuccess(charState, todayStr) {
  growAfterCorrect(charState, todayStr);
  return { outcome: "grew" };
}

// Rule 2 — success on a plant that wasn't due: decorative only. Box and
// nextDue are never touched here, on pain of inflating mastery ahead of
// schedule. Hearts are capped per plant per day (device-local, keyed by
// local date) and unlock permanent visitor decorations at lifetime totals.
export function applyNotDueSuccess(charState, todayStr) {
  resetHeartsTodayIfStale(charState, todayStr);

  if (charState.heartsToday >= HEART_DAILY_CAP) {
    return { outcome: "content", newVisitors: [] };
  }

  charState.heartsToday += 1;
  charState.hearts = (charState.hearts || 0) + 1;
  const newVisitors = unlockVisitors(charState);
  return { outcome: "heart", newVisitors };
}

// Rule 3 — a struggle on ANY plant, due or not: box is never demoted here,
// but she clearly needs another look, so it's marked shaky and pulled to be
// due again tomorrow regardless of where it was in its normal schedule.
export function applyStruggle(charState, todayStr) {
  charState.shaky = true;
  charState.nextDue = addDaysToLocalDateString(todayStr, 1);
  return { outcome: "struggled" };
}

// Single entry point the garden tap flow calls once a review round ends.
export function applyGardenTapOutcome(charState, { isDue, struggled }, todayStr) {
  if (struggled) return applyStruggle(charState, todayStr);
  if (isDue) return applyDueSuccess(charState, todayStr);
  return applyNotDueSuccess(charState, todayStr);
}
