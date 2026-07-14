// Orchestrates one full daily session (v2): hello -> Round 1 认识 (meet
// today's new characters) -> Round 2 浇水 (spaced-repetition reviews) ->
// Round 3 游戏场 (3 rotating mini-games) -> Round 3.5 今日小剧场 (story) ->
// Round 4 出门考 (exit test) -> celebration with stars. This module owns
// rendering into #session-content while a session is running.
//
// The gap between Round 1 (meeting new characters) and Round 3 (playing
// with them) is deliberate — Round 2 sits in between so retrieval doesn't
// happen back-to-back with first exposure. See the design doc in the v2
// upgrade prompt for why this structure exists.

import { loadCharacterMap } from "./data.js";
import {
  todayLocalDateString,
  daysBetweenLocalDateStrings,
  markStreakDay,
  seedCharacter,
  saveProgress,
  appendSessionLogEntry,
} from "./progress.js";
import {
  buildDueQueue,
  pickTodaysNewCharacters,
  countAllDue,
  throttledNewCountCap,
  growthStageFor,
  growAfterCorrect,
  shrinkAfterSecondMiss,
} from "./scheduler.js";
import { pickQuizType, pickDistractors, QUIZ_TYPES } from "./quiz.js";
import { playLine, playSequence, pickVariant } from "./audio.js";
import { animateCharacterOnce, runTraceHintQuiz, runWriteFromMemoryQuiz } from "./strokes.js";
import { setPandaCheering, animateTodayStamp, triggerConfetti } from "./garden.js";
import { pickGamesForToday, runGame } from "./games.js";
import { runExitTest } from "./exitTest.js";
import { getStoryForTriple, warmStoriesCache } from "./stories.js";

const MAX_REVIEWS_PER_SESSION = 8;
const SESSION_TIME_LIMIT_MS = 20 * 60 * 1000;

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
    function handler(e) {
      const tile = e.target.closest(selector);
      if (!tile) return; // a miss shouldn't cost us the listener — keep waiting
      container.removeEventListener("click", handler);
      resolve(tile);
    }
    container.addEventListener("click", handler);
  });
}

function shuffleInPlace(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

function makeChoiceTile(answerChar, display) {
  const tile = el(`<button class="choice-tile" type="button"></button>`);
  tile.dataset.answerChar = answerChar;
  tile.textContent = display;
  return tile;
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

// ---------- Round 1: 认识 (meet today's new characters) ----------

async function runMeetRound(container, newEntries) {
  for (const entry of newEntries) {
    await playLine(pickVariant("newSeedAnnouncement", 2));

    // picture + audio: character, then word, then sentence.
    container.replaceChildren(
      el(`
        <div class="session-content">
          <div class="big-emoji">${entry.emoji}</div>
          <div class="big-character">${entry.char}</div>
        </div>
      `)
    );
    await playSequence([`char_${entry.char}`, `word_${entry.char}`, `sentence_${entry.char}`]);

    // stroke animation: once at full speed, once slow with stroke numbers.
    container.replaceChildren(el(`<div class="session-content"><div class="writer-target"></div></div>`));
    let target = container.querySelector(".writer-target");
    await animateCharacterOnce(target, entry.char, { speed: 1 });
    await new Promise((r) => setTimeout(r, 500));
    await animateCharacterOnce(target, entry.char, { speed: 0.4, withNumbers: true });
    await new Promise((r) => setTimeout(r, 800));

    // trace with hints, twice.
    for (let i = 0; i < 2; i++) {
      container.replaceChildren(el(`<div class="session-content"><div class="writer-target"></div></div>`));
      target = container.querySelector(".writer-target");
      await new Promise((resolve) => runTraceHintQuiz(target, entry.char, { onComplete: resolve }));
      await new Promise((r) => setTimeout(r, 400));
    }
  }
}

// ---------- one quiz round for a single character (Round 2: watering) ----------

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
  }

  const tapPromise = waitForTap(container, ".choice-tile");

  if (quizType === QUIZ_TYPES.AUDIO_TO_CHAR) {
    await playLine(`char_${entry.char}`);
  } else if (quizType === QUIZ_TYPES.PIC_TO_CHAR) {
    await playLine(`word_${entry.char}`);
  }

  const tappedTile = await tapPromise;
  const isCorrect = tappedTile.dataset.answerChar === entry.char;
  tappedTile.classList.add(isCorrect ? "correct" : "incorrect");
  await new Promise((r) => setTimeout(r, 400));

  return isCorrect;
}

async function runTraceQuizRound(container, entry, quizType) {
  const prompt = el(`
    <div class="session-content">
      <div class="writer-target"></div>
    </div>
  `);
  container.appendChild(prompt);
  const target = prompt.querySelector(".writer-target");

  const resultPromise = new Promise((resolve) => {
    const onComplete = () => resolve(true);
    if (quizType === QUIZ_TYPES.TRACE_HINT) {
      runTraceHintQuiz(target, entry.char, { onComplete });
    } else {
      runWriteFromMemoryQuiz(target, entry.char, { onComplete });
    }
  });

  await playLine(`char_${entry.char}`);
  return resultPromise;
}

// ---------- Round 2: 浇水 (watering / reviews) ----------

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

// ---------- Round 3: 游戏场 (game arcade) ----------

