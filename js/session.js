// Orchestrates one full daily session: hello -> watering (reviews) ->
// plant one seed (new character) -> celebration. This module owns
// rendering into #session-content while a session is running.
//
// Visuals here are deliberately plain (emoji + big text) — garden art and
// panda animation states land in a later build step. Stroke animation and
// tracing (TRACE_HINT, WRITE_MEMORY, and the new-character intro) use the
// real Hanzi Writer integration in strokes.js.

import { loadCharacterMap } from "./data.js";
import {
  todayLocalDateString,
  daysBetweenLocalDateStrings,
  markStreakDay,
  seedCharacter,
  saveProgress,
} from "./progress.js";
import { buildDueQueue, pickTodaysNewCharacter, growthStageFor, growAfterCorrect, shrinkAfterSecondMiss } from "./scheduler.js";
import { pickQuizType, pickDistractors, pickStrongestDistractors, QUIZ_TYPES } from "./quiz.js";
import { playLine, playSequence, pickVariant } from "./audio.js";
import { animateCharacterOnce, runTraceHintQuiz, runFaintOutlineTrace, runWriteFromMemoryQuiz } from "./strokes.js";
import { setPandaCheering, animateTodayStamp, triggerConfetti } from "./garden.js";

const MAX_REVIEWS_PER_SESSION = 8;

function el(html) {
  const template = document.createElement("template");
  template.innerHTML = html.trim();
  return template.content.firstElementChild;
}

function clearContent(container) {
  container.innerHTML = "";
}

