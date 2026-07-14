// Unit tests for js/reviewRules.js — the asymmetry that protects the
// schedule: a not-due success must never touch box or nextDue, no matter
// what. Run via tests/run-tests.html (no build step, no test framework —
// consistent with the rest of this project).

import {
  applyGardenTapOutcome,
  applyDueSuccess,
  applyNotDueSuccess,
  applyStruggle,
  HEART_DAILY_CAP,
  VISITOR_THRESHOLDS,
} from "../js/reviewRules.js";

function makeCharState(overrides = {}) {
  return {
    box: 2,
    nextDue: "2026-07-10",
    timesSeen: 5,
    timesCorrect: 3,
    dateLearned: "2026-06-01",
    source: "daily",
    ...overrides,
  };
}

const results = [];

function test(name, fn) {
  try {
    fn();
    results.push({ name, pass: true });
  } catch (err) {
    results.push({ name, pass: false, error: err.message });
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message || "assertion failed");
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`${message || "values differ"}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

const TODAY = "2026-07-14";

// ---------- Rule 1: due success grows the box ----------

test("due success advances box by 1", () => {
  const state = makeCharState({ box: 2 });
  const result = applyDueSuccess(state, TODAY);
  assertEqual(state.box, 3, "box");
  assertEqual(result.outcome, "grew", "outcome");
});

test("due success reschedules nextDue into the future", () => {
  const state = makeCharState({ box: 2, nextDue: "2026-07-10" });
  applyDueSuccess(state, TODAY);
  assert(state.nextDue > TODAY, "nextDue should move past today");
});

test("due success via the single entry point matches applyDueSuccess", () => {
  const state = makeCharState({ box: 1 });
  const result = applyGardenTapOutcome(state, { isDue: true, struggled: false }, TODAY);
  assertEqual(state.box, 2, "box");
  assertEqual(result.outcome, "grew", "outcome");
});

// ---------- Rule 2: not-due success never touches box or nextDue ----------

test("not-due success does NOT change box", () => {
  const state = makeCharState({ box: 3, nextDue: "2026-08-01" });
  applyNotDueSuccess(state, TODAY);
  assertEqual(state.box, 3, "box must be untouched");
});

test("not-due success does NOT change nextDue", () => {
  const state = makeCharState({ box: 3, nextDue: "2026-08-01" });
  applyNotDueSuccess(state, TODAY);
  assertEqual(state.nextDue, "2026-08-01", "nextDue must be untouched");
});

test("not-due success adds a heart and reports outcome 'heart'", () => {
  const state = makeCharState({ hearts: 0 });
  const result = applyNotDueSuccess(state, TODAY);
  assertEqual(state.hearts, 1, "hearts");
  assertEqual(result.outcome, "heart", "outcome");
});

test("not-due success via the single entry point never touches box/nextDue either", () => {
  const state = makeCharState({ box: 4, nextDue: "2026-09-01" });
  const result = applyGardenTapOutcome(state, { isDue: false, struggled: false }, TODAY);
  assertEqual(state.box, 4, "box");
  assertEqual(state.nextDue, "2026-09-01", "nextDue");
  assertEqual(result.outcome, "heart", "outcome");
});

test(`hearts cap at ${HEART_DAILY_CAP} per day, then report 'content'`, () => {
  const state = makeCharState({ hearts: 0 });
  for (let i = 0; i < HEART_DAILY_CAP; i++) applyNotDueSuccess(state, TODAY);
  assertEqual(state.hearts, HEART_DAILY_CAP, "hearts should stop at the cap");
  const capped = applyNotDueSuccess(state, TODAY);
  assertEqual(capped.outcome, "content", "outcome at cap");
  assertEqual(state.hearts, HEART_DAILY_CAP, "hearts must not exceed the cap");
});

test("heartsToday resets on a new local date, freeing up the cap again", () => {
  const state = makeCharState({ hearts: 0 });
  for (let i = 0; i < HEART_DAILY_CAP; i++) applyNotDueSuccess(state, TODAY);
  const tomorrow = "2026-07-15";
  const result = applyNotDueSuccess(state, tomorrow);
  assertEqual(result.outcome, "heart", "a new day should allow another heart");
  assertEqual(state.hearts, HEART_DAILY_CAP + 1, "hearts");
});

test("visitor unlocks fire exactly once, at the right cumulative-heart threshold", () => {
  const state = makeCharState({ hearts: VISITOR_THRESHOLDS[0].hearts - 1 });
  const result = applyNotDueSuccess(state, TODAY);
  assert(result.newVisitors.includes(VISITOR_THRESHOLDS[0].id), "should unlock the first visitor");
  assertEqual(state.visitors.length, 1, "visitors array");

  // Crossing the same threshold again on a later day must not re-unlock it.
  const later = applyNotDueSuccess(state, "2026-07-15");
  assertEqual(later.newVisitors.length, 0, "no duplicate unlock");
});

// ---------- Rule 3: struggle never demotes, always due tomorrow, always shaky ----------

test("struggle on a due plant does NOT demote the box", () => {
  const state = makeCharState({ box: 3 });
  applyStruggle(state, TODAY);
  assertEqual(state.box, 3, "box must never be demoted by a garden-tap struggle");
});

test("struggle schedules the plant due tomorrow", () => {
  const state = makeCharState({ nextDue: "2026-09-01" });
  applyStruggle(state, TODAY);
  assertEqual(state.nextDue, "2026-07-15", "nextDue should be exactly tomorrow");
});

test("struggle marks the plant shaky", () => {
  const state = makeCharState({});
  applyStruggle(state, TODAY);
  assertEqual(state.shaky, true, "shaky");
});

test("struggle on a NOT-due plant still doesn't touch box, still goes to tomorrow", () => {
  const state = makeCharState({ box: 2, nextDue: "2026-12-01" });
  const result = applyGardenTapOutcome(state, { isDue: false, struggled: true }, TODAY);
  assertEqual(state.box, 2, "box");
  assertEqual(state.nextDue, "2026-07-15", "nextDue");
  assertEqual(result.outcome, "struggled", "outcome");
});

test("struggle takes priority over isDue in the single entry point", () => {
  const state = makeCharState({ box: 5, nextDue: "2026-07-10" });
  const result = applyGardenTapOutcome(state, { isDue: true, struggled: true }, TODAY);
  assertEqual(state.box, 5, "box must not grow when she struggled, even if it was due");
  assertEqual(result.outcome, "struggled", "outcome");
});

export function runAll() {
  return results;
}
