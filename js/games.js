// Round 3 game arcade (游戏场): 8 mini-games, a deterministic daily
// rotation that picks 3 of them, and a curated visual-confusable map for
// G5. Every game function has the signature
//   runGame(container, { newChars, distractorChars, charMap, progress }) -> Promise<void>
// and is responsible for rendering itself into `container`, playing its
// own instruction audio, and resolving once the child has finished it.

import { playLine, pickVariant } from "./audio.js";
import { recordGameSeen } from "./progress.js";
import { charPictureHtml } from "./garden.js";

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
    function handler(e) {
      const tile = e.target.closest(selector);
      if (!tile) return; // a miss shouldn't cost us the listener — keep waiting
      container.removeEventListener("click", handler);
      resolve(tile);
    }
    container.addEventListener("click", handler);
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

// Builds a metPool the same way session.js does, from progress + charMap,
// for games (G5) that need to draw distractors from everything she's met
// so far rather than just the 1-2 chars runGameArcade passed in.
function buildMetPool(progress, charMap) {
  return Object.keys(progress.characters)
    .map((char) => charMap.get(char))
    .filter(Boolean);
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
  // innerHTML, not textContent: `display` is sometimes charPictureHtml()'s
  // <img> markup, sometimes a plain character/emoji — always our own
  // trusted static data, never anything user-supplied.
  tile.innerHTML = display;
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
// `introLine`, if given, plays once AFTER the screen has already rendered
// (not before) — the game's spoken instruction used to gate the very first
// render, leaving a blank screen for however long that line took to
// load/play, which reads as "the game doesn't work" on a slow connection.
async function runToCorrectTap(container, buildScreen, correctChar, introLine) {
  let tile;
  let firstPass = true;
  do {
    const screen = buildScreen();
    container.replaceChildren(screen);
    const tapPromise = waitForTap(container, ".choice-tile");
    if (firstPass && introLine) {
      await playLine(introLine);
    }
    firstPass = false;
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
  let introLine = "gameInstruction_G1";

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
      char,
      introLine
    );
    introLine = null;
  }
}

// ============================================================
// G2 — 句子填空 (sentence fill-blank)
// ============================================================

async function runG2(container, { newChars, distractorChars, charMap }) {
  let introLine = "gameInstruction_G2";

  for (const char of shuffle(newChars)) {
    const entry = charMap.get(char);
    const blankSentence = entry.sentence.replace(char, "＿");
    const otherNewChars = newChars.filter((c) => c !== char).map((c) => charMap.get(c));
    const choicesPool = shuffle([...otherNewChars, ...distractorChars.map((c) => charMap.get(c))]).slice(0, 3);
    const choices = shuffle([entry, ...choicesPool]);

    await runToCorrectTap(
      container,
      () => {
        const screen = el(`
          <div class="session-content">
            <div class="story-text">${blankSentence}</div>
            <div class="choice-grid"></div>
          </div>
        `);
        const grid = screen.querySelector(".choice-grid");
        for (const choice of choices) grid.appendChild(makeTile(choice.char, choice.char));
        screen.dataset.pendingAudio = `sentence_${char}`;
        return screen;
      },
      char,
      introLine
    );
    introLine = null;
  }
}

// ============================================================
// G3 — 泡泡爆爆 (bubble pop)
// ============================================================

// A short bright "ding" for a correct pop and a soft low note for a wrong
// one, synthesized with the Web Audio API. Deliberately NOT routed through
// audio.js's shared <audio> element (which carries the spoken character
// announcement), so this instant feedback can never cut the narration off —
// and it needs no sound-effect asset files. The AudioContext is created
// lazily on the first pop, which is always a tap, satisfying the browser's
// user-gesture requirement for audio.
let chimeCtx = null;
function playChime(kind) {
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    if (!chimeCtx) chimeCtx = new AC();
    if (chimeCtx.state === "suspended") chimeCtx.resume();
    const ctx = chimeCtx;
    const now = ctx.currentTime;
    const tone = (freq, start, dur, peak) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(peak, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + dur);
      osc.connect(gain).connect(ctx.destination);
      osc.start(start);
      osc.stop(start + dur + 0.03);
    };
    if (kind === "correct") {
      tone(880, now, 0.14, 0.2); // A5
      tone(1318.51, now + 0.1, 0.18, 0.2); // E6 — bright rising ding
    } else {
      tone(311.13, now, 0.24, 0.16); // soft low Eb4 — gentle, not a harsh buzzer
    }
  } catch {
    // Audio here is a nicety; never let it break the game.
  }
}