async function runGameArcade(container, newEntries, progress, charMap, sessionStart) {
  const today = todayLocalDateString();
  const games = pickGamesForToday(today);
  const newChars = newEntries.map((e) => e.char);

  // Distractors: 1-2 recently reviewed characters, preferring ones marked
  // shaky from a previous exit test so they get extra practice.
  const metPool = buildMetPool(progress, charMap).filter((e) => !newChars.includes(e.char));
  const shakyFirst = shuffleInPlace([...metPool]).sort(
    (a, b) => (progress.characters[b.char]?.shaky ? 1 : 0) - (progress.characters[a.char]?.shaky ? 1 : 0)
  );
  const distractorChars = shakyFirst.slice(0, 2).map((e) => e.char);

  for (const gameId of games) {
    if (Date.now() - sessionStart > SESSION_TIME_LIMIT_MS) {
      break; // guardrail: she wandered off — skip straight to the exit test
    }
    await runGame(gameId, container, { newChars, distractorChars, charMap, progress });
    saveProgress(progress);
  }
}

// ---------- Round 3.5: 今日小剧场 (daily micro-story) ----------

async function runStoryRound(container, newEntries, charMap) {
  const chars = newEntries.map((e) => e.char);
  const story = getStoryForTriple(chars);
  if (!story) return; // mismatch (known-list changed since stories.json was built) — skip gracefully

  await playLine("storyIntro");

  const highlighted = story.text.replace(
    new RegExp(`[${chars.join("")}]`, "g"),
    (m) => `<span class="story-highlight">${m}</span>`
  );

  container.replaceChildren(
    el(`
      <div class="session-content">
        <p class="story-text">${highlighted}</p>
      </div>
    `)
  );
  await playLine(story.audioKey);

  const { question } = story;
  const choices = shuffleInPlace([...question.options]);
  const screen = el(`
    <div class="session-content">
      <div class="big-emoji">🔊</div>
      <div class="choice-grid"></div>
    </div>
  `);
  const grid = screen.querySelector(".choice-grid");
  for (const opt of choices) {
    const tile = el(`<button class="choice-tile" type="button"></button>`);
    tile.dataset.answerChar = opt.char;
    tile.textContent = opt.emoji;
    grid.appendChild(tile);
  }
  container.replaceChildren(screen);

  const tapPromise = waitForTap(container, ".choice-tile");
  await playLine(question.audioKey);
  const tapped = await tapPromise;
  tapped.classList.add(tapped.dataset.answerChar === question.answer ? "correct" : "incorrect");
  await new Promise((r) => setTimeout(r, 500));
}

// ---------- Round 4: 出门考 (exit test) + celebration ----------

function starLineKey(stars) {
  return `star_${stars}`;
}

async function showCelebration(container, progress, exitStars) {
  const today = todayLocalDateString();
  markStreakDay(progress, today);
  progress.lastSessionDate = today;
  saveProgress(progress);

  setPandaCheering(true);
  animateTodayStamp(progress);
  triggerConfetti();

  const starRows = Object.entries(exitStars)
    .map(([char, stars]) => `<div class="exit-star-row"><span class="big-character" style="font-size:32px">${char}</span> ${"⭐".repeat(stars)}</div>`)
    .join("");

  container.replaceChildren(
    el(`
      <div class="session-content">
        <div class="big-emoji">🎉</div>
        <p>今天的花园浇水完成啦！</p>
        ${starRows}
        <button class="big-button" type="button">回到花园</button>
      </div>
    `)
  );

  const tapPromise = waitForTap(container, ".big-button");
  await playLine(pickVariant("sessionComplete", 3));
  for (const stars of Object.values(exitStars)) {
    await playLine(starLineKey(stars));
  }
  await tapPromise;
  setPandaCheering(false);
}

// ---------- entry point ----------

export async function runDailySession(progress) {
  const sessionStart = Date.now();
  const charMap = await loadCharacterMap();
  await warmStoriesCache();
  const sessionScreen = document.getElementById("screen-session");
  const container = document.getElementById("session-content");
  const today = todayLocalDateString();

  sessionScreen.classList.remove("hidden");
  clearContent(container);

  await showHello(progress);

  const dueCountToday = countAllDue(progress, today);
  const throttleCap = throttledNewCountCap(dueCountToday);

  const dueChars = buildDueQueue(progress, today, MAX_REVIEWS_PER_SESSION);
  const allCharacters = Array.from(charMap.values());
  const newEntries = pickTodaysNewCharacters(progress, allCharacters, today);

  // Round 1: meet today's new characters (before they're added to
  // progress.characters, so Round 2's review queue can't pick them up
  // a second time in the same session).
  if (newEntries.length > 0) {
    await runMeetRound(container, newEntries);
    for (const entry of newEntries) {
      seedCharacter(progress, entry.char, { box: 1, source: "daily", dateLearned: today });
    }
    saveProgress(progress);
  }

  // Round 2: watering (reviews).
  await runWatering(container, dueChars, charMap, progress);

  let exitStars = {};
  if (newEntries.length > 0) {
    // Round 3: game arcade (skipped if the session guardrail already
    // tripped waiting through Round 1/2, so she still gets the exit test).
    if (Date.now() - sessionStart <= SESSION_TIME_LIMIT_MS) {
      await runGameArcade(container, newEntries, progress, charMap, sessionStart);
    }

    // Round 3.5: today's micro-story.
    if (Date.now() - sessionStart <= SESSION_TIME_LIMIT_MS) {
      await runStoryRound(container, newEntries, charMap);
    }

    // Round 4: exit test.
    const metPool = buildMetPool(progress, charMap);
    exitStars = await runExitTest(container, newEntries, metPool, progress);
    saveProgress(progress);
  }

  appendSessionLogEntry(progress, {
    date: today,
    newChars: newEntries.map((e) => e.char),
    exitStars,
    throttled: throttleCap !== null ? String(throttleCap) : false,
  });
  saveProgress(progress);

  await showCelebration(container, progress, exitStars);

  sessionScreen.classList.add("hidden");
}

export { growthStageFor };
