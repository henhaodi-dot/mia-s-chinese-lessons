// 休息 (character rest / auto-shelve): a character she keeps getting wrong
// shouldn't keep hammering her — after enough recent misses it goes to sleep
// for two weeks (a pillow in the garden, not a failure), then comes back
// gently at box 1 with a reintroduction before any testing.
//
// This module is the pure decision logic (no DOM, no storage side-effects
// beyond mutating the passed state), so it's easy to reason about and test.
// progress.js owns the wrappers that thread `progress` + today's date in.

import { addDaysToLocalDateString } from "./progress.js";

export const REST_DAYS = 14;
export const MISS_THRESHOLD = 4; // misses within the recent window that trigger a rest
export const RECENT_SESSIONS = 3; // "last 3 sessions" window
export const MAX_RESTING = 5;

export function isResting(charState, todayStr) {
  return Boolean(charState && charState.restUntil) && charState.restUntil > todayStr;
}

// How many misses this character has logged within the last RECENT_SESSIONS
// review sessions (each miss is stamped with the session sequence it happened
// in). currentSeq is progress.sessionSeq.
export function recentMissCount(charState, currentSeq) {
  const misses = charState.recentMisses || [];
  return misses.filter((seq) => seq > currentSeq - RECENT_SESSIONS).length;
}

// Puts a character to sleep for REST_DAYS. Clears its miss log so it comes
// back with a clean slate. Enforces the max-resting cap by waking the
// character that has been resting longest (earliest restUntil) if this one
// would be the (MAX_RESTING + 1)th.
export function shelve(progress, char, todayStr) {
  const state = progress.characters[char];
  if (!state) return;
  state.restUntil = addDaysToLocalDateString(todayStr, REST_DAYS);
  state.recentMisses = [];

  const resting = Object.entries(progress.characters).filter(([, s]) => isResting(s, todayStr));
  if (resting.length > MAX_RESTING) {
    resting.sort((a, b) => (a[1].restUntil < b[1].restUntil ? -1 : 1));
    const [oldest] = resting[0];
    if (oldest !== char) wake(progress, oldest, todayStr);
  }
}

// Brings a character back: box 1, due now, needs a gentle reintroduction
// before it's tested again.
export function wake(progress, char, todayStr) {
  const state = progress.characters[char];
  if (!state) return;
  state.restUntil = null;
  state.box = 1;
  state.nextDue = todayStr;
  state.shaky = false;
  state.recentMisses = [];
  state.needsReintro = true;
}

// Wakes any character whose rest period has ended. Call on app open and on
// entering the character room.
export function processWakeups(progress, todayStr) {
  const woken = [];
  for (const [char, state] of Object.entries(progress.characters)) {
    if (state.restUntil && state.restUntil <= todayStr) {
      wake(progress, char, todayStr);
      woken.push(char);
    }
  }
  return woken;
}

// Characters currently resting, soonest to wake first — for Parent Corner.
export function restingCharacters(progress, todayStr) {
  return Object.entries(progress.characters)
    .filter(([, s]) => isResting(s, todayStr))
    .sort((a, b) => (a[1].restUntil < b[1].restUntil ? -1 : 1))
    .map(([char, s]) => ({ char, restUntil: s.restUntil }));
}
