// Practice studio (写字时间, v2.3): zero-stakes 看/描/写 practice, replacing
// the old loop-only stroke viewer. The garden tests recall from memory —
// this studio never does. Nothing here touches box, hearts, or the review
// schedule; the only reward is an ink drop per completed 描/写, and a
// panda sticker when the bottle fills.

import {
  todayLocalDateString,
  saveProgress,
  awardSticker,
  getStickerCount,
  addInkDrop,
  getInkDrops,
  INK_BOTTLE_CAPACITY,
} from "./progress.js";
import { growthStageFor } from "./scheduler.js";
import { STAGE_EMOJI } from "./garden.js";
import { playLine, pickVariant } from "./audio.js";
import { animateCharacterOnce, traceWithHints, writeFromMemory } from "./strokes.js";
import { RunAborted, sleep, untilAborted } from "./nav.js";

const WATCH_SLOW_SPEED = 0.6;
const WATCH_FAST_SPEED = 1.2;
const COPY_HINT_AFTER_MISSES = 3; // generous — this is copying, not a test

function el(html) {
  const template = document.createElement("template");
  template.innerHTML = html.trim();
  return template.content.firstElementChild;
}

// Today's new characters first, then everything else in garden (rank)
// order — matches the spec's picker ordering exactly.
function orderedPracticeChars(progress, charMap, todayStr) {
  const entries = Object.entries(progress.characters);
  const todaysNew = entries
    .filter(([, state]) => state.source === "daily" && state.dateLearned === todayStr)
    .map(([char]) => char);
  const rest = entries
    .filter(([char]) => !todaysNew.includes(char) && charMap.has(char))
    .sort((a, b) => charMap.get(a[0]).rank - charMap.get(b[0]).rank)
    .map(([char]) => char);
  return [...todaysNew, ...rest];
}

// Resolves when she taps ⬅️ (back to wherever the studio was opened from).
// The studio is part of the character room's run, so leaving the room
// (back button / 🏠) rejects this with RunAborted and the room unwinds; the
// screen is hidden in `finally` either way.
export async function runPracticeStudio(progress, charMap) {
  const screen = document.getElementById("screen-studio");
  const container = document.getElementById("studio-content");
  screen.classList.remove("hidden");
  const persistentExit = screen.querySelector(".room-exit");

  try {
    await untilAborted(new Promise((resolveStudio) => runStudioUi(container, progress, charMap, resolveStudio, persistentExit)));
  } finally {
    if (persistentExit) persistentExit.onclick = null;
    container.replaceChildren();
    screen.classList.add("hidden");
  }
}

// The mode handlers below run from click events, so an abort mid-quiz
// surfaces there as a RunAborted rejection — expected, not an error.
function guarded(fn) {
  return (...args) =>
    Promise.resolve()
      .then(() => fn(...args))
      .catch((err) => {
        if (!(err instanceof RunAborted)) console.error(err);
      });
}