// One clearly-bounded popping round for a single target character. The
// target is fixed for the whole window (no mid-round switching — that was
// the "I popped the right one and it turned red" confusion), bubbles fade
// in in place biased toward the target so there's always a right one, and
// timerFill animates from full to empty to show the time left. Resolves
// when the window closes.
function runBubbleRound(field, timerFill, poolEntries, targetEntry, roundMs) {
  return new Promise((resolve) => {
    let stopped = false;

    // Drive the countdown bar from JS rather than a CSS transition: a CSS
    // width/transform transition silently fails to progress in a throttled/
    // backgrounded renderer (the same class of bug that once left bubbles
    // frozen off-screen), whereas an interval that writes the width every
    // 100ms always advances wherever timers run.
    timerFill.style.width = "100%";
    const startAt = performance.now();
    const timerTick = setInterval(() => {
      const pct = Math.max(0, 1 - (performance.now() - startAt) / roundMs);
      timerFill.style.width = `${pct * 100}%`;
    }, 100);

    function spawnBubble() {
      if (stopped) return;
      // ~55% target so there's reliably something correct on screen without
      // the field being trivially all-target.
      const entry =
        Math.random() < 0.55
          ? targetEntry
          : poolEntries[Math.floor(Math.random() * poolEntries.length)];
      const bubble = el(`<button type="button" class="bubble-tile"></button>`);
      bubble.textContent = entry.char;
      bubble.dataset.answerChar = entry.char;
      bubble.style.left = `${5 + Math.random() * 80}%`;
      bubble.style.top = `${8 + Math.random() * 72}%`;
      const lifespanMs = 2200 + Math.random() * 1500;
      bubble.addEventListener("click", () => {
        if (bubble.dataset.popped) return;
        bubble.dataset.popped = "true";
        const isCorrect = bubble.dataset.answerChar === targetEntry.char;
        bubble.classList.add(isCorrect ? "bubble-pop-correct" : "bubble-pop-wrong");
        playChime(isCorrect ? "correct" : "wrong");
        setTimeout(() => bubble.remove(), 300);
      });
      field.appendChild(bubble);
      setTimeout(() => {
        if (!bubble.dataset.popped) bubble.remove();
      }, lifespanMs);
    }

    spawnBubble();
    const spawnInterval = setInterval(spawnBubble, 800);
    setTimeout(() => {
      stopped = true;
      clearInterval(spawnInterval);
      clearInterval(timerTick);
      timerFill.style.width = "0%";
      resolve();
    }, roundMs);
  });
}

async function runG3(container, { newChars, distractorChars, charMap }) {
  const pool = [...newChars, ...distractorChars.slice(0, 2)];
  const entries = pool.map((c) => charMap.get(c)).filter(Boolean);
  if (entries.length === 0) return;

  const screen = el(`
    <div class="session-content">
      <div class="bubble-hud">
        <div class="bubble-target">找一找：<span class="bubble-target-char"></span></div>
        <div class="bubble-timer"><div class="bubble-timer-fill"></div></div>
      </div>
      <div class="bubble-field"></div>
    </div>
  `);
  container.replaceChildren(screen);
  const field = screen.querySelector(".bubble-field");
  const targetCharEl = screen.querySelector(".bubble-target-char");
  const timerFill = screen.querySelector(".bubble-timer-fill");

  await playLine("gameInstruction_G3");

  const ROUND_MS = 6000;
  // One clearly-separated round per character, in random order — a finite,
  // legible structure instead of a 45s free-for-all with a silently
  // rotating target.
  for (const targetEntry of shuffle(entries)) {
    // Clean break between characters: clear the field, show + pulse the new
    // target so it's obvious a new one has started, say it, then open the
    // timed window.
    field.innerHTML = "";
    targetCharEl.textContent = targetEntry.char;
    targetCharEl.classList.remove("pulse");
    void targetCharEl.offsetWidth;
    targetCharEl.classList.add("pulse");
    timerFill.style.width = "100%";

    await playLine(`char_${targetEntry.char}`);
    await runBubbleRound(field, timerFill, entries, targetEntry, ROUND_MS);

    // Visible boundary before the next character.
    field.innerHTML = "";
    await new Promise((r) => setTimeout(r, 600));
  }

  await playLine(pickVariant("praise", 5));
}

// ============================================================
// G4 — 翻牌配对 (memory match)
// ============================================================

