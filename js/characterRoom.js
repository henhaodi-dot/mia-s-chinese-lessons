// 认认字 (character room) — the v3 home for learning new characters AND
// reviewing them through games. Replaces the old monolithic daily session's
// Round 1 (meet) + Round 3 (games) halves, minus the echo practice (that
// moved to the speaking room).
//
// Entry flow:
//   1. If a new character is scheduled today and not yet learned → intro
//      sequence (picture + audio → stroke animation → guided traces), seed
//      it, then games.
//   2. Otherwise → straight into games.
//   3. A game session is 3 games (each longer than before). She can play
//      another set or leave whenever — no forced exit.
//
// Character selection is weighted toward due / shaky / recently-learned, and
// today's new character (if any) is guaranteed a slot in every game.

import { playLine, playSequence, pickVariant } from "./audio.js";
import {
  todayLocalDateString,
  daysBetweenLocalDateStrings,
  seedCharacter,
  saveProgress,
  startReviewSession,
} from "./progress.js";
import { isDue, pickTodaysNewCharacters } from "./scheduler.js";
import { isResting, processWakeups } from "./rest.js";
import { animateCharacterOnce, runTraceHintQuiz } from "./strokes.js";
import { charPictureHtml, showCardModal } from "./garden.js";
import { runGame } from "./games.js";
import { runPracticeStudio } from "./studio.js";

// Target characters (≈ rounds) per game — each now runs meaningfully longer
// than the old 1-round-per-new-char version. G4 (memory match) uses a fixed
// 3 pairs regardless. G3 (bubble) runs one timed round per character.
const GAME_ROUNDS = { G1: 9, G3: 8, G4: 7, G5: 7, G6: 6, G7: 4, G8: 8 };

// These games render a character's picture, so they can only use characters
// that have one (particles like 的/了 don't). G4 is now dictation (no
// pictures), so it's deliberately NOT here — it works great for particles.
const PICTURE_DEPENDENT_GAMES = new Set(["G8"]);

// Curated list: only characters whose picture/emoji unambiguously represents
// the character's meaning. G8 (feed the panda) draws from this pool so the
// "hear word → pick picture" mechanic makes sense. Abstract concepts,
// pronouns, particles, numbers, and adjectives are excluded.
const PICTURE_GAME_CHARS = new Set([
  "猫","狗","鸟","鱼","兔","马","牛","羊","猪","鸡","熊","虎","狮","象","猴",
  "雨","山","树","花","草","云","雪","月","星","阳","海","河","石",
  "眼","耳","口","鼻","手","脚","腿","牙",
  "饭","水","蛋","面","包","糖","苹","蕉","瓜","菜","果","肉",
  "球","书","笔","门","窗","床","桌","椅","碗","筷","杯",
  "红","黄","蓝","绿","白","黑",
  "家",
]);

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

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

// ---------- character weighting ----------

function charWeight(state, today) {
  let weight = 1;
  if (isDue(state, today)) weight += 3;
  if (state.shaky) weight += 2;
  const daysSince = state.dateLearned ? daysBetweenLocalDateStrings(state.dateLearned, today) : 999;
  if (daysSince <= 2) weight += 3;
  return weight;
}

// Weighted sample without replacement from a list of character entries.
function weightedSample(entries, progress, today, count) {
  const pool = entries.map((entry) => ({ entry, weight: charWeight(progress.characters[entry.char], today) }));
  const picked = [];
  while (picked.length < count && pool.length > 0) {
    const total = pool.reduce((sum, p) => sum + p.weight, 0);
    let roll = Math.random() * total;
    let idx = 0;
    for (; idx < pool.length; idx++) {
      roll -= pool[idx].weight;
      if (roll <= 0) break;
    }
    idx = Math.min(idx, pool.length - 1);
    picked.push(pool[idx].entry.char);
    pool.splice(idx, 1);
  }
  return picked;
}

function learnedEntries(progress, charMap, picturableOnly, today) {
  return Object.keys(progress.characters)
    .filter((char) => !isResting(progress.characters[char], today)) // resting chars are out of the review pool
    .map((char) => charMap.get(char))
    .filter(Boolean)
    .filter((entry) => !picturableOnly || PICTURE_GAME_CHARS.has(entry.char));
}

// Builds the character list for one game: today's new character(s) first
// (guaranteed to appear), then a weighted fill up to the game's round count.
export function charsForGame(gameId, progress, charMap, todaysNewChars, today) {
  const picturable = PICTURE_DEPENDENT_GAMES.has(gameId);
  const rounds = GAME_ROUNDS[gameId] ?? 6;

  const guaranteed = todaysNewChars
    .map((char) => charMap.get(char))
    .filter((entry) => entry && (!picturable || PICTURE_GAME_CHARS.has(entry.char)))
    .map((entry) => entry.char);

  const rest = learnedEntries(progress, charMap, picturable, today).filter((entry) => !guaranteed.includes(entry.char));
  const filler = weightedSample(rest, progress, today, Math.max(0, rounds - guaranteed.length));

  let list = [...guaranteed, ...filler];

  // G1 progressive difficulty: high-confidence characters first, shaky/new
  // last — so early rounds are easy wins and it ramps up.
  if (gameId === "G1") {
    list = [...list].sort((a, b) => {
      const sa = progress.characters[a];
      const sb = progress.characters[b];
      const conf = (s) => (s.box || 1) - (s.shaky ? 2 : 0);
      return conf(sb) - conf(sa);
    });
  }
  return list;
}

