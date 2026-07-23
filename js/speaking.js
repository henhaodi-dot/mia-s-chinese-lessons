// 说说话 (speaking room) — the primary activity in v3. The panda is her
// conversation partner; every visit is a mix of speak-and-replay activities.
// This is the Step 3 skeleton: the room shell + A1 跟我说 (echo words). The
// remaining activities (A2 sentences, A3 dialogue, A4 story, A5 say-it-loud)
// and the voice gallery land in the next step.
//
// Core loop for every speaking activity: panda models → her turn (record) →
// instant playback → compare (🐼 model / 🌸 hers) → participation star.
// Recording never fails her: no mic just skips the room gracefully, and a
// silent take gets one warm retry, then passes anyway.

import { playLine, playSequence } from "./audio.js";
import { todayLocalDateString, daysBetweenLocalDateStrings } from "./progress.js";
import { isDue } from "./scheduler.js";
import { isRecordingSupported, ensureMicPermission, recordWithUI, playBlob } from "./recorder.js";
import { saveRecording } from "./recordings.js";

const ECHO_WORD_COUNT = 4; // ~2 min warm-up; tune after tablet testing

function el(html) {
  const template = document.createElement("template");
  template.innerHTML = html.trim();
  return template.content.firstElementChild;
}

// Weighted toward due + shaky + recently-learned characters, sampled without
// replacement so a round doesn't repeat the same word.
function pickEchoWordItems(progress, charMap, count) {
  const today = todayLocalDateString();
  const scored = Object.keys(progress.characters)
    .map((char) => charMap.get(char))
    .filter(Boolean)
    .map((entry) => {
      const state = progress.characters[entry.char];
      let weight = 1;
      if (isDue(state, today)) weight += 3;
      if (state.shaky) weight += 2;
      const daysSince = state.dateLearned
        ? daysBetweenLocalDateStrings(state.dateLearned, today)
        : 999;
      if (daysSince <= 2) weight += 3;
      return { entry, weight };
    });

  const picked = [];
  const pool = [...scored];
  while (picked.length < count && pool.length > 0) {
    const total = pool.reduce((sum, s) => sum + s.weight, 0);
    let roll = Math.random() * total;
    let idx = 0;
    for (; idx < pool.length; idx++) {
      roll -= pool[idx].weight;
      if (roll <= 0) break;
    }
    idx = Math.min(idx, pool.length - 1);
    picked.push(pool[idx].entry);
    pool.splice(idx, 1);
  }
  return picked;
}

// ---------- A1 跟我说: one word ----------

async function runEchoWord(container, stream, entry) {
  // 1. panda models: the character, then the word using it.
  container.replaceChildren(
    el(`
      <div class="session-content">
        <div class="speaking-modeler">🐼</div>
        <div class="big-character echo-word-text">${entry.word}</div>
      </div>
    `)
  );
  await playSequence([`char_${entry.char}`, `word_${entry.char}`]);

  // 2. her turn — record, with one warm retry if nothing was heard.
  await playLine("echoInstruction");
  let take = await recordWithUI(container, stream);
  if (!take.hadSpeech) {
    await playLine("echoRetry");
    take = await recordWithUI(container, stream);
  }

  // 3. instant playback of her own voice.
  await playLine("listenToYourself");
  await playBlob(take.blob);

  // 4. keep it (best-per-item) so it shows up in her voice gallery later.
  await saveRecording({
    id: `word_${entry.char}`,
    blob: take.blob,
    char: entry.char,
    kind: "word",
    text: entry.word,
    durationMs: take.durationMs,
    rms: take.rms,
    createdAt: Date.now(),
  });

  // 5. compare + participation star.
  await showCompare(container, entry, take.blob);
  return 1;
}

async function showCompare(container, entry, blob) {
  const screen = el(`
    <div class="session-content">
      <div class="big-emoji echo-star">⭐</div>
      <div class="echo-compare-row">
        <button type="button" class="icon-button echo-compare-button" id="btn-replay-model" aria-label="再听一次熊猫的读音">🐼</button>
        <button type="button" class="icon-button echo-compare-button" id="btn-replay-mine" aria-label="再听一次我的声音">🌸</button>
      </div>
      <button type="button" class="big-button" id="btn-echo-continue">继续</button>
    </div>
  `);
  container.replaceChildren(screen);
  await playLine("echoDone");

  screen.querySelector("#btn-replay-model").addEventListener("click", () => playLine(`word_${entry.char}`));
  screen.querySelector("#btn-replay-mine").addEventListener("click", () => playBlob(blob));

  await new Promise((resolve) => {
    screen.querySelector("#btn-echo-continue").addEventListener("click", resolve, { once: true });
  });
}

// ---------- room shell ----------

async function showMessage(container, emoji, text) {
  container.replaceChildren(
    el(`
      <div class="session-content">
        <div class="big-emoji">${emoji}</div>
        <p class="speaking-summary">${text}</p>
        <button type="button" class="big-button" id="btn-speaking-done">回到花园</button>
      </div>
    `)
  );
  await new Promise((resolve) => {
    document.getElementById("btn-speaking-done").addEventListener("click", resolve, { once: true });
  });
}

async function showSummary(container, count) {
  container.replaceChildren(
    el(`
      <div class="session-content">
        <div class="big-emoji speaking-cheer">🎤🐼</div>
        <p class="speaking-summary">今天录了 ${count} 个声音！</p>
        <button type="button" class="big-button" id="btn-speaking-done">回到花园</button>
      </div>
    `)
  );
  await playLine("speakingSummary");
  await new Promise((resolve) => {
    document.getElementById("btn-speaking-done").addEventListener("click", resolve, { once: true });
  });
}

export async function runSpeakingRoom(progress, charMap) {
  const screen = document.getElementById("screen-speaking");
  const container = document.getElementById("speaking-content");
  screen.classList.remove("hidden");
  history.pushState({ hanziGardenScreen: "screen-speaking" }, "");
  const exit = () => screen.classList.add("hidden");

  if (!isRecordingSupported()) {
    await showMessage(container, "🐼", "这台设备好像不能录音，我们下次再一起说话吧！");
    exit();
    return;
  }

  await playLine("speakingWelcome");

  const stream = await ensureMicPermission(container, progress);
  if (!stream) {
    await showMessage(container, "🐼🎤", "熊猫需要麦克风才能听你说话。请家长在设置里打开麦克风，再回来玩。");
    exit();
    return;
  }

  try {
    const items = pickEchoWordItems(progress, charMap, ECHO_WORD_COUNT);
    if (items.length === 0) {
      await showMessage(container, "🐼", "还没有学过的字，先去认认字种一颗种子吧！");
    } else {
      await playLine("echoWordIntro");
      let recorded = 0;
      for (const entry of items) {
        recorded += await runEchoWord(container, stream, entry);
      }
      await showSummary(container, recorded);
    }
  } finally {
    // Always release the mic when leaving the room.
    stream.getTracks().forEach((track) => track.stop());
    exit();
  }
}
