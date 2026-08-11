// App entry point: wires up the garden screen, screen navigation, and
// kicks off a daily session when the start button is tapped.

import { loadCharacterMap } from "./data.js";
import { loadProgress, saveProgress, todayLocalDateString } from "./progress.js";
import { growthStageFor, isDue } from "./scheduler.js";
import { unlockAudio } from "./audio.js";
import {
  updatePandaIdleOrSleep,
  renderStreakCalendar,
  showCardModal,
  hideCardModal,
  STAGE_EMOJI,
  VISITOR_EMOJI,
  gesturePandaTowardThirsty,
  charPictureHtml,
} from "./garden.js";
import { generateGateQuestion, checkGateAnswer, renderParentContent } from "./parent.js";
import { runSpeakingRoom } from "./speaking.js";
import { runCharacterRoom } from "./characterRoom.js";
import { runStoryMode } from "./storyMode.js";
import { runGardenTapReview } from "./gardenReview.js";
import { checkForUpdate } from "./updateCheck.js";
import { getHeartsToday, HEART_DAILY_CAP } from "./reviewRules.js";
import { isResting, processWakeups } from "./rest.js";

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

// Thirsty-plant count on the 认认字 door — the gentle pull toward review.
// No equivalent on 说说话 (that door is for fun, not a counter). Recomputed
// whenever the garden re-renders, so popping back from a review updates it.
function renderThirstyBadge() {
  const badge = document.getElementById("character-thirsty-badge");
  if (!badge) return;
  const today = todayLocalDateString();
  const dueCount = Object.values(progress.characters).filter((state) => isDue(state, today)).length;
  if (dueCount > 0) {
    badge.textContent = String(dueCount);
    badge.classList.remove("hidden");
  } else {
    badge.classList.add("hidden");
  }
}

function renderGardenGrid() {
  const grid = document.getElementById("garden-grid");
  grid.innerHTML = "";
  renderThirstyBadge();

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
    const resting = isResting(state, today);
    const due = isDue(state, today) && !resting; // resting plants don't ask to be watered
    const heartsToday = getHeartsToday(state, today);
    const visitors = state.visitors || [];

    const tile = document.createElement("button");
    tile.type = "button";
    tile.className = "plant-tile" + (due ? " due shimmer" : "") + (resting ? " resting" : "");
    tile.innerHTML = `
      <span class="plant-emoji">${STAGE_EMOJI[stage]}</span>
      <span class="plant-char">${char}</span>
      ${resting ? `<span class="plant-pillow" aria-label="休息中">💤</span>` : ""}
      ${
        !resting && heartsToday > 0
          ? `<span class="plant-hearts">${"❤️".repeat(heartsToday)}${"🤍".repeat(HEART_DAILY_CAP - heartsToday)}</span>`
          : ""
      }
      ${
        visitors.length > 0
          ? `<span class="plant-visitors">${visitors.map((id) => VISITOR_EMOJI[id] || "").join("")}</span>`
          : ""
      }
    `;
    tile.addEventListener("click", () => handlePlantTap(char));
    grid.appendChild(tile);
  }
}

async function handlePlantTap(char) {
  await unlockAudio();
  // A resting plant isn't reviewed — just show its card so she can still
  // visit it (and the parent knows why it's asleep).
  if (isResting(progress.characters[char], todayLocalDateString())) {
    showCardModal(char, charMap, { withReplay: true });
    return;
  }
  const outcome = await runGardenTapReview(char, charMap, progress);
  renderGardenGrid();
  renderStreakCalendar(progress);
  updatePandaIdleOrSleep(progress, charMap);
  if (outcome === "content") {
    gesturePandaTowardThirsty(progress, todayLocalDateString());
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

  // Wake any characters whose two-week rest has ended, so the garden and
  // review pool reflect it immediately (the gentle reintro itself happens
  // when she next enters the character room).
  if (processWakeups(progress, todayLocalDateString()).length > 0) {
    saveProgress(progress);
  }

  renderGardenGrid();
  renderStreakCalendar(progress);
  updatePandaIdleOrSleep(progress, charMap);

  // 说说话 — the speaking room (built). 认认字 — placeholder until its step.
  document.getElementById("btn-speaking").addEventListener("click", async () => {
    await unlockAudio();
    await runSpeakingRoom(progress, charMap);
    renderGardenGrid();
    renderStreakCalendar(progress);
    updatePandaIdleOrSleep(progress, charMap);
  });

  document.getElementById("btn-character").addEventListener("click", async () => {
    await unlockAudio();
    await runCharacterRoom(progress, charMap);
    renderGardenGrid();
    renderStreakCalendar(progress);
    updatePandaIdleOrSleep(progress, charMap);
  });

  document.getElementById("btn-story").addEventListener("click", async () => {
    await unlockAudio();
    await runStoryMode(progress, charMap);
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
