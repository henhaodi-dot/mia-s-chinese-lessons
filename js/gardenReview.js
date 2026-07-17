// Garden tap-to-review (v2.3): tapping any learned plant is now a real,
// low-stakes recall check — flash the character, write it from memory in a
// blank grid, then see the outcome. The outcome itself (grow / heart /
// content / struggle) is entirely decided by reviewRules.js; this module is
// just the interactive UI + audio wrapped around that decision.
//
// "Struggled" is derived here, not in reviewRules.js: a stroke counts as
// hinted once its mistake count hits the same showHintAfterMisses threshold
// used for the quiz itself (2, per spec). Success = at most 1 hinted stroke.

import { todayLocalDateString, saveProgress } from "./progress.js";
import { isDue } from "./scheduler.js";
import { playLine, pickVariant } from "./audio.js";
import { runWriteFromMemoryQuiz } from "./strokes.js";
import { applyGardenTapOutcome } from "./reviewRules.js";
import { VISITOR_EMOJI, charPictureHtml } from "./garden.js";

const HINT_THRESHOLD = 2;
const STRUGGLE_HINTED_STROKE_LIMIT = 1;

function el(html) {
  const template = document.createElement("template");
  template.innerHTML = html.trim();
  return template.content.firstElementChild;
}

function getOverlayElements() {
  return {
    overlay: document.getElementById("screen-garden-review"),
    container: document.getElementById("garden-review-content"),
  };
}

async function runWriteFromMemoryStep(container, char) {
  container.replaceChildren(el(`<div class="session-content"><div class="writer-target"></div></div>`));
  const target = container.querySelector(".writer-target");

  const hintedStrokes = new Set();
  await new Promise((resolve) => {
    runWriteFromMemoryQuiz(target, char, {
      showHintAfterMisses: HINT_THRESHOLD,
      onMistake: (data) => {
        if (data.mistakesOnStroke >= HINT_THRESHOLD) hintedStrokes.add(data.strokeNum);
      },
      onComplete: () => resolve(),
    });
  });

  return hintedStrokes.size > STRUGGLE_HINTED_STROKE_LIMIT;
}

async function showVisitorArrival(container, visitorId) {
  const emoji = VISITOR_EMOJI[visitorId];
  if (!emoji) return; // unknown id — skip gracefully rather than showing nothing useful
  container.replaceChildren(el(`
    <div class="session-content">
      <div class="big-emoji review-grow-pulse">${emoji}</div>
    </div>
  `));
  await playLine(`visitorArrival_${visitorId}`);
  await new Promise((r) => setTimeout(r, 800));
}

async function showOutcomeScreen(container, entry, outcomeResult) {
  await playLine(`word_${entry.char}`);

  if (outcomeResult.outcome === "grew") {
    container.replaceChildren(el(`
      <div class="session-content">
        <div class="big-emoji review-grow-pulse">${charPictureHtml(entry)}</div>
        <div class="big-character">${entry.char}</div>
      </div>
    `));
    await playLine(pickVariant("praise", 5));
  } else if (outcomeResult.outcome === "heart") {
    container.replaceChildren(el(`
      <div class="session-content">
        <div class="big-emoji review-heart-pulse">❤️</div>
        <div class="big-character">${entry.char}</div>
      </div>
    `));
    await playLine(pickVariant("heartPraise", 3));
    await new Promise((r) => setTimeout(r, 400));
    for (const visitorId of outcomeResult.newVisitors || []) {
      await showVisitorArrival(container, visitorId);
    }
    return;
  } else if (outcomeResult.outcome === "content") {
    container.replaceChildren(el(`
      <div class="session-content">
        <div class="big-emoji">${charPictureHtml(entry)}</div>
        <div class="big-character">${entry.char}</div>
      </div>
    `));
    await playLine("contentPlantLine");
  } else {
    container.replaceChildren(el(`
      <div class="session-content">
        <div class="big-emoji review-struggle-fade">💧</div>
        <div class="big-character">${entry.char}</div>
      </div>
    `));
    await playLine("gardenStruggleLine");
  }

  await new Promise((r) => setTimeout(r, 500));
}

// Returns the outcome ("grew" | "heart" | "content" | "struggled") so the
// caller can react afterward — e.g. gesturing the panda toward another
// thirsty plant when this one was already at its daily heart cap.
export async function runGardenTapReview(char, charMap, progress) {
  const entry = charMap.get(char);
  const state = progress.characters[char];
  if (!state) return null; // shouldn't happen — only learned plants are tappable

  const today = todayLocalDateString();
  const wasDue = isDue(state, today);

  const { overlay, container } = getOverlayElements();
  overlay.classList.remove("hidden");
  history.pushState({ hanziGardenScreen: "screen-garden-review" }, "");

  // 1. Flash the character + its sound, briefly.
  container.replaceChildren(el(`
    <div class="session-content">
      <div class="big-character">${entry.char}</div>
    </div>
  `));
  await playLine("gardenTapIntro");
  await playLine(`char_${char}`);
  await new Promise((r) => setTimeout(r, 700));

  // 2. Write it from memory.
  const struggled = await runWriteFromMemoryStep(container, char);

  // 3. Apply the core rule — the only place box/nextDue/hearts change.
  const outcomeResult = applyGardenTapOutcome(state, { isDue: wasDue, struggled }, today);
  saveProgress(progress);

  // 4. Completion beat.
  await showOutcomeScreen(container, entry, outcomeResult);

  overlay.classList.add("hidden");
  return outcomeResult.outcome;
}
