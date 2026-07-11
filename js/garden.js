// Garden-screen presentation: panda mascot state, the streak calendar, and
// the card-detail popup shown when tapping a plant. Kept separate from
// app.js so session.js can also drive the panda/calendar during
// celebration without a circular import back into app.js.

import { todayLocalDateString } from "./progress.js";
import { buildDueQueue, pickTodaysNewCharacter } from "./scheduler.js";
import { playLine } from "./audio.js";
import { animateCharacterOnce } from "./strokes.js";

// ---------- panda mascot ----------

export function updatePandaIdleOrSleep(progress, charMap) {
  const face = document.getElementById("panda-face");
  const today = todayLocalDateString();

  const dueChars = buildDueQueue(progress, today, 8);
  const newChar = pickTodaysNewCharacter(progress, Array.from(charMap.values()), today);
  const nothingToDoToday = dueChars.length === 0 && !newChar;

  face.classList.remove("cheer", "sleep");
  if (nothingToDoToday) {
    face.classList.add("sleep");
    face.textContent = "🐼";
  } else {
    face.textContent = "🐼";
  }
}

export function setPandaCheering(isCheering) {
  const face = document.getElementById("panda-face");
  face.classList.remove("sleep");
  face.classList.toggle("cheer", isCheering);
}

// ---------- confetti ----------

const CONFETTI_COLORS = ["#4caf50", "#ffb300", "#ff8a80", "#64b5f6", "#ba68c8"];

// A lightweight, dependency-free confetti burst for the celebration screen.
// Pieces are removed from the DOM once their fall animation ends, so
// repeated celebrations never leak leftover elements.
export function triggerConfetti() {
  const container = document.createElement("div");
  container.className = "confetti-container";
  document.body.appendChild(container);

  const pieceCount = 40;
  for (let i = 0; i < pieceCount; i++) {
    const piece = document.createElement("div");
    piece.className = "confetti-piece";
    piece.style.left = `${Math.random() * 100}%`;
    piece.style.backgroundColor = CONFETTI_COLORS[i % CONFETTI_COLORS.length];
    piece.style.animationDelay = `${Math.random() * 0.4}s`;
    piece.style.animationDuration = `${1.8 + Math.random() * 1.2}s`;
    container.appendChild(piece);
  }

  setTimeout(() => container.remove(), 3200);
}

// ---------- streak calendar ----------

// Renders the current calendar month as a grid of day squares. Days with a
// completed session get a red 印 stamp; today's square is outlined so she
// can find "now" even without reading the numbers.
export function renderStreakCalendar(progress) {
  const container = document.getElementById("streak-calendar");
  const today = new Date();
  const year = today.getFullYear();
  const month = today.getMonth();
  const todayStr = todayLocalDateString();

  const firstOfMonth = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const startWeekday = firstOfMonth.getDay();

  const cells = [];
  for (let i = 0; i < startWeekday; i++) {
    cells.push(`<div class="streak-cell empty"></div>`);
  }
  for (let day = 1; day <= daysInMonth; day++) {
    const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const stamped = Boolean(progress.streakCalendar[dateStr]);
    const isToday = dateStr === todayStr;
    cells.push(`
      <div class="streak-cell${isToday ? " today" : ""}" data-date="${dateStr}">
        <span class="streak-day-num">${day}</span>
        ${stamped ? '<span class="streak-stamp">印</span>' : ""}
      </div>
    `);
  }

  container.innerHTML = `<div class="streak-grid">${cells.join("")}</div>`;
}

// Called right when today's session completes, so the stamp visibly
// "lands" rather than just appearing on the next render.
export function animateTodayStamp(progress) {
  renderStreakCalendar(progress);
  const todayStr = todayLocalDateString();
  const cell = document.querySelector(`.streak-cell[data-date="${todayStr}"]`);
  const stamp = cell?.querySelector(".streak-stamp");
  if (stamp) {
    stamp.classList.add("stamp-land");
  }
}

// ---------- card detail popup ----------

// `withReplay` adds a button that replays the stroke-order animation —
// used by the card collection screen (卡片册); the garden's plant tiles
// use the plain version without it.
export function showCardModal(char, charMap, { withReplay = false } = {}) {
  const entry = charMap.get(char);
  const overlay = document.getElementById("card-modal");
  const content = document.getElementById("card-modal-content");

  content.innerHTML = `
    <div class="big-emoji" id="card-modal-emoji">${entry.emoji}</div>
    <div class="big-character">${entry.char}</div>
    <p class="card-pinyin">${entry.pinyin} · ${entry.word}</p>
    ${withReplay ? `<button class="replay-button" type="button" id="btn-replay-stroke" aria-label="再看一次笔顺">▶️</button>` : ""}
  `;
  overlay.classList.remove("hidden");
  playLine(`char_${char}`);

  if (withReplay) {
    document.getElementById("btn-replay-stroke").addEventListener("click", () => {
      const emojiEl = document.getElementById("card-modal-emoji");
      emojiEl.outerHTML = `<div class="writer-target" id="card-modal-writer"></div>`;
      animateCharacterOnce(document.getElementById("card-modal-writer"), char, { speed: 0.6 });
    });
  }
}

export function hideCardModal() {
  document.getElementById("card-modal").classList.add("hidden");
}
