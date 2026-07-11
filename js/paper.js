// Paper mode (写字时间): weekend companion for practicing in a workbook
// while the tablet demonstrates. Shows this week's characters one at a
// time as a large, slow, looping stroke animation; "我写了三遍" awards a
// sticker and moves to the next character.

import { todayLocalDateString, saveProgress, awardSticker, getStickerCount } from "./progress.js";
import { getThisWeeksCharacters } from "./weekly.js";
import { playLine } from "./audio.js";
import { animateCharacterOnce } from "./strokes.js";

function el(html) {
  const template = document.createElement("template");
  template.innerHTML = html.trim();
  return template.content.firstElementChild;
}

let loopStopped = true;

async function loopSlowAnimation(target, char) {
  loopStopped = false;
  while (!loopStopped) {
    await animateCharacterOnce(target, char, { speed: 0.5 });
    if (loopStopped) break;
    await new Promise((r) => setTimeout(r, 700));
  }
}

function stopLoop() {
  loopStopped = true;
}

export async function runPaperMode(progress, charMap) {
  const screen = document.getElementById("screen-paper");
  const container = document.getElementById("paper-content");
  screen.classList.remove("hidden");

  const characters = getThisWeeksCharacters(progress, charMap);

  if (characters.length === 0) {
    container.replaceChildren(
      el(`
        <div class="session-content">
          <div class="big-emoji">🐼</div>
          <p>还没有可以练习的字，先去种一颗种子吧！</p>
          <button class="big-button" type="button" id="btn-paper-done">回到花园</button>
        </div>
      `)
    );
    document.getElementById("btn-paper-done").addEventListener("click", () => screen.classList.add("hidden"));
    return;
  }

  let index = 0;
  let stickersEarnedThisSession = 0;

  async function showCharacter() {
    const entry = characters[index];
    container.replaceChildren(
      el(`
        <div class="session-content">
          <p class="paper-progress">${index + 1} / ${characters.length}</p>
          <div class="writer-target"></div>
          <button class="big-button" type="button" id="btn-wrote-three">✏️ 我写了三遍</button>
        </div>
      `)
    );
    const target = container.querySelector(".writer-target");

    // Attach the click listener before awaiting the audio — a child who
    // taps "wrote it three times" while the line is still playing
    // shouldn't have that tap silently dropped.
    document.getElementById("btn-wrote-three").addEventListener("click", async () => {
      stopLoop();
      awardSticker(progress, entry.char);
      stickersEarnedThisSession++;
      saveProgress(progress);
      await showStickerAward(entry);

      index++;
      if (index < characters.length) {
        showCharacter();
      } else {
        showCompletion();
      }
    });

    await playLine(`char_${entry.char}`);
    loopSlowAnimation(target, entry.char);
  }

  async function showStickerAward(entry) {
    const total = getStickerCount(progress, entry.char);
    container.replaceChildren(
      el(`
        <div class="session-content">
          <div class="big-emoji sticker-pop">🐼🌟</div>
          <div class="big-character">${entry.char}</div>
          <p>获得一枚熊猫贴纸！（一共 ${total} 枚）</p>
        </div>
      `)
    );
    await new Promise((r) => setTimeout(r, 1400));
  }

  function showCompletion() {
    container.replaceChildren(
      el(`
        <div class="session-content">
          <div class="big-emoji">🎉</div>
          <p>写字时间结束啦！今天写了 ${stickersEarnedThisSession} 个字。</p>
          <button class="big-button" type="button" id="btn-paper-done">回到花园</button>
        </div>
      `)
    );
    document.getElementById("btn-paper-done").addEventListener("click", () => {
      stopLoop();
      screen.classList.add("hidden");
    });
  }

  await showCharacter();
}

export function exitPaperMode() {
  stopLoop();
  document.getElementById("screen-paper").classList.add("hidden");
}
