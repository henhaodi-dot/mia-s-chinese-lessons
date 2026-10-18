// App entry point: wires up the garden screen, screen navigation, and the
// three room doors. Rooms are async "runs" (see nav.js): app.js opens one at
// a time, refreshes the garden when it ends, and — from the popstate handler
// — aborts it when the tablet's back button or a room's 🏠 button is used.

import { loadCharacterMap } from "./data.js";
import { loadProgress, saveProgress, todayLocalDateString } from "./progress.js";
import { growthStageFor, isDue } from "./scheduler.js";
import { unlockAudio, stopAudio } from "./audio.js";
import { stopBlobPlayback } from "./recorder.js";
import { stopStoryAudio } from "./storyMode.js";
import {
  updatePandaIdleOrSleep,
  renderStreakCalendar,
  showCardModal,
  hideCardModal,
  STAGE_EMOJI,
  VISITOR_EMOJI,
  gesturePandaTowardThirsty,
} from "./garden.js";
import { generateGateQuestion, checkGateAnswer, renderParentContent } from "./parent.js";
import { runSpeakingRoom } from "./speaking.js";
import { runCharacterRoom } from "./characterRoom.js";
import { runStoryMode } from "./storyMode.js";
import { runGardenTapReview } from "./gardenReview.js";
import { checkForUpdate } from "./updateCheck.js";
import { getHeartsToday, HEART_DAILY_CAP } from "./reviewRules.js";
import { isResting, processWakeups } from "./rest.js";
import { RunAborted, abortRun, currentRunId } from "./nav.js";

let progress;
let charMap;

// True while a room (or a garden tap review) is open. A second door tap
// while one is opening used to start a second room on top of the first —
// two flows rendering into the same screens at once.
let roomBusy = false;
// Bumped whenever a room is torn down from outside (popstate), so a room's
// own late `finally` can tell it no longer owns roomBusy. Without it, an old
// room unwinding after a new one opened cleared the flag, and a door tap
// could start a second room on top of the open one.
let roomGen = 0;

function showScreen(id) {
  document.querySelectorAll(".screen").forEach((s) => s.classList.add("hidden"));
  document.getElementById(id).classList.remove("hidden");
}

// Silence everything a room might have left mid-play. Called whenever a run
// is torn down from outside (back button / 🏠).
function stopAllAudio() {
  stopAudio();
  stopBlobPlayback();
  stopStoryAudio();
}

function refreshGarden() {
  renderGardenGrid();
  renderStreakCalendar(progress);
  updatePandaIdleOrSleep(progress, charMap);
}

// Back-button handling. This is a single-page app, so every room pushes a
// history entry when it opens (nav.js enterScreen) and the card modal pushes
// one of its own; `popstate` fires when one of those is popped. `e.state`
// is the entry we're arriving AT:
//   - arriving at a room entry whose run is still alive means only a card
//     modal (opened inside that room) was closed — keep the room;
//   - anything else means we're back at the garden: abort whatever room
//     was running, silence it, and show the garden.
window.addEventListener("popstate", (e) => {
  hideCardModal();
  const state = e.state || {};
  if (state.hanziGardenScreen && state.run !== undefined && state.run === currentRunId()) return;
  abortRun();
  stopAllAudio();
  roomGen += 1;
  roomBusy = false;
  showScreen("screen-garden");
  refreshGarden();
});

// Rooms and the tap review reject with RunAborted when left via back / 🏠 —
// that's a normal exit, not an error. Fire-and-forget audio calls that were
// in flight at that moment reject the same way.
window.addEventListener("unhandledrejection", (e) => {
  if (e.reason instanceof RunAborted) e.preventDefault();
});

// Opens one room at a time and always brings the garden back up to date
// afterwards — whether the room ended normally, was left via back / 🏠, or
// hit a real error (which is logged, but never leaves a dead screen up).
async function openRoom(runFn) {
  if (roomBusy) return null;
  roomBusy = true;
  const gen = roomGen;
  let result = null;
  try {
    // No await before runFn: the room's enterScreen must push its history
    // entry within this same tap, or a back press during the audio unlock
    // finds only the garden entry and leaves the app. (The unlock itself
    // was already started by the capture-phase click listener in main();
    // playLine waits for it.)
    result = await runFn();
  } catch (err) {
    if (!(err instanceof RunAborted)) console.error("Room failed:", err);
  } finally {
    if (gen === roomGen) roomBusy = false;
    refreshGarden();
  }
  return result;
}

