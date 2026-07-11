// Picks "this week's characters" — shared between in-app paper mode and
// the print worksheet page's default character picker.

import { todayLocalDateString } from "./progress.js";

function startOfWeek(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  const day = date.getDay(); // 0 = Sunday, 1 = Monday, ...
  const diffToMonday = day === 0 ? -6 : 1 - day;
  date.setDate(date.getDate() + diffToMonday);
  return todayLocalDateString(date);
}

// Returns character entries (from characters.json), sorted by rank.
// Prefers characters learned this calendar week (Monday-start); if none
// were learned this week (a quiet week, or she's paused), falls back to
// the 7 most recently learned characters so there's always something to
// pick up a pencil for.
export function getThisWeeksCharacters(progress, charMap) {
  const today = todayLocalDateString();
  const weekStart = startOfWeek(today);

  let chars = Object.entries(progress.characters)
    .filter(([, state]) => state.dateLearned >= weekStart)
    .map(([char]) => char);

  if (chars.length === 0) {
    chars = Object.entries(progress.characters)
      .sort((a, b) => (b[1].dateLearned > a[1].dateLearned ? 1 : a[1].dateLearned < b[1].dateLearned ? -1 : 0))
      .slice(0, 7)
      .map(([char]) => char);
  }

  return chars
    .map((char) => charMap.get(char))
    .filter(Boolean)
    .sort((a, b) => a.rank - b.rank);
}