// A few wrong-answer characters for a game, drawn from the learned pool
// outside the game's own target list.
function distractorsFor(targetChars, progress, charMap, today) {
  const targetSet = new Set(targetChars);
  const rest = learnedEntries(progress, charMap, false, today).filter((entry) => !targetSet.has(entry.char));
  return weightedSample(rest, progress, today, 4);
}

// ---------- which 3 games ----------

// At least one writing-adjacent game (G1/G4), at least one fast/fun game
// (G3/G8), a third from the rest — and never the exact same lineup as last
// visit (avoid two-in-a-row repeats).
export function buildGameSet(progress) {
  const last = new Set(progress.characterRoom?.lastGames || []);
  const notLast = (g) => !last.has(g);

  const writingPool = ["G1", "G4"].filter(notLast);
  const writing = pick(writingPool.length ? writingPool : ["G1", "G4"]);

  const fastPool = ["G3", "G8"].filter(notLast);
  const fast = pick(fastPool.length ? fastPool : ["G3", "G8"]);

  const restCandidates = ["G5", "G6", "G7"].filter((g) => g !== writing && g !== fast);
  const restPool = restCandidates.filter(notLast);
  const third = pick(restPool.length ? restPool : restCandidates);

  return shuffle([writing, fast, third]);
}

// ---------- new-character intro ----------

async function runNewCharacterIntro(container, entry) {
  await playLine(pickVariant("newSeedAnnouncement", 2));

  container.replaceChildren(
    el(`
      <div class="session-content">
        <div class="big-emoji">${charPictureHtml(entry)}</div>
        <div class="big-character">${entry.char}</div>
      </div>
    `)
  );
  await playSequence([`char_${entry.char}`, `word_${entry.char}`, `sentence_${entry.char}`]);

  container.replaceChildren(el(`<div class="session-content"><div class="writer-target"></div></div>`));
  let target = container.querySelector(".writer-target");
  await animateCharacterOnce(target, entry.char, { speed: 1 });
  await new Promise((r) => setTimeout(r, 500));
  await animateCharacterOnce(target, entry.char, { speed: 0.4, withNumbers: true });
  await new Promise((r) => setTimeout(r, 800));

  for (let i = 0; i < 2; i++) {
    container.replaceChildren(el(`<div class="session-content"><div class="writer-target"></div></div>`));
    target = container.querySelector(".writer-target");
    await new Promise((resolve) => runTraceHintQuiz(target, entry.char, { onComplete: resolve }));
    await new Promise((r) => setTimeout(r, 400));
  }
}

// A character coming back from rest: a warm "还记得这个吗？" with picture +
// audio + one guided trace before it's tested again.
async function runReintro(container, entry) {
  await playLine("restReintro");
  container.replaceChildren(
    el(`
      <div class="session-content">
        <div class="big-emoji">${charPictureHtml(entry)}</div>
        <div class="big-character">${entry.char}</div>
      </div>
    `)
  );
  await playSequence([`char_${entry.char}`, `word_${entry.char}`]);

  container.replaceChildren(el(`<div class="session-content"><div class="writer-target"></div></div>`));
  const target = container.querySelector(".writer-target");
  await new Promise((resolve) => runTraceHintQuiz(target, entry.char, { onComplete: resolve }));
  await new Promise((r) => setTimeout(r, 400));
}

// ---------- game session ----------

async function runGameSession(container, progress, charMap, todaysNewChars) {
  const today = todayLocalDateString();
  startReviewSession(progress); // window for auto-shelve miss counting
  const games = buildGameSet(progress);

  for (const gameId of games) {
    const targetChars = charsForGame(gameId, progress, charMap, todaysNewChars, today);
    if (targetChars.length === 0) continue; // nothing valid for this game (e.g. only particles + a picture game)
    const distractorChars = distractorsFor(targetChars, progress, charMap, today);
    await runGame(gameId, container, { newChars: targetChars, distractorChars, charMap, progress });
    saveProgress(progress);
  }

  if (!progress.characterRoom) progress.characterRoom = {};
  progress.characterRoom.lastGames = games;
  progress.characterRoom.visitCount = (progress.characterRoom.visitCount || 0) + 1;
  saveProgress(progress);
}

// ---------- room shell ----------

async function showMessage(container, emoji, text) {
  container.replaceChildren(
    el(`
      <div class="session-content">
        <div class="big-emoji">${emoji}</div>
        <p class="speaking-summary">${text}</p>
        <button type="button" class="big-button" id="btn-character-done">回到花园</button>
      </div>
    `)
  );
  await new Promise((resolve) => {
    document.getElementById("btn-character-done").addEventListener("click", resolve, { once: true });
  });
}

