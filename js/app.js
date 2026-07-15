// App entry point: wires up the garden screen, screen navigation, and
// kicks off a daily session when the start button is tapped.

import { loadCharacterMap } from "./data.js";
import { loadProgress, todayLocalDateString } from "./progress.js";
import { growthStageFor, isDue } from "./scheduler.js";
import { unlockAudio } from "./audio.js";
import { runDailySession } from "./session.js";
import { updatePandaIdleOrSleep, renderStreakCalendar, showCardModal, hideCardModal } from "./garden.js";
import { generateGateQuestion, checkGateAnswer, renderParentContent } from "./parent.js";
import { runPaperMode } from "./paper.js";
import { runGardenTapReview } from "./gardenReview.js";
import { checkForUpdate } from "./updateCheck.js";

// Placeholder growth-stage visuals — replaced with real garden illustrations
// in the "garden home screen" build step. Stage 0 is the same-day seed
// cosmetic described in scheduler.js.
const STAGE_EMOJI = ["🌰", "🌱", "🌿", "🌷", "🌸", "🌟"];

let progress;
let charMap;

function showScreen(id) {
  document.querySelectorAll(".screen").forEach((s) => s.classList.add("hidden"));
  document.getElementById(id).classList.remove("hidden");
}

// This is a single-page app, so without this, the tablet's physical/gesture
// back button has no in-app "screen" to return from — one tap exits
// straight out to Silk's own home page. Pushing a history entry whenever we
// leave the garden means back instead returns to the garden, like a normal
// app's back button would.
function showScreenWithBackSupport(id) {
  history.pushState({ hanziGardenScreen: id }, "");
  showScreen(id);
}

window.addEventListener("popstate", () => {
  hideCardModal();
  showScreen("screen-garden");
});

function renderGardenGrid() {
  const grid = document.getElementById("garden-grid");
  grid.innerHTML = "";

  const today = todayLocalDateString();
  const learned = Object.entries(progress.characters).sort(
    (a, b) => charMap.get(a[0]).rank - charMap.get(b[0]).rank
  );

  if (learned.length === 0) {
    grid.innerHTML = `<p class="empty-state-message" style="grid-column: 1 / -1;">
      点击下面的按钮，种下第一颗种子吧！
    </p>`;
    return;
  }

  for (const [char, state] of learned) {
    const entry = charMap.get(char);
    const stage = growthStageFor(state, today);
    const due = isDue(state, today);

    const tile = document.createElement("button");
    tile.type = "button";
    tile.className = "plant-tile" + (due ? " due" : "");
    tile.innerHTML = `
      <span class="plant-emoji">${STAGE_EMOJI[stage]}</span>
      <span class="plant-char">${char}</span>
    `;
    tile.addEventListener("click", () => handlePlantTap(char));
    grid.appendChild(tile);
  }
}

async function handlePlantTap(char) {
  await unlockAudio();
  await runGardenTapReview(char, charMap, progress);
  renderGardenGrid();
  renderStreakCalendar(progress);
  updatePandaIdleOrSleep(progress, charMap);
}

function renderCardGrid() {
  const grid = document.getElementById("card-grid");
  grid.innerHTML = "";

  const learned = Object.entries(progress.characters).sort(
    (a, b) => (b[1].dateLearned > a[1].dateLearned ? 1 : -1) // newest first
  );

  document.getElementById("card-count-badge").textContent = `(${learned.length})`;

  if (learned.length === 0) {
    grid.innerHTML = `<p class="empty-state-message">还没有卡片，快去浇水时间种一颗种子吧！</p>`;
    return;
  }

  for (const [char, state] of learned) {
    const entry = charMap.get(char);
    const card = document.createElement("button");
    card.type = "button";
    card.className = "hanzi-card" + (state.box === 5 ? " golden" : "");
    card.innerHTML = `
      <span class="card-char">${char}</span>
      <span style="font-size:24px">${entry.emoji}</span>
      <span class="card-pinyin">${entry.pinyin}</span>
      <span class="card-pinyin">${entry.word}</span>
    `;
    card.addEventListener("click", () => showCardModal(char, charMap, { withReplay: true }));
    grid.appendChild(card);
  }
}

async function handleStartSession() {
  await unlockAudio();
  history.pushState({ hanziGardenScreen: "screen-session" }, "");
  const btn = document.getElementById("btn-start-session");
  btn.disabled = true;
  try {
    await runDailySession(progress);
  } finally {
    btn.disabled = false;
    renderGardenGrid();
    renderStreakCalendar(progress);
    updatePandaIdleOrSleep(progress, charMap);
  }
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  // file:// and other non-http(s) origins can't register a service worker;
  // fail quietly rather than logging a scary error for local testing.
  if (location.protocol !== "http:" && location.protocol !== "https:") return;
  navigator.serviceWorker.register("./sw.js").catch((err) => {
    console.warn("Service worker registration failed:", err);
  });
}

async function main() {
  registerServiceWorker();
  checkForUpdate(); // fire-and-forget — reloads the page itself if a new deploy exists

  // Silk requires a user gesture before any audio will play. Rather than
  // remembering to call unlockAudio() from every button that might play a
  // sound first (a plant tile, a card, the paper-mode icon...), unlock on
  // the very first tap anywhere — unlockAudio() is a no-op once unlocked.
  document.addEventListener("click", () => unlockAudio(), { capture: true });

  charMap = await loadCharacterMap();
  progress = loadProgress();

  renderGardenGrid();
  renderStreakCalendar(progress);
  updatePandaIdleOrSleep(progress, charMap);

  document.getElementById("btn-start-session").addEventListener("click", handleStartSession);

  document.getElementById("btn-cards").addEventListener("click", () => {
    renderCardGrid();
    showScreenWithBackSupport("screen-cards");
  });
  document.getElementById("btn-cards-back").addEventListener("click", () => history.back());

  document.getElementById("btn-paper").addEventListener("click", async () => {
    await unlockAudio();
    history.pushState({ hanziGardenScreen: "screen-paper" }, "");
    await runPaperMode(progress, charMap);
    renderGardenGrid();
    renderStreakCalendar(progress);
    updatePandaIdleOrSleep(progress, charMap);
  });

  document.getElementById("btn-parent").addEventListener("click", () => {
    document.getElementById("parent-gate").classList.remove("hidden");
    document.getElementById("parent-content").classList.add("hidden");
    generateGateQuestion();
    showScreenWithBackSupport("screen-parent");
  });
  document.getElementById("btn-parent-back").addEventListener("click", () => history.back());

  const handleGateSubmit = () => {
    if (checkGateAnswer()) {
      document.getElementById("parent-gate").classList.add("hidden");
      document.getElementById("parent-content").classList.remove("hidden");
      renderParentContent(progress, charMap, () => {
        renderGardenGrid();
        renderStreakCalendar(progress);
        updatePandaIdleOrSleep(progress, charMap);
      });
    }
  };
  document.getElementById("parent-gate-submit").addEventListener("click", handleGateSubmit);
  document.getElementById("parent-gate-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter") handleGateSubmit();
  });

  document.getElementById("btn-card-modal-close").addEventListener("click", () => history.back());
  document.getElementById("card-modal").addEventListener("click", (e) => {
    if (e.target.id === "card-modal") history.back();
  });
}

main();