function runStudioUi(container, progress, charMap, resolveStudio, persistentExit) {
  function exitStudio() {
    resolveStudio();
  }
  if (persistentExit) persistentExit.onclick = exitStudio;

  function renderInkBottle(target) {
    const today = todayLocalDateString();
    const drops = getInkDrops(progress, today);
    target.textContent = `🧴 ${"💧".repeat(drops)}${"◌".repeat(INK_BOTTLE_CAPACITY - drops)}`;
  }

  async function handlePracticeComplete(char) {
    const today = todayLocalDateString();
    const { bottleFilled } = addInkDrop(progress, today);
    saveProgress(progress);

    if (bottleFilled) {
      awardSticker(progress, char);
      saveProgress(progress);
      await showBottleFullCelebration(char);
    } else {
      await playLine(pickVariant("praise", 5));
    }
  }

  async function showBottleFullCelebration(char) {
    const total = getStickerCount(progress, char);
    container.replaceChildren(
      el(`
        <div class="session-content">
          <div class="big-emoji sticker-pop">🐼🌟</div>
          <p>墨水瓶满啦！获得一枚熊猫贴纸！（${char} 一共 ${total} 枚）</p>
        </div>
      `)
    );
    await playLine("inkBottleFull");
    await sleep(1400);
  }

  function showPicker() {
    const today = todayLocalDateString();
    const chars = orderedPracticeChars(progress, charMap, today);

    if (chars.length === 0) {
      container.replaceChildren(
        el(`
          <div class="session-content">
            <div class="big-emoji">🐼</div>
            <p>还没有可以练习的字，先去种一颗种子吧！</p>
            <button class="big-button" type="button" id="btn-studio-exit">回到花园</button>
          </div>
        `)
      );
      container.querySelector("#btn-studio-exit").addEventListener("click", exitStudio);
      return;
    }

    const screenEl = el(`
      <div class="session-content">
        <div class="studio-header-row">
          <button type="button" class="icon-button" id="btn-studio-exit" aria-label="回到花园">⬅️</button>
          <div class="studio-ink-bottle" id="studio-ink-bottle"></div>
        </div>
        <div class="studio-picker-grid" id="studio-picker-grid"></div>
      </div>
    `);
    container.replaceChildren(screenEl);
    renderInkBottle(screenEl.querySelector("#studio-ink-bottle"));
    screenEl.querySelector("#btn-studio-exit").addEventListener("click", exitStudio);

    const grid = screenEl.querySelector("#studio-picker-grid");
    for (const char of chars) {
      const state = progress.characters[char];
      const stage = growthStageFor(state, today);
      const tile = el(`
        <button type="button" class="studio-picker-tile">
          <span class="studio-picker-char">${char}</span>
          <span class="studio-picker-stage">${STAGE_EMOJI[stage]}</span>
        </button>
      `);
      tile.addEventListener("click", () => showCharacterModes(char));
      grid.appendChild(tile);
    }
  }

  function showCharacterModes(char) {
    container.replaceChildren(
      el(`
        <div class="session-content">
          <div class="big-character">${char}</div>
          <div class="studio-mode-buttons">
            <button type="button" class="big-button" id="mode-watch">👀 看</button>
            <button type="button" class="big-button" id="mode-trace">✍️ 描</button>
            <button type="button" class="big-button" id="mode-copy">📝 写</button>
          </div>
          <button type="button" class="icon-button" id="btn-studio-back" aria-label="换一个字">⬅️ 换一个字</button>
        </div>
      `)
    );
    container.querySelector("#mode-watch").addEventListener("click", guarded(() => runWatchMode(char)));
    container.querySelector("#mode-trace").addEventListener("click", guarded(() => runTraceMode(char)));
    container.querySelector("#mode-copy").addEventListener("click", guarded(() => runCopyMode(char)));
    container.querySelector("#btn-studio-back").addEventListener("click", showPicker);
  }

  async function runWatchMode(char) {
    let speed = WATCH_SLOW_SPEED;
    const screenEl = el(`
      <div class="session-content">
        <div class="writer-target" id="studio-watch-target"></div>
        <div class="studio-speed-row">
          <button type="button" class="icon-button studio-speed-btn active" id="speed-slow">🐌 慢</button>
          <button type="button" class="icon-button studio-speed-btn" id="speed-fast">🐇 快</button>
        </div>
        <button type="button" class="big-button" id="btn-watch-replay">▶️ 再看一次</button>
        <button type="button" class="icon-button" id="btn-watch-back" aria-label="返回">⬅️ 返回</button>
      </div>
    `);
    container.replaceChildren(screenEl);
    const target = screenEl.querySelector("#studio-watch-target");

    const play = () => animateCharacterOnce(target, char, { speed }).catch(() => {});

    screenEl.querySelector("#speed-slow").addEventListener("click", () => {
      speed = WATCH_SLOW_SPEED;
      screenEl.querySelector("#speed-slow").classList.add("active");
      screenEl.querySelector("#speed-fast").classList.remove("active");
      play();
    });
    screenEl.querySelector("#speed-fast").addEventListener("click", () => {
      speed = WATCH_FAST_SPEED;
      screenEl.querySelector("#speed-fast").classList.add("active");
      screenEl.querySelector("#speed-slow").classList.remove("active");
      play();
    });
    screenEl.querySelector("#btn-watch-replay").addEventListener("click", play);
    screenEl.querySelector("#btn-watch-back").addEventListener("click", () => showCharacterModes(char));

    await playLine(`char_${char}`);
    await play();
  }

  async function runTraceMode(char) {
    const screenEl = el(`<div class="session-content"><div class="writer-target" id="studio-trace-target"></div></div>`);
    container.replaceChildren(screenEl);
    const target = screenEl.querySelector("#studio-trace-target");

    await playLine(`char_${char}`);
    await traceWithHints(target, char);

    await handlePracticeComplete(char);
    showCharacterModes(char);
  }

  async function runCopyMode(char) {
    const screenEl = el(`
      <div class="session-content">
        <div class="studio-copy-row">
          <div class="big-character studio-copy-reference">${char}</div>
          <div class="writer-target" id="studio-copy-target"></div>
        </div>
      </div>
    `);
    container.replaceChildren(screenEl);
    const target = screenEl.querySelector("#studio-copy-target");

    await playLine(`char_${char}`);
    await writeFromMemory(target, char, { showHintAfterMisses: COPY_HINT_AFTER_MISSES });

    await handlePracticeComplete(char);
    showCharacterModes(char);
  }

  showPicker();
  playLine("studioWelcome").catch(() => {}); // fire-and-forget — only on this first open, not every return-to-picker
}