async function runG4(container, { newChars, charMap }) {
  const three = newChars.slice(0, 3);
  const entries = three.map((c) => charMap.get(c));

  const cards = shuffle([
    ...entries.map((e) => ({ kind: "char", char: e.char, display: e.char })),
    ...entries.map((e) => ({ kind: "pic", char: e.char, display: charPictureHtml(e) })),
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

  // Cards are rendered face-down above; playing the instruction here (not
  // before) means she sees the board right away instead of a blank screen.
  await playLine("gameInstruction_G4");

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
// G5 — 火眼金睛 (eagle eye: spot the look-alike)
// ============================================================

async function runG5(container, { newChars, charMap, progress }) {
  const metPool = buildMetPool(progress, charMap);
  let introLine = "gameInstruction_G5";

  for (const char of shuffle(newChars)) {
    const entry = charMap.get(char);
    const confusables = getConfusables(char, metPool, 3);
    const choices = shuffle([entry, ...confusables]);

    await runToCorrectTap(
      container,
      () => {
        const screen = el(`
          <div class="session-content">
            <div class="choice-grid"></div>
          </div>
        `);
        const grid = screen.querySelector(".choice-grid");
        for (const choice of choices) grid.appendChild(makeTile(choice.char, choice.char));
        screen.dataset.pendingAudio = `char_${char}`;
        return screen;
      },
      char,
      introLine
    );
    introLine = null;
  }
}

// ============================================================
// G6 — 组词车间 (word workshop: find the right partner character)
// ============================================================

// Picks `count` wrong partner candidates, preferring today's other new/
// distractor characters and falling back to the full character set so
// there's always enough choices even on a light (0-1 new char) day.
function pickWrongPartners(count, excludeChars, charMap, preferredChars) {
  const preferred = shuffle(preferredChars.filter((c) => !excludeChars.has(c)));
  if (preferred.length >= count) return preferred.slice(0, count);
  const fallbackPool = shuffle(
    Array.from(charMap.keys()).filter((c) => !excludeChars.has(c) && !preferred.includes(c))
  );
  return [...preferred, ...fallbackPool].slice(0, count);
}

async function runG6(container, { newChars, distractorChars, charMap }) {
  let introLine = "gameInstruction_G6";

  for (const char of shuffle(newChars)) {
    const entry = charMap.get(char);
    const partner = entry.word.replace(char, "");
    const wrongPartners = pickWrongPartners(
      2,
      new Set([char, partner]),
      charMap,
      [...newChars, ...distractorChars]
    );
    const candidateChars = shuffle([partner, ...wrongPartners]);

    let tile;
    do {
      const screen = el(`
        <div class="session-content">
          <div class="big-character">${char}</div>
          <div class="choice-grid"></div>
        </div>
      `);
      container.replaceChildren(screen);
      const grid = screen.querySelector(".choice-grid");
      for (const candidate of candidateChars) grid.appendChild(makeTile(candidate, candidate));
      const tapPromise = waitForTap(container, ".choice-tile");
      if (introLine) {
        await playLine(introLine);
        introLine = null;
      }
      await playLine(`char_${char}`);
      tile = await tapPromise;
      const isCorrect = tile.dataset.answerChar === partner;
      if (isCorrect) {
        tile.classList.add("correct");
        await new Promise((r) => setTimeout(r, 300));
        // No dedicated illustration exists for the two-character word (only
        // per-character pictures) — showing entry's own picture here while
        // narrating the word was a mismatch. Just show the word itself.
        container.replaceChildren(
          el(`
            <div class="session-content">
              <div class="big-character" style="font-size:64px">${entry.word}</div>
            </div>
          `)
        );
        await playLine(`word_${char}`);
        await playLine(pickVariant("praise", 5));
        // Give her a moment to look at and hear the finished word before the
        // screen jumps to the next character's prompt.
        await new Promise((r) => setTimeout(r, 1200));
      } else {
        await handleTapResult(container, tile, false);
      }
    } while (tile.dataset.answerChar !== partner);
  }
}

// ============================================================
// G7 — 句子拼拼乐 (sentence builder)
// ============================================================

// Our sentences are authored entirely from this app's own vocabulary, so a
// dictionary built from every character's `word` field is enough for a
// greedy longest-match segmentation (no external NLP needed).
function buildWordDictionary(charMap) {
  const words = new Set();
  for (const entry of charMap.values()) {
    if (entry.word && entry.word.length >= 2) words.add(entry.word);
  }
  return words;
}

function segmentSentence(sentence, wordDict) {
  const tokens = [];
  let i = 0;
  while (i < sentence.length) {
    const twoChar = sentence.slice(i, i + 2);
    if (wordDict.has(twoChar)) {
      tokens.push(twoChar);
      i += 2;
    } else {
      tokens.push(sentence[i]);
      i += 1;
    }
  }
  return tokens;
}

async function runG7(container, { newChars, charMap }) {
  let introLine = "gameInstruction_G7";
  const wordDict = buildWordDictionary(charMap);

  for (const char of shuffle(newChars)) {
    const entry = charMap.get(char);
    const cleanSentence = entry.sentence.replace(/[。！？，、]/g, "");
    const tokens = segmentSentence(cleanSentence, wordDict);
    if (tokens.length < 2) continue; // nothing to sequence — skip gracefully

    const screen = el(`
      <div class="session-content">
        <div class="sentence-build-strip"></div>
        <div class="sentence-tile-pool"></div>
      </div>
    `);
    container.replaceChildren(screen);
    const strip = screen.querySelector(".sentence-build-strip");
    const pool = screen.querySelector(".sentence-tile-pool");

    const shuffledTokens = shuffle(tokens.map((token, order) => ({ token, order })));
    const tileEls = shuffledTokens.map(({ token, order }) => {
      const tile = el(`<button type="button" class="sentence-tile">${token}</button>`);
      tile.dataset.order = String(order);
      pool.appendChild(tile);
      return tile;
    });

    if (introLine) {
      await playLine(introLine);
      introLine = null;
    }
    await playLine(`sentence_${char}`);

    let nextIndex = 0;
    await new Promise((resolveGame) => {
      tileEls.forEach((tile) => {
        tile.addEventListener("click", async () => {
          if (tile.classList.contains("placed")) return;
          if (Number(tile.dataset.order) === nextIndex) {
            tile.classList.add("placed");
            strip.appendChild(tile);
            nextIndex++;
            if (nextIndex === tokens.length) {
              await playLine(pickVariant("praise", 5));
              resolveGame();
            }
          } else {
            tile.classList.add("shake");
            setTimeout(() => tile.classList.remove("shake"), 400);
          }
        });
      });
    });
  }
}

// ============================================================
// G8 — 喂熊猫 (feed the panda)
// ============================================================

async function runG8(container, { newChars, distractorChars, charMap }) {
  let introLine = "gameInstruction_G8";

  for (const char of shuffle(newChars)) {
    const entry = charMap.get(char);
    const otherNewChars = newChars.filter((c) => c !== char).map((c) => charMap.get(c));
    const choicesPool = shuffle([...otherNewChars, ...distractorChars.map((c) => charMap.get(c))]).slice(0, 3);
    const choices = shuffle([entry, ...choicesPool]);

    let tile;
    do {
      const screen = el(`
        <div class="session-content">
          <div class="panda-feed-scene">🐼</div>
          <div class="choice-grid"></div>
        </div>
      `);
      container.replaceChildren(screen);
      const grid = screen.querySelector(".choice-grid");
      for (const choice of choices) grid.appendChild(makeTile(choice.char, charPictureHtml(choice)));
      const tapPromise = waitForTap(container, ".choice-tile");
      if (introLine) {
        await playLine(introLine);
        introLine = null;
      }
      await playLine(`feedRequest_${char}`);
      tile = await tapPromise;
      const isCorrect = tile.dataset.answerChar === char;
      if (isCorrect) {
        screen.querySelector(".panda-feed-scene").classList.add("chewing");
        tile.classList.add("correct");
        await playLine(pickVariant("praise", 5));
        await new Promise((r) => setTimeout(r, 500));
      } else {
        await handleTapResult(container, tile, false);
      }
    } while (tile.dataset.answerChar !== char);
  }
}

const GAME_IMPLEMENTATIONS = {
  G1: runG1,
  G2: runG2,
  G3: runG3,
  G4: runG4,
  G5: runG5,
  G6: runG6,
  G7: runG7,
  G8: runG8,
};

// ---------- entry point ----------

export async function runGame(gameId, container, { newChars, distractorChars, charMap, progress }) {
  const impl = GAME_IMPLEMENTATIONS[gameId];
  await impl(container, { newChars, distractorChars, charMap, progress });
  for (const char of newChars) recordGameSeen(progress, char);
}
