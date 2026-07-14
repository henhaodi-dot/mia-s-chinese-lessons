// Round 3 game arcade (游戏场): 8 mini-games, a deterministic daily
// rotation that picks 3 of them, and a curated visual-confusable map for
// G5. Every game function has the signature
//   runGame(container, { newChars, distractorChars, charMap, progress }) -> Promise<void>
// and is responsible for rendering itself into `container`, playing its
// own instruction audio, and resolving once the child has finished it.
//
// Only G1, G3, and G4 are real implementations so far — everything else
// falls back to a simple placeholder round until later build steps.

import { playLine, pickVariant } from "./audio.js";
import { recordGameSeen } from "./progress.js";

export const GAME_IDS = ["G1", "G2", "G3", "G4", "G5", "G6", "G7", "G8"];

function el(html) {
  const template = document.createElement("template");
  template.innerHTML = html.trim();
  return template.content.firstElementChild;
}

function shuffle(array) {
  const copy = [...array];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

async function waitForTap(container, selector) {
  return new Promise((resolve) => {
    container.addEventListener(
      "click",
      (e) => {
        const tile = e.target.closest(selector);
        if (tile) resolve(tile);
      },
      { once: true }
    );
  });
}

// ---------- daily rotation ----------
//
// A fixed 6-day cycle of hand-picked triples, indexed by a stable
// "local epoch day" so the same calendar day always produces the same
// lineup (no reroll on refresh). Chosen so that: G1 appears at least
// every other day, G2 and G7 never share a day, and every 3-day window
// covers the full 8-game pool at least once.
const ROTATION_CYCLE = [
  ["G1", "G3", "G4"],
  ["G2", "G5", "G6"],
  ["G1", "G7", "G8"],
  ["G3", "G4", "G6"],
  ["G1", "G2", "G5"],
  ["G7", "G8", "G4"],
];

function localEpochDay(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return Math.floor(new Date(y, m - 1, d).getTime() / 86400000);
}

export function pickGamesForToday(todayStr) {
  const index = ((localEpochDay(todayStr) % ROTATION_CYCLE.length) + ROTATION_CYCLE.length) % ROTATION_CYCLE.length;
  return ROTATION_CYCLE[index];
}

// ---------- visual-confusable map (for G5, and available to any game) ----------
//
// Hand-curated from what's actually in our 200-character set: same
// radical, same component, or same "add one stroke" relationship. Not
// exhaustive — characters outside these groups fall back to same-pinyin-
// initial or random (handled by getConfusables below).
const CONFUSABLE_GROUPS = [
  ["猫", "猪", "猴", "狗", "狮"], // 犭 radical
  ["妈", "奶", "好", "姐", "妹", "她"], // 女 radical
  ["他", "她"], // shared 也 component
  ["鸡", "鸟"], // shared 鸟 component
  ["跑", "跳"], // ⻊ radical
  ["睡", "眼"], // 目 radical
  ["明", "朋"], // 月 doubled
  ["苹", "蕉"], // 艹 radical
  ["红", "绿"], // 纟 radical
  ["短", "矮"], // 矢 radical
  ["爸", "爷"], // 父 component
  ["一", "二", "三"], // stacked horizontal strokes
  ["大", "天"], // one extra stroke
  ["快", "慢", "怕"], // 忄 radical
  ["说", "读", "课"], // 讠 radical
  ["现", "玩", "球"], // 王 radical
  ["日", "白"], // one extra stroke
];

function findConfusableGroup(char) {
  return CONFUSABLE_GROUPS.find((group) => group.includes(char));
}

// Returns up to `count` visually-confusable characters for `char`, drawn
// from metPool (characters she's already met). Falls back to same-pinyin-
// initial, then random, when there's no curated group or it runs dry.
export function getConfusables(char, metPool, count) {
  const entry = metPool.find((e) => e.char === char);
  const pool = metPool.filter((e) => e.char !== char);
  const results = [];

  const group = findConfusableGroup(char);
  if (group) {
    const groupMatches = pool.filter((e) => group.includes(e.char));
    results.push(...shuffle(groupMatches));
  }

  if (results.length < count && entry) {
    const sameInitial = pool.filter(
      (e) => e.pinyin[0] === entry.pinyin[0] && !results.includes(e)
    );
    results.push(...shuffle(sameInitial));
  }

  if (results.length < count) {
    const rest = pool.filter((e) => !results.includes(e));
    results.push(...shuffle(rest));
  }

  return results.slice(0, count);
}

// ---------- shared tile helpers ----------

function makeTile(answerChar, display) {
  const tile = el(`<button class="choice-tile" type="button"></button>`);
  tile.dataset.answerChar = answerChar;
  tile.textContent = display;
  return tile;
}

async function handleTapResult(container, tile, isCorrect) {
  tile.classList.add(isCorrect ? "correct" : "incorrect");
  if (isCorrect) {
    await playLine(pickVariant("praise", 5));
  } else {
    await playLine(pickVariant("tryAgain", 3));
  }
  await new Promise((r) => setTimeout(r, 300));
}

// One correct-or-retry round: shows choices, waits for a correct tap
// (wrong taps get a warm retry, matching the app's "never a buzzer" rule).
async function runToCorrectTap(container, buildScreen, correctChar) {
  let tile;
  do {
    const screen = buildScreen();
    container.replaceChildren(screen);
    const tapPromise = waitForTap(container, ".choice-tile");
    if (screen.dataset.pendingAudio) {
      await playLine(screen.dataset.pendingAudio);
    }
    tile = await tapPromise;
    const isCorrect = tile.dataset.answerChar === correctChar;
    await handleTapResult(container, tile, isCorrect);
    if (!isCorrect) continue;
    break;
    // eslint-disable-next-line no-constant-condition
  } while (true);
}

// ============================================================
// G1 — 词语填空 (word fill-blank)
// ============================================================

async function runG1(container, { newChars, distractorChars, charMap }) {
  await playLine("gameInstruction_G1");

  for (const char of shuffle(newChars)) {
    const entry = charMap.get(char);
    const blankWord = entry.word.replace(char, "＿");
    const otherNewChars = newChars.filter((c) => c !== char).map((c) => charMap.get(c));
    const choicesPool = shuffle([...otherNewChars, ...distractorChars.map((c) => charMap.get(c))]).slice(0, 3);
    const choices = shuffle([entry, ...choicesPool]);

    await runToCorrectTap(
      container,
      () => {
        const screen = el(`
          <div class="session-content">
            <div class="big-character" style="font-size:64px">${blankWord}</div>
            <div class="choice-grid"></div>
          </div>
        `);
        const grid = screen.querySelector(".choice-grid");
        for (const choice of choices) grid.appendChild(makeTile(choice.char, choice.char));
        screen.dataset.pendingAudio = `word_${char}`;
        return screen;
      },
      char
    );
  }
}

// ============================================================
// G3 — 泡泡爆爆 (bubble pop)
// ============================================================

async function runG3(container, { newChars, distractorChars, charMap }) {
  await playLine("gameInstruction_G3");

  const pool = [...newChars, ...distractorChars.slice(0, 2)];
  const entries = pool.map((c) => charMap.get(c));

  const screen = el(`
    <div class="session-content">
      <div class="bubble-field"></div>
    </div>
  `);
  container.replaceChildren(screen);
  const field = screen.querySelector(".bubble-field");

  let stopped = false;
  let target = newChars[0];
  let score = 0;
  const totalRoundMs = 45000;
  const targetSwitchMs = 6000;

  function announceTarget() {
    target = pool[Math.floor(Math.random() * pool.length)];
    playLine(`char_${target}`);
  }

  function spawnBubble() {
    if (stopped) return;
    const entry = entries[Math.floor(Math.random() * entries.length)];
    const bubble = el(`<button type="button" class="bubble-tile"></button>`);
    bubble.textContent = entry.char;
    bubble.dataset.answerChar = entry.char;
    bubble.style.left = `${5 + Math.random() * 80}%`;
    bubble.style.animationDuration = `${3 + Math.random() * 2}s`;
    bubble.addEventListener("click", async () => {
      if (bubble.dataset.popped) return;
      bubble.dataset.popped = "true";
      const isCorrect = bubble.dataset.answerChar === target;
      bubble.classList.add(isCorrect ? "bubble-pop-correct" : "bubble-pop-wrong");
      if (isCorrect) score++;
      setTimeout(() => bubble.remove(), 300);
    });
    bubble.addEventListener("animationend", () => bubble.remove());
    field.appendChild(bubble);
  }

  announceTarget();
  const spawnInterval = setInterval(spawnBubble, 900);
  const targetInterval = setInterval(announceTarget, targetSwitchMs);

  await new Promise((resolve) => setTimeout(resolve, totalRoundMs));
  stopped = true;
  clearInterval(spawnInterval);
  clearInterval(targetInterval);
  field.innerHTML = "";
  await playLine(pickVariant("praise", 5));
}

// ============================================================
// G4 — 翻牌配对 (memory match)
// ============================================================

async function runG4(container, { newChars, charMap }) {
  await playLine("gameInstruction_G4");

  const three = newChars.slice(0, 3);
  const entries = three.map((c) => charMap.get(c));

  const cards = shuffle([
    ...entries.map((e) => ({ kind: "char", char: e.char, display: e.char })),
    ...entries.map((e) => ({ kind: "pic", char: e.char, display: e.emoji })),
  ]);

  const screen = el(`
    <div class="session-content">
      <div class="memory-grid"></div>
    </div>
  `);
  container.replaceChildren(screen);
  const grid = screen.querySelector(".memory-grid");

  const cardEls = cards.map((card, i) => {
    const cardEl = el(`
      <button type="button" class="memory-card">
        <span class="memory-card-back">🐼</span>
        <span class="memory-card-front hidden">${card.display}</span>
      </button>
    `);
    cardEl.dataset.char = card.char;
    cardEl.dataset.index = String(i);
    grid.appendChild(cardEl);
    return cardEl;
  });

  let matchedCount = 0;
  let busy = false;
  let firstPick = null;

  await new Promise((resolveGame) => {
    cardEls.forEach((cardEl) => {
      cardEl.addEventListener("click", async () => {
        if (busy || cardEl.classList.contains("matched") || cardEl === firstPick) return;

        cardEl.querySelector(".memory-card-front").classList.remove("hidden");
        cardEl.querySelector(".memory-card-back").classList.add("hidden");

        if (!firstPick) {
          firstPick = cardEl;
          return;
        }

        busy = true;
        const isMatch = firstPick.dataset.char === cardEl.dataset.char;
        if (isMatch) {
          firstPick.classList.add("matched");
          cardEl.classList.add("matched");
          matchedCount++;
          await playLine(`char_${cardEl.dataset.char}`);
          firstPick = null;
          busy = false;
          if (matchedCount === three.length) resolveGame();
        } else {
          await playLine(pickVariant("tryAgain", 3));
          await new Promise((r) => setTimeout(r, 500));
          [firstPick, cardEl].forEach((c) => {
            c.querySelector(".memory-card-front").classList.add("hidden");
            c.querySelector(".memory-card-back").classList.remove("hidden");
          });
          firstPick = null;
          busy = false;
        }
      });
    });
  });

  await playLine(pickVariant("praise", 5));
}

// ============================================================
// Placeholder for games not yet implemented (G2, G5, G6, G7, G8)
// ============================================================

async function runPlaceholder(container, { newChars, distractorChars, charMap, gameId }) {
  await playLine(`gameInstruction_${gameId}`).catch(() => {});

  for (const char of shuffle(newChars)) {
    const entry = charMap.get(char);
    const distractorEntries = shuffle(distractorChars.map((c) => charMap.get(c))).slice(0, 2);
    const choices = shuffle([entry, ...distractorEntries]);

    await runToCorrectTap(
      container,
      () => {
        const screen = el(`
          <div class="session-content">
            <div class="big-emoji">${entry.emoji}</div>
            <div class="choice-grid"></div>
          </div>
        `);
        const grid = screen.querySelector(".choice-grid");
        for (const choice of choices) grid.appendChild(makeTile(choice.char, choice.char));
        screen.dataset.pendingAudio = `word_${char}`;
        return screen;
      },
      char
    );
  }
}

const GAME_IMPLEMENTATIONS = {
  G1: runG1,
  G3: runG3,
  G4: runG4,
};

// ---------- entry point ----------

export async function runGame(gameId, container, { newChars, distractorChars, charMap, progress }) {
  const impl = GAME_IMPLEMENTATIONS[gameId] || ((c, ctx) => runPlaceholder(c, { ...ctx, gameId }));
  await impl(container, { newChars, distractorChars, charMap, progress });
  for (const char of newChars) recordGameSeen(progress, char);
}
