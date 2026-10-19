// 重点字 (focus characters): the app follows her school. A parent adds each
// week's school characters to data/focus.json (newest batch first), and
// while that list is non-empty it replaces the old rank-order "3 new
// characters a day" engine:
//
//   - every focus character is planted in the garden (she already learned
//     it at school, so it skips the new-seed intro);
//   - each day the character room opens with 3 focus characters to write
//     (trace once, then from memory), taken in list order from the ones she
//     hasn't written here yet; once all have had their first pass, the 3
//     slots go to the focus characters that most need review;
//   - games and the speaking room draw about half their characters from the
//     focus list, the rest from everything else she's learned.
//
// Pure logic only (no DOM, no storage) so the scheduling rules are testable
// in tests/focus.test.js. The day's pick lives in progress.focus:
//   { written: { char: "YYYY-MM-DD" },   // last day it was written in practice
//     day: { date, chars: [...] } }      // today's pick, stable across visits

import { addDaysToLocalDateString } from "./progress.js";
import { isResting } from "./rest.js";

export const FOCUS_DAILY_COUNT = 3;
// Box a newly planted focus character starts in: she knows it from school,
// but it's in active review, so it shouldn't start out looking mastered.
export const FOCUS_SEED_BOX = 2;

// Flattens the batches into one priority order (batches are stored newest
// first, so this week's school characters come first), keeping the first
// occurrence of a repeat and dropping anything the curriculum can't teach
// (no characters.json entry = no audio, picture, or stroke data).
export function focusOrder(focusData, charMap) {
  const seen = new Set();
  const order = [];
  for (const batch of focusData?.batches || []) {
    for (const char of Array.from(batch.chars || "")) {
      if (seen.has(char) || !charMap.has(char)) continue;
      seen.add(char);
      order.push(char);
    }
  }
  return order;
}

export function isFocusActive(order) {
  return order.length > 0;
}

function focusState(progress) {
  if (!progress.focus || typeof progress.focus !== "object") progress.focus = {};
  if (!progress.focus.written || typeof progress.focus.written !== "object") progress.focus.written = {};
  return progress.focus;
}

// Plants every focus character that isn't in the garden yet. Characters she
// already has keep their progress untouched. New ones are staggered so each
// first comes due on the day the daily pick is expected to reach it —
// planting 29 characters all due on the same day would flood the garden
// with thirsty plants. Returns the characters planted.
export function seedFocusCharacters(progress, order, todayStr) {
  const written = focusState(progress).written;
  const planted = [];
  let queuePos = 0;
  for (const char of order) {
    if (written[char]) continue; // already had its first pass; not in the queue
    if (!progress.characters[char]) {
      const dayOffset = Math.floor(queuePos / FOCUS_DAILY_COUNT);
      progress.characters[char] = {
        box: FOCUS_SEED_BOX,
        nextDue: addDaysToLocalDateString(todayStr, dayOffset),
        timesSeen: 1,
        timesCorrect: 0,
        dateLearned: todayStr,
        source: "focus",
      };
      planted.push(char);
    }
    queuePos += 1;
  }
  return planted;
}

// Called once at app start with the current focus.json: plants any new focus
// characters and records whether focus mode is on. The flag is what makes
// scheduler.pickTodaysNewCharacters stand down (one gate for the character
// room, the garden panda, and Parent Corner alike); it's re-derived from the
// data file on every start, so an emptied list turns rank-order new
// characters back on by itself. Returns true if progress changed.
export function applyFocusMode(progress, order, todayStr) {
  const focus = focusState(progress);
  const active = isFocusActive(order);
  const changed = focus.active !== active;
  focus.active = active;
  const planted = active ? seedFocusCharacters(progress, order, todayStr) : [];
  return changed || planted.length > 0;
}

// How much a written focus character needs another look, for the days the
// first-pass queue is empty: overdue first, then shaky, then lowest box.
function reviewNeed(state, todayStr) {
  let need = 0;
  if (state.nextDue <= todayStr) need += 100;
  if (state.shaky) need += 50;
  need += (6 - (state.box || 1)) * 5;
  return need;
}

// Today's focus characters. The pick is made once per day and stored, so
// leaving the room halfway and coming back continues the same 3 instead of
// moving on. Resting characters are skipped (they come back through the
// rest reintro instead).
export function pickTodaysFocus(progress, order, todayStr, count = FOCUS_DAILY_COUNT) {
  const focus = focusState(progress);
  if (focus.day && focus.day.date === todayStr && Array.isArray(focus.day.chars)) {
    return focus.day.chars;
  }

  const available = order.filter((char) => progress.characters[char] && !isResting(progress.characters[char], todayStr));
  const picks = available.filter((char) => !focus.written[char]).slice(0, count);

  if (picks.length < count) {
    const review = available
      .filter((char) => focus.written[char] && !picks.includes(char))
      .map((char, i) => ({ char, i, need: reviewNeed(progress.characters[char], todayStr) }))
      .sort((a, b) => b.need - a.need || a.i - b.i) // ties keep list priority
      .map((x) => x.char);
    picks.push(...review.slice(0, count - picks.length));
  }

  focus.day = { date: todayStr, chars: picks };
  return picks;
}

// The part of today's pick she hasn't written yet today.
export function remainingFocusToday(progress, order, todayStr) {
  const written = focusState(progress).written;
  return pickTodaysFocus(progress, order, todayStr).filter((char) => written[char] !== todayStr);
}

export function markFocusWritten(progress, char, todayStr) {
  focusState(progress).written[char] = todayStr;
}

// Splits `count` picks between the focus list and everything else: about
// half from each, with either side topping up the other when it runs short.
// `pickFrom(pool, n)` does the actual (weighted) sampling, so each caller
// keeps its own weighting rules.
export function splitFocusPicks(entries, focusSet, count, pickFrom) {
  const focusPool = entries.filter((e) => focusSet.has(e.char));
  const otherPool = entries.filter((e) => !focusSet.has(e.char));
  const wantFocus = Math.ceil(count / 2);
  const fromFocus = pickFrom(focusPool, Math.min(wantFocus, focusPool.length));
  const fromOther = pickFrom(otherPool, Math.min(count - fromFocus.length, otherPool.length));
  const shortfall = count - fromFocus.length - fromOther.length;
  if (shortfall > 0) {
    const taken = new Set([...fromFocus, ...fromOther].map((x) => (typeof x === "string" ? x : x.char)));
    const leftover = focusPool.filter((e) => !taken.has(e.char));
    fromFocus.push(...pickFrom(leftover, Math.min(shortfall, leftover.length)));
  }
  return [...fromFocus, ...fromOther];
}
