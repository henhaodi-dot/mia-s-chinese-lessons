// Unit tests for js/focus.js — the daily 重点字 pick. The rules worth
// pinning down: the pick is stable within a day, the first-pass queue
// follows list priority (newest batch first), and once the queue is empty
// the slots go to the focus characters that most need review.

import {
  focusOrder,
  seedFocusCharacters,
  pickTodaysFocus,
  remainingFocusToday,
  markFocusWritten,
  splitFocusPicks,
  FOCUS_SEED_BOX,
} from "../js/focus.js";

const TODAY = "2026-10-19";

function charMapOf(chars) {
  return new Map(Array.from(chars).map((c, i) => [c, { char: c, rank: i + 1 }]));
}

function makeProgress(characters = {}) {
  return { settings: {}, characters, sessionLog: [] };
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

function eq(a, b, message) {
  const ja = JSON.stringify(a);
  const jb = JSON.stringify(b);
  if (ja !== jb) throw new Error(`${message || "not equal"}: ${ja} !== ${jb}`);
}

test("focusOrder: newest batch first, repeats and unknown characters dropped", () => {
  const map = charMapOf("一二三四五");
  const order = focusOrder({ batches: [{ chars: "五四" }, { chars: "一二四龘三" }] }, map);
  eq(order, ["五", "四", "一", "二", "三"]);
});

test("focusOrder: missing or empty data means focus mode is off", () => {
  eq(focusOrder(null, charMapOf("一")), []);
  eq(focusOrder({ batches: [] }, charMapOf("一")), []);
});

test("seed: plants missing characters, staggered 3 per day in queue order", () => {
  const p = makeProgress();
  const planted = seedFocusCharacters(p, Array.from("一二三四五六七"), TODAY);
  eq(planted, Array.from("一二三四五六七"));
  eq(p.characters["一"].nextDue, "2026-10-19");
  eq(p.characters["三"].nextDue, "2026-10-19");
  eq(p.characters["四"].nextDue, "2026-10-20");
  eq(p.characters["七"].nextDue, "2026-10-21");
  eq(p.characters["一"].box, FOCUS_SEED_BOX);
  eq(p.characters["一"].source, "focus");
});

test("seed: a character already in the garden keeps its progress untouched", () => {
  const existing = { box: 5, nextDue: "2026-11-30", timesSeen: 9, timesCorrect: 9, dateLearned: "2026-01-01", source: "daily" };
  const p = makeProgress({ 二: { ...existing } });
  seedFocusCharacters(p, Array.from("一二三四"), TODAY);
  eq(p.characters["二"], existing);
  // It still holds its queue slot, so 四 lands on the second day.
  eq(p.characters["四"].nextDue, "2026-10-20");
});

test("pick: first 3 unwritten characters in list order", () => {
  const p = makeProgress();
  const order = Array.from("一二三四五");
  seedFocusCharacters(p, order, TODAY);
  eq(pickTodaysFocus(p, order, TODAY), ["一", "二", "三"]);
});

test("pick: stable within the day even after some are written", () => {
  const p = makeProgress();
  const order = Array.from("一二三四五");
  seedFocusCharacters(p, order, TODAY);
  pickTodaysFocus(p, order, TODAY);
  markFocusWritten(p, "一", TODAY);
  eq(pickTodaysFocus(p, order, TODAY), ["一", "二", "三"]);
  eq(remainingFocusToday(p, order, TODAY), ["二", "三"]);
});

test("pick: next day moves on, and a leftover from yesterday comes first", () => {
  const p = makeProgress();
  const order = Array.from("一二三四五六");
  seedFocusCharacters(p, order, TODAY);
  pickTodaysFocus(p, order, TODAY);
  markFocusWritten(p, "一", TODAY);
  markFocusWritten(p, "二", TODAY); // 三 left unwritten
  eq(pickTodaysFocus(p, order, "2026-10-20"), ["三", "四", "五"]);
});

test("pick: a newly added batch at the front jumps the queue", () => {
  const p = makeProgress();
  let order = Array.from("一二三四五六");
  seedFocusCharacters(p, order, TODAY);
  pickTodaysFocus(p, order, TODAY);
  for (const c of "一二三") markFocusWritten(p, c, TODAY);
  order = Array.from("七八一二三四五六"); // this week's school characters added first
  seedFocusCharacters(p, order, "2026-10-20");
  eq(pickTodaysFocus(p, order, "2026-10-20"), ["七", "八", "四"]);
});

test("pick: once all are written, slots go to the ones most in need of review", () => {
  const p = makeProgress();
  const order = Array.from("一二三四");
  seedFocusCharacters(p, order, TODAY);
  for (const c of order) markFocusWritten(p, c, TODAY);
  p.characters["一"].nextDue = "2026-12-01";
  p.characters["一"].box = 4;
  p.characters["二"].nextDue = "2026-12-01";
  p.characters["二"].shaky = true;
  p.characters["三"].nextDue = "2026-10-20"; // due tomorrow
  p.characters["四"].nextDue = "2026-12-01";
  eq(pickTodaysFocus(p, order, "2026-10-20"), ["三", "二", "四"]);
});

test("pick: resting characters are skipped", () => {
  const p = makeProgress();
  const order = Array.from("一二三四");
  seedFocusCharacters(p, order, TODAY);
  p.characters["二"].restUntil = "2026-11-02";
  eq(pickTodaysFocus(p, order, TODAY), ["一", "三", "四"]);
});

test("split: about half from the focus list, the rest from other characters", () => {
  const entries = Array.from("一二三四五六七八九十").map((c) => ({ char: c }));
  const focusSet = new Set(Array.from("一二三四五"));
  const firstN = (pool, n) => pool.slice(0, n).map((e) => e.char);
  const picks = splitFocusPicks(entries, focusSet, 6, firstN);
  eq(picks.filter((c) => focusSet.has(c)).length, 3);
  eq(picks.length, 6);
});

test("split: focus tops up when there are too few other characters", () => {
  const entries = Array.from("一二三四五六").map((c) => ({ char: c }));
  const focusSet = new Set(Array.from("一二三四五"));
  const firstN = (pool, n) => pool.slice(0, n).map((e) => e.char);
  const picks = splitFocusPicks(entries, focusSet, 6, firstN);
  eq(picks.length, 6);
  assert(new Set(picks).size === 6, "no duplicates");
});

export function runAll() {
  return results;
}