function buildMetPool(progress, charMap) {
  return Object.entries(progress.characters).map(([char, state]) => ({
    ...charMap.get(char),
    box: state.box,
  }));
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

// ---------- hello ----------

async function showHello(progress) {
  const today = todayLocalDateString();
  const gapDays = progress.lastSessionDate
    ? daysBetweenLocalDateStrings(progress.lastSessionDate, today)
    : 0;

  const key = gapDays > 1 ? pickVariant("welcomeBack", 2) : pickVariant("hello", 5);
  await playLine(key);
}

// ---------- one quiz round for a single character ----------

async function runQuizRound(container, char, charMap, progress) {
  const entry = charMap.get(char);
  const state = progress.characters[char];
  const quizType = pickQuizType(state.box);
  const metPool = buildMetPool(progress, charMap);

  container.replaceChildren();

  if (quizType === QUIZ_TYPES.TRACE_HINT || quizType === QUIZ_TYPES.WRITE_MEMORY) {
    return runTraceQuizRound(container, entry, quizType);
  }

  let choiceCount = 3;
  if (quizType === QUIZ_TYPES.PIC_TO_CHAR) choiceCount = 4;

  const distractors = pickDistractors(entry, metPool, choiceCount - 1);
  const choices = shuffleInPlace([entry, ...distractors]);

  const prompt = el(`<div class="session-content"></div>`);
  container.appendChild(prompt);

  if (quizType === QUIZ_TYPES.AUDIO_TO_CHAR) {
    prompt.appendChild(el(`<div class="big-emoji">🔊</div>`));
    const choiceGrid = el(`<div class="choice-grid"></div>`);
    for (const choice of choices) {
      choiceGrid.appendChild(makeChoiceTile(choice.char, choice.char));
    }
    prompt.appendChild(choiceGrid);
    await playLine(`char_${entry.char}`);
  } else if (quizType === QUIZ_TYPES.CHAR_TO_PIC) {
    prompt.appendChild(el(`<div class="big-character">${entry.char}</div>`));
    const choiceGrid = el(`<div class="choice-grid"></div>`);
    for (const choice of choices) {
      choiceGrid.appendChild(makeChoiceTile(choice.char, choice.emoji));
    }
    prompt.appendChild(choiceGrid);
  } else if (quizType === QUIZ_TYPES.PIC_TO_CHAR) {
    prompt.appendChild(el(`<div class="big-emoji">${entry.emoji}</div>`));
    const choiceGrid = el(`<div class="choice-grid"></div>`);
    for (const choice of choices) {
      choiceGrid.appendChild(makeChoiceTile(choice.char, choice.char));
    }
    prompt.appendChild(choiceGrid);
    await playLine(`word_${entry.char}`);
  }

  const tappedTile = await waitForTap(container, ".choice-tile");
  const isCorrect = tappedTile.dataset.answerChar === entry.char;
  tappedTile.classList.add(isCorrect ? "correct" : "incorrect");
  await new Promise((r) => setTimeout(r, 400));

  return isCorrect;
}

function makeChoiceTile(answerChar, display) {
  const tile = el(`<button class="choice-tile" type="button"></button>`);
  tile.dataset.answerChar = answerChar;
  tile.textContent = display;
  return tile;
}

function shuffleInPlace(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

// Tracing quizzes don't really have a binary pass/fail the way multiple
// choice does — Hanzi Writer already lets her retry each stroke (with hints
// after enough misses) until she gets it, so simply finishing the quiz
// counts as a correct round for the outer watering/box-growth logic.
async function runTraceQuizRound(container, entry, quizType) {
  const prompt = el(`
    <div class="session-content">
      <div class="writer-target"></div>
    </div>
  `);
  container.appendChild(prompt);
  const target = prompt.querySelector(".writer-target");

  await playLine(`char_${entry.char}`);

  return new Promise((resolve) => {
    const onComplete = () => resolve(true);
    if (quizType === QUIZ_TYPES.TRACE_HINT) {
      runTraceHintQuiz(target, entry.char, { onComplete });
    } else {
      runWriteFromMemoryQuiz(target, entry.char, { onComplete });
    }
  });
}

// ---------- watering (reviews) ----------

async function runWatering(container, dueChars, charMap, progress) {
  const today = todayLocalDateString();
  const queue = dueChars.map((char) => ({ char, misses: 0 }));

  while (queue.length > 0) {
    const item = queue.shift();
    const state = progress.characters[item.char];

    const correct = await runQuizRound(container, item.char, charMap, progress);

    if (correct) {
      growAfterCorrect(state, today);
      await playLine(pickVariant("praise", 5));
    } else {
      item.misses += 1;
      if (item.misses < 2) {
        await playLine(pickVariant("tryAgain", 3));
        queue.push(item);
      } else {
        await playLine(`char_${item.char}`);
        shrinkAfterSecondMiss(state, today);
      }
    }

    saveProgress(progress);
  }
}

// ---------- plant one seed (new character intro) ----------

async function runNewSeedIntro(container, entry, progress, charMap) {
  await playLine(pickVariant("newSeedAnnouncement", 2));

  // 1. picture + audio: character, then word, then sentence.
  container.replaceChildren(
    el(`
      <div class="session-content">
        <div class="big-emoji">${entry.emoji}</div>
        <div class="big-character">${entry.char}</div>
      </div>
    `)
  );
  await playSequence([`char_${entry.char}`, `word_${entry.char}`, `sentence_${entry.char}`]);

  // 2. stroke animation: once at full speed, once slow with stroke numbers.
  container.replaceChildren(el(`<div class="session-content"><div class="writer-target"></div></div>`));
  let target = container.querySelector(".writer-target");
  await animateCharacterOnce(target, entry.char, { speed: 1 });
  await new Promise((r) => setTimeout(r, 500));
  await animateCharacterOnce(target, entry.char, { speed: 0.4, withNumbers: true });
  await new Promise((r) => setTimeout(r, 800));

  // 3. trace with hints, twice.
  for (let i = 0; i < 2; i++) {
    container.replaceChildren(el(`<div class="session-content"><div class="writer-target"></div></div>`));
    target = container.querySelector(".writer-target");
    await new Promise((resolve) => runTraceHintQuiz(target, entry.char, { onComplete: resolve }));
    await new Promise((r) => setTimeout(r, 400));
  }

  // 4. trace once more with only a faint outline.
  container.replaceChildren(el(`<div class="session-content"><div class="writer-target"></div></div>`));
  target = container.querySelector(".writer-target");
  await new Promise((resolve) => runFaintOutlineTrace(target, entry.char, { onComplete: resolve }));
  await new Promise((r) => setTimeout(r, 400));

  // 5. confidence check: hear the word, tap the matching picture out of 3,
  // distractors from her strongest known characters so this almost always succeeds.
  const metPool = buildMetPool(progress, charMap);
  const distractors = pickStrongestDistractors(entry, metPool, 2);
  const choices = shuffleInPlace([entry, ...distractors]);

  const confidenceScreen = el(`<div class="session-content"></div>`);
  const choiceGrid = el(`<div class="choice-grid"></div>`);
  for (const choice of choices) {
    choiceGrid.appendChild(makeChoiceTile(choice.char, choice.emoji));
  }
  confidenceScreen.appendChild(el(`<div class="big-emoji">🔊</div>`));
  confidenceScreen.appendChild(choiceGrid);
  container.replaceChildren(confidenceScreen);

  await playLine(`word_${entry.char}`);
  const tapped = await waitForTap(container, ".choice-tile");
  tapped.classList.add(tapped.dataset.answerChar === entry.char ? "correct" : "incorrect");
  await new Promise((r) => setTimeout(r, 400));

  // 6. seed-planting: add to progress at box 1, due tomorrow.
  const today = todayLocalDateString();
  seedCharacter(progress, entry.char, { box: 1, source: "daily", dateLearned: today });
  saveProgress(progress);

  container.replaceChildren(
    el(`
      <div class="session-content">
        <div class="big-emoji">🌱</div>
        <div class="big-character">${entry.char}</div>
        <p>种下新的一颗种子啦！</p>
      </div>
    `)
  );
  await new Promise((r) => setTimeout(r, 1200));
}

// ---------- celebration ----------

async function showCelebration(container, progress) {
  const today = todayLocalDateString();
  markStreakDay(progress, today);
  progress.lastSessionDate = today;
  saveProgress(progress);

  setPandaCheering(true);
  animateTodayStamp(progress);
  triggerConfetti();

  container.replaceChildren(
    el(`
      <div class="session-content">
        <div class="big-emoji">🎉</div>
        <p>今天的花园浇水完成啦！</p>
        <button class="big-button" type="button">回到花园</button>
      </div>
    `)
  );
  await playLine(pickVariant("sessionComplete", 3));
  await waitForTap(container, ".big-button");
  setPandaCheering(false);
}

// ---------- entry point ----------

export async function runDailySession(progress) {
  const charMap = await loadCharacterMap();
  const sessionScreen = document.getElementById("screen-session");
  const container = document.getElementById("session-content");
  const today = todayLocalDateString();

  sessionScreen.classList.remove("hidden");
  clearContent(container);

  await showHello(progress);

  const dueChars = buildDueQueue(progress, today, MAX_REVIEWS_PER_SESSION);
  await runWatering(container, dueChars, charMap, progress);

  const allCharacters = Array.from(charMap.values());
  const newEntry = pickTodaysNewCharacter(progress, allCharacters, today);
  if (newEntry) {
    await runNewSeedIntro(container, newEntry, progress, charMap);
  }

  await showCelebration(container, progress);

  sessionScreen.classList.add("hidden");
}

export { growthStageFor };