// Thirsty-plant count on the 认认字 door — the gentle pull toward review.
// No equivalent on 说说话 (that door is for fun, not a counter). Recomputed
// whenever the garden re-renders, so popping back from a review updates it.
function renderThirstyBadge() {
  const badge = document.getElementById("character-thirsty-badge");
  if (!badge) return;
  const today = todayLocalDateString();
  const dueCount = Object.entries(progress.characters).filter(
    ([char, state]) => charMap.has(char) && isDue(state, today) && !isResting(state, today)
  ).length;
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
  // A saved character that isn't in characters.json (an edited curriculum,
  // a progress file from another version) is kept in storage but can't be
  // drawn — skip it rather than let one entry take the whole garden down.
  const learned = Object.entries(progress.characters)
    .filter(([char]) => charMap.has(char))
    .sort((a, b) => charMap.get(a[0]).rank - charMap.get(b[0]).rank);

  if (learned.length === 0) {
    grid.innerHTML = `<p class="empty-state-message" style="grid-column: 1 / -1;">
      点一点下面的门，种下第一颗种子吧！
    </p>`;
    return;
  }

  for (const [char, state] of learned) {
    const stage = growthStageFor(state, today);
    const resting = isResting(state, today);
    const due = isDue(state, today) && !resting; // resting plants don't ask to be watered
    const heartsToday = getHeartsToday(state, today);
    const visitors = state.visitors || [];

    const tile = document.createElement("button");
    tile.type = "button";
    tile.className = "plant-tile" + (due ? " due shimmer" : "") + (resting ? " resting" : "");
    tile.innerHTML = `
      <span class="plant-emoji">${STAGE_EMOJI[stage] ?? STAGE_EMOJI[1]}</span>
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
  if (roomBusy) return;
  // A resting plant isn't reviewed — just show its card so she can still
  // visit it (and the parent knows why it's asleep).
  if (isResting(progress.characters[char], todayLocalDateString())) {
    showCardModal(char, charMap, { withReplay: true });
    return;
  }
  const outcome = await openRoom(() => runGardenTapReview(char, charMap, progress));
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

// If the app can't even start (characters.json unreachable on a first-ever
// open with no connection, a broken deploy), say so in one friendly line
// with a retry — a blank garden used to be the only symptom.
function showStartupError(err) {
  console.error("Startup failed:", err);
  const garden = document.getElementById("screen-garden");
  const grid = document.getElementById("garden-grid");
  showScreen("screen-garden");
  if (grid) {
    grid.innerHTML = `
      <div class="startup-error" style="grid-column: 1 / -1;">
        <div class="big-emoji">🐼💤</div>
        <p>花园还没醒来，请检查网络后再试一次。</p>
        <button type="button" class="big-button" id="btn-startup-retry">再试一次</button>
      </div>
    `;
    grid.querySelector("#btn-startup-retry").addEventListener("click", () => location.reload());
  }
  garden.classList.remove("hidden");
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

  const unknown = Object.keys(progress.characters).filter((char) => !charMap.has(char));
  if (unknown.length > 0) {
    console.warn(`Saved progress has ${unknown.length} character(s) not in characters.json (kept, but hidden):`, unknown.join(""));
  }

  // Wake any characters whose two-week rest has ended, so the garden and
  // review pool reflect it immediately (the gentle reintro itself happens
  // when she next enters the character room).
  if (processWakeups(progress, todayLocalDateString()).length > 0) {
    saveProgress(progress);
  }

  refreshGarden();

  document.getElementById("btn-speaking").addEventListener("click", () => {
    openRoom(() => runSpeakingRoom(progress, charMap));
  });

  document.getElementById("btn-character").addEventListener("click", () => {
    openRoom(() => runCharacterRoom(progress, charMap));
  });

  document.getElementById("btn-story").addEventListener("click", () => {
    openRoom(() => runStoryMode(progress, charMap));
  });

  // Every room's 🏠 button behaves exactly like the tablet's back button:
  // pop the room's history entry, and let the popstate handler above do the
  // abort + return to the garden.
  document.querySelectorAll(".room-exit").forEach((btn) => {
    if (btn.dataset.exit === "history") btn.addEventListener("click", () => history.back());
  });

  document.getElementById("btn-parent").addEventListener("click", () => {
    if (roomBusy) return;
    document.getElementById("parent-gate").classList.remove("hidden");
    document.getElementById("parent-content").classList.add("hidden");
    generateGateQuestion();
    history.pushState({ hanziGardenScreen: "screen-parent" }, "");
    showScreen("screen-parent");
  });
  document.getElementById("btn-parent-back").addEventListener("click", () => history.back());

  const handleGateSubmit = () => {
    if (checkGateAnswer()) {
      document.getElementById("parent-gate").classList.add("hidden");
      document.getElementById("parent-content").classList.remove("hidden");
      renderParentContent(progress, charMap, refreshGarden);
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

main().catch(showStartupError);