// Card collection (卡片册), now reached from inside the character room. Same
// cards as the old standalone screen — character, picture, pinyin, word —
// tap to hear it and replay the stroke order. Renders into the room's own
// container and resolves when she taps back.
async function showCardCollection(container, progress, charMap) {
  const learned = Object.entries(progress.characters).sort((a, b) =>
    b[1].dateLearned > a[1].dateLearned ? 1 : -1
  );
  const screen = el(`
    <div class="session-content">
      <div class="studio-header-row">
        <button type="button" class="icon-button" id="btn-cards-room-back" aria-label="返回">⬅️</button>
        <span class="header-title">卡片册 (${learned.length})</span>
      </div>
      <div class="card-grid" id="room-card-grid"></div>
    </div>
  `);
  container.replaceChildren(screen);
  const grid = screen.querySelector("#room-card-grid");
  for (const [char, state] of learned) {
    const entry = charMap.get(char);
    const card = el(`
      <button type="button" class="hanzi-card${state.box === 5 ? " golden" : ""}">
        <span class="card-char">${char}</span>
        <span style="font-size:24px">${charPictureHtml(entry)}</span>
        <span class="card-pinyin">${entry.pinyin}</span>
        <span class="card-pinyin">${entry.word}</span>
      </button>
    `);
    card.addEventListener("click", () => showCardModal(char, charMap, { withReplay: true }));
    grid.appendChild(card);
  }
  await new Promise((resolve) => {
    screen.querySelector("#btn-cards-room-back").addEventListener("click", resolve, { once: true });
  });
}

// Returns "again" / "done" / "cards" / "practice".
async function showSessionEnd(container, playAudio) {
  container.replaceChildren(
    el(`
      <div class="session-content">
        <div class="big-emoji speaking-cheer">🎉🐼</div>
        <p class="speaking-summary">这一轮玩完啦！</p>
        <div class="speaking-end-buttons">
          <button type="button" class="big-button" id="btn-character-again">再玩一轮</button>
          <button type="button" class="big-button" id="btn-character-done">回到花园</button>
          <div class="character-room-extras">
            <button type="button" class="icon-button" id="btn-character-cards">📖 卡片册</button>
            <button type="button" class="icon-button" id="btn-character-practice">✏️ 写字</button>
          </div>
        </div>
      </div>
    `)
  );
  if (playAudio) await playLine(pickVariant("sessionComplete", 3));
  return new Promise((resolve) => {
    document.getElementById("btn-character-again").addEventListener("click", () => resolve("again"), { once: true });
    document.getElementById("btn-character-done").addEventListener("click", () => resolve("done"), { once: true });
    document.getElementById("btn-character-cards").addEventListener("click", () => resolve("cards"), { once: true });
    document.getElementById("btn-character-practice").addEventListener("click", () => resolve("practice"), { once: true });
  });
}

export async function runCharacterRoom(progress, charMap) {
  const screen = document.getElementById("screen-character");
  const container = document.getElementById("character-content");
  screen.classList.remove("hidden");
  history.pushState({ hanziGardenScreen: "screen-character" }, "");
  const exit = () => screen.classList.add("hidden");

  const today = todayLocalDateString();

  try {
    await playLine("characterWelcome");

    // 0. Wake any characters whose rest has ended, and gently reintroduce
    //    them (还记得这个吗？) before they can be tested again.
    processWakeups(progress, today);
    saveProgress(progress);
    const returning = Object.entries(progress.characters)
      .filter(([, state]) => state.needsReintro)
      .map(([char]) => charMap.get(char))
      .filter(Boolean);
    for (const entry of returning) {
      await runReintro(container, entry);
      progress.characters[entry.char].needsReintro = false;
      saveProgress(progress);
    }

    // 1. Intro any new characters scheduled today but not yet learned.
    const newEntries = pickTodaysNewCharacters(progress, Array.from(charMap.values()), today);
    for (const entry of newEntries) {
      await runNewCharacterIntro(container, entry);
      seedCharacter(progress, entry.char, { box: 1, source: "daily", dateLearned: today });
      saveProgress(progress);
    }

    if (Object.keys(progress.characters).length === 0) {
      await showMessage(container, "🐼", "还没有可以玩的字，明天再来学新字吧！");
      return;
    }

    // Characters learned today — guaranteed a slot in each game.
    const todaysNewChars = Object.entries(progress.characters)
      .filter(([, state]) => state.source === "daily" && state.dateLearned === today)
      .map(([char]) => char);

    // 2/3. Game session(s). After each set she can play another, dip into
    //      the card collection or writing practice, or leave.
    let done = false;
    while (!done) {
      await runGameSession(container, progress, charMap, todaysNewChars);
      let choosing = true;
      let firstEnd = true;
      while (choosing) {
        const action = await showSessionEnd(container, firstEnd);
        firstEnd = false;
        if (action === "again") {
          choosing = false;
        } else if (action === "done") {
          choosing = false;
          done = true;
        } else if (action === "cards") {
          await showCardCollection(container, progress, charMap);
        } else if (action === "practice") {
          await runPracticeStudio(progress, charMap);
        }
      }
    }
  } finally {
    exit();
  }
}
