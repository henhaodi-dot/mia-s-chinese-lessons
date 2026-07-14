// Round 4 — 出门考 (exit test): the strongest single predictor of next-day
// retention, so it runs with no hints available until she's genuinely
// stuck (3 misses), and misses trigger an immediate relearn + one retest
// rather than just marking it wrong and moving on.

import { playLine, pickVariant } from "./audio.js";
import { setShaky } from "./progress.js";
import { runWriteFromMemoryQuiz, animateCharacterOnce } from "./strokes.js";

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

function makeTile(answerChar, display) {
  const tile = el(`<button class="choice-tile" type="button"></button>`);
  tile.dataset.answerChar = answerChar;
  tile.textContent = display;
  return tile;
}

// ---------- (a) write from memory, hints locked until 3 misses ----------

async function runWriteFromMemoryPart(container, entry) {
  const screen = el(`
    <div class="session-content">
      <div class="writer-target"></div>
    </div>
  `);
  container.replaceChildren(screen);
  const target = screen.querySelector(".writer-target");

  let hintUsed = false;
  const resultPromise = new Promise((resolve) => {
    runWriteFromMemoryQuiz(target, entry.char, {
      showHintAfterMisses: 3,
      onMistake: (data) => {
        if (data.mistakesOnStroke >= 3) hintUsed = true;
      },
      onComplete: () => resolve(),
    });
  });

  await playLine("exitTestIntro");
  await resultPromise;
  return { missed: hintUsed };
}

// ---------- (b) meaning question: AUDIO_TO_PIC or word fill-blank ----------

async function runMeaningPart(container, entry, distractorEntries) {
  const useAudioToPic = Math.random() < 0.5;
  const choices = shuffle([entry, ...distractorEntries.slice(0, 2)]);
  let missed = false;

  const screen = el(`<div class="session-content"></div>`);
  const choiceGrid = el(`<div class="choice-grid"></div>`);

  if (useAudioToPic) {
    screen.appendChild(el(`<div class="big-emoji">🔊</div>`));
    for (const choice of choices) choiceGrid.appendChild(makeTile(choice.char, choice.emoji));
  } else {
    const blankWord = entry.word.replace(entry.char, "＿");
    screen.appendChild(el(`<div class="big-character" style="font-size:56px">${blankWord}</div>`));
    for (const choice of choices) choiceGrid.appendChild(makeTile(choice.char, choice.char));
  }
  screen.appendChild(choiceGrid);
  container.replaceChildren(screen);

  const tapPromise = waitForTap(container, ".choice-tile");
  await playLine(useAudioToPic ? `char_${entry.char}` : `word_${entry.char}`);
  let tile = await tapPromise;

  while (tile.dataset.answerChar !== entry.char) {
    missed = true;
    tile.classList.add("incorrect");
    await playLine(pickVariant("tryAgain", 3));
    await new Promise((r) => setTimeout(r, 300));
    const retryPromise = waitForTap(container, ".choice-tile");
    tile = await retryPromise;
  }
  tile.classList.add("correct");
  await new Promise((r) => setTimeout(r, 300));

  return { missed };
}

// ---------- relearn card ----------

async function showRelearnCard(container, entry) {
  await playLine("relearnLine");
  const screen = el(`
    <div class="session-content">
      <div class="big-emoji">${entry.emoji}</div>
      <div class="writer-target"></div>
    </div>
  `);
  container.replaceChildren(screen);
  const target = screen.querySelector(".writer-target");

  await playLine(`char_${entry.char}`);
  await animateCharacterOnce(target, entry.char, { speed: 0.6 });
  // A single faint-outline trace, capped at 10s total for this card so a
  // slow trace never blows past the round's time budget.
  await Promise.race([
    new Promise((resolve) => {
      import("./strokes.js").then(({ runFaintOutlineTrace }) => {
        runFaintOutlineTrace(target, entry.char, { onComplete: resolve });
      });
    }),
    new Promise((resolve) => setTimeout(resolve, 10000)),
  ]);
}

// ---------- one character's full exit-test unit ----------

async function testOneCharacter(container, entry, distractorEntries, progress) {
  const partA = await runWriteFromMemoryPart(container, entry);
  const partB = await runMeaningPart(container, entry, distractorEntries);
  let missed = partA.missed || partB.missed;

  if (missed) {
    await showRelearnCard(container, entry);
    const retestA = await runWriteFromMemoryPart(container, entry);
    const retestB = await runMeaningPart(container, entry, distractorEntries);
    const stillMissed = retestA.missed || retestB.missed;
    setShaky(progress, entry.char, stillMissed);
    return stillMissed ? 1 : 2;
  }

  setShaky(progress, entry.char, false);
  return 3;
}

// ---------- entry point ----------

// Returns { [char]: starCount } for every character in `newEntries`.
export async function runExitTest(container, newEntries, allMetEntries, progress) {
  const stars = {};
  const order = shuffle(newEntries);

  for (const entry of order) {
    const distractorEntries = shuffle(allMetEntries.filter((e) => e.char !== entry.char)).slice(0, 4);
    stars[entry.char] = await testOneCharacter(container, entry, distractorEntries, progress);
  }

  return stars;
}
