// 说说话 (speaking room) — the primary v3 activity. The panda is her
// conversation partner; each visit is a lively mix of speak-and-replay
// activities, all built on the same loop: panda models → she records →
// she hears herself → compares 🐼/🌸 → participation star.
//
// Activities:
//   A1 跟我说      echo words       (warm-up)
//   A2 跟我读句子   echo sentences   (warm-up)
//   A3 熊猫问你     mini-dialogue    (meaty, conversation)
//   A4 讲故事       retell a line    (meaty)
//   A5 大声说       say it loud      (energy break — no recording, volume fun)
//
// A visit picks 3–4 of these (a warm-up first, a meaty one in the middle,
// A5 as an optional break), then ends on a voice-collection summary.
// Recording never fails her: no mic just skips the room, a silent take gets
// one warm retry then passes.

import { playLine, playSequence } from "./audio.js";
import { todayLocalDateString, daysBetweenLocalDateStrings, saveProgress } from "./progress.js";
import { isDue } from "./scheduler.js";
import { isRecordingSupported, ensureMicPermission, recordWithUI, playBlob } from "./recorder.js";
import { saveRecording } from "./recordings.js";
import { loadDialogues } from "./data.js";
import { getAllStories, warmStoriesCache } from "./stories.js";
import { runVoiceGallery } from "./voiceGallery.js";

const A1_WORD_COUNT = 4;
const A2_SENTENCE_COUNT = 3;
const A3_EXCHANGE_COUNT = 2;
const A5_ITEM_COUNT = 7;
const PUNCT = /[，。！？、；：""''…—·]/;

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

// Weighted toward due + shaky + recently-learned, sampled without
// replacement. Shared by A1/A2/A5.
function pickWeightedChars(progress, charMap, count) {
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

// ---------- shared record → playback → compare → star beat ----------

async function echoOnce(container, stream, { showHtml, modelKeys, saveId, saveMeta, compareModelKey }) {
  container.replaceChildren(el(showHtml));
  await playSequence(modelKeys);

  await playLine("echoInstruction");
  let take = await recordWithUI(container, stream);
  if (!take.hadSpeech) {
    await playLine("echoRetry");
    take = await recordWithUI(container, stream);
  }

  await playLine("listenToYourself");
  await playBlob(take.blob);

  if (saveId) {
    await saveRecording({
      id: saveId,
      blob: take.blob,
      durationMs: take.durationMs,
      rms: take.rms,
      createdAt: Date.now(),
      modelKey: compareModelKey, // so the gallery can replay the model
      ...saveMeta,
    });
  }

  await showCompare(container, compareModelKey, take.blob);
  return 1;
}

async function showCompare(container, modelKey, blob) {
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
  screen.querySelector("#btn-replay-model").addEventListener("click", () => playLine(modelKey));
  screen.querySelector("#btn-replay-mine").addEventListener("click", () => playBlob(blob));
  await new Promise((resolve) => {
    screen.querySelector("#btn-echo-continue").addEventListener("click", resolve, { once: true });
  });
}

// ---------- A1 跟我说 (echo words) ----------

async function runEchoWords(container, stream, progress, charMap) {
  const items = pickWeightedChars(progress, charMap, A1_WORD_COUNT);
  if (items.length === 0) return 0;
  await playLine("echoWordIntro");
  let n = 0;
  for (const entry of items) {
    n += await echoOnce(container, stream, {
      showHtml: `<div class="session-content"><div class="speaking-modeler">🐼</div><div class="big-character echo-word-text">${entry.word}</div></div>`,
      modelKeys: [`char_${entry.char}`, `word_${entry.char}`],
      saveId: `word_${entry.char}`,
      saveMeta: { char: entry.char, kind: "word", text: entry.word },
      compareModelKey: `word_${entry.char}`,
    });
  }
  return n;
}

// ---------- A2 跟我读句子 (echo sentences) ----------

// Known characters highlighted; unknown ones get a small pinyin ruby above
// (their own standalone pinyin from charMap — no fragile sentence-pinyin
// parsing needed).
function renderSentenceHtml(sentence, progress, charMap) {
  let html = "";
  for (const ch of sentence) {
    if (PUNCT.test(ch)) {
      html += `<span class="sent-punct">${ch}</span>`;
      continue;
    }
    const entry = charMap.get(ch);
    if (progress.characters[ch]) {
      html += `<span class="sent-known">${ch}</span>`;
    } else if (entry) {
      html += `<ruby class="sent-unknown">${ch}<rt>${entry.pinyin}</rt></ruby>`;
    } else {
      html += `<span>${ch}</span>`;
    }
  }
  return html;
}

async function runEchoSentences(container, stream, progress, charMap) {
  const items = pickWeightedChars(progress, charMap, A2_SENTENCE_COUNT);
  if (items.length === 0) return 0;
  await playLine("echoSentenceIntro");
  let n = 0;
  for (const entry of items) {
    const sentenceHtml = renderSentenceHtml(entry.sentence, progress, charMap);
    n += await echoOnce(container, stream, {
      showHtml: `<div class="session-content"><div class="speaking-modeler">🐼</div><div class="speaking-sentence">${sentenceHtml}</div></div>`,
      modelKeys: [`sentence_${entry.char}`],
      saveId: `sentence_${entry.char}`,
      saveMeta: { char: entry.char, kind: "sentence", text: entry.sentence },
      compareModelKey: `sentence_${entry.char}`,
    });
  }
  return n;
}

// ---------- A3 熊猫问你 (panda asks you) ----------

function pickDialogues(progress, dialogues, count) {
  if (dialogues.length === 0) return [];
  const recent = new Set((progress.speaking?.recentDialogueIds || []).slice(-8));
  const fresh = shuffle(dialogues.filter((d) => !recent.has(d.id)));
  const stale = shuffle(dialogues.filter((d) => recent.has(d.id)));
  return [...fresh, ...stale].slice(0, count);
}

function rememberDialogue(progress, id) {
  if (!progress.speaking) progress.speaking = {};
  if (!progress.speaking.recentDialogueIds) progress.speaking.recentDialogueIds = [];
  progress.speaking.recentDialogueIds.push(id);
  progress.speaking.recentDialogueIds = progress.speaking.recentDialogueIds.slice(-16);
  saveProgress(progress);
}

async function runOneDialogue(container, stream, dialogue) {
  // panda asks
  container.replaceChildren(
    el(`
      <div class="session-content">
        <div class="speaking-modeler">🐼</div>
        <div class="dialogue-question">${dialogue.pandaQuestion}</div>
      </div>
    `)
  );
  await playLine(dialogue.pandaQuestionAudioKey);

  // three answer cards — every answer is valid
  const screen = el(`
    <div class="session-content">
      <div class="dialogue-question-small">${dialogue.pandaQuestion}</div>
      <div class="dialogue-answers"></div>
    </div>
  `);
  const grid = screen.querySelector(".dialogue-answers");
  for (const answer of dialogue.answers) {
    const card = el(`
      <button type="button" class="dialogue-answer-card" data-key="${answer.audioKey}">
        <span class="dialogue-answer-emoji">${answer.emoji}</span>
        <span class="dialogue-answer-text">${answer.text}</span>
      </button>
    `);
    card.addEventListener("click", () => playLine(answer.audioKey)); // hear it on tap
    grid.appendChild(card);
  }
  container.replaceChildren(screen);

  const chosen = await new Promise((resolve) => {
    grid.addEventListener("click", (e) => {
      const card = e.target.closest(".dialogue-answer-card");
      if (card) resolve(card.dataset.key);
    });
  });
  const answer = dialogue.answers.find((a) => a.audioKey === chosen);

  // she SAYS her answer (records) — the recording is the point, not a score
  await echoOnce(container, stream, {
    showHtml: `<div class="session-content"><div class="dialogue-answer-emoji big">${answer.emoji}</div><div class="big-character echo-word-text">${answer.text}</div></div>`,
    modelKeys: [answer.audioKey],
    saveId: `dialogue_${answer.audioKey}`,
    saveMeta: { char: null, kind: "dialogue", text: answer.text },
    compareModelKey: answer.audioKey,
  });

  // panda responds to her choice
  const followUp = dialogue.pandaFollowUps[answer.audioKey];
  if (followUp) {
    container.replaceChildren(
      el(`
        <div class="session-content">
          <div class="speaking-modeler">🐼</div>
          <div class="dialogue-followup">${followUp.text}</div>
        </div>
      `)
    );
    await playLine(followUp.audioKey);
    await new Promise((r) => setTimeout(r, 700));
  }
  return 1;
}

async function runDialogues(container, stream, progress) {
  const dialogues = await loadDialogues();
  const chosen = pickDialogues(progress, dialogues, A3_EXCHANGE_COUNT);
  if (chosen.length === 0) return 0;
  await playLine("dialogueIntro");
  let n = 0;
  for (const dialogue of chosen) {
    n += await runOneDialogue(container, stream, dialogue);
    rememberDialogue(progress, dialogue.id);
  }
  return n;
}

// ---------- A4 讲故事 (retell a story line) ----------

function firstSentenceOf(text) {
  const match = text.match(/^[^。！？]*[。！？]?/);
  return match ? match[0] : text;
}

async function runStoryRetell(container, stream, progress, charMap) {
  await warmStoriesCache();
  const stories = await getAllStories();
  if (stories.length === 0) return 0;

  // Prefer a story whose characters she mostly knows.
  const known = new Set(Object.keys(progress.characters));
  const scored = stories
    .map((s) => ({ s, knownCount: (s.chars || []).filter((c) => known.has(c)).length }))
    .sort((a, b) => b.knownCount - a.knownCount);
  const story = scored[Math.floor(Math.random() * Math.min(3, scored.length))].s;

  // panda tells the whole story
  await playLine("storyRetellIntro");
  container.replaceChildren(
    el(`
      <div class="session-content">
        <div class="speaking-modeler">🐼</div>
        <p class="speaking-sentence">${renderSentenceHtml(story.text, progress, charMap)}</p>
      </div>
    `)
  );
  await playLine(story.audioKey);
  await new Promise((r) => setTimeout(r, 500));

  // she retells the first line (she just heard the whole story, so no
  // separate per-line model audio is needed — she echoes from memory)
  const line = firstSentenceOf(story.text);
  await playLine("sayThisLine");
  const n = await echoOnce(container, stream, {
    showHtml: `<div class="session-content"><div class="speaking-retell-label">跟熊猫讲这一句：</div><p class="speaking-sentence">${renderSentenceHtml(line, progress, charMap)}</p></div>`,
    modelKeys: [story.audioKey],
    saveId: `storyline_${story.audioKey}`,
    saveMeta: { char: null, kind: "storyline", text: line },
    compareModelKey: story.audioKey,
  });
  return n;
}

// ---------- A5 大声说 (say it loud) — energy break, no recording ----------

async function runSayItLoud(container, stream, progress, charMap) {
  const items = pickWeightedChars(progress, charMap, A5_ITEM_COUNT);
  if (items.length === 0) return 0;

  await playLine("sayLoudIntro");

  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  const actx = new AudioContextClass();
  const source = actx.createMediaStreamSource(stream);
  const analyser = actx.createAnalyser();
  analyser.fftSize = 512;
  source.connect(analyser);
  const data = new Float32Array(analyser.fftSize);

  // Listens for `ms`, live-scaling the on-screen word with her volume;
  // returns the peak RMS heard. Completion is driven by a real setTimeout,
  // not the sampling loop — a rAF/interval can pause or throttle in a
  // backgrounded tab, and the round must never hang waiting on it.
  function listenVolume(wordEl, ms) {
    return new Promise((resolve) => {
      let peak = 0;
      const sample = setInterval(() => {
        analyser.getFloatTimeDomainData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i++) sum += data[i] * data[i];
        const rms = Math.sqrt(sum / data.length);
        if (rms > peak) peak = rms;
        if (wordEl) wordEl.style.transform = `scale(${1 + Math.min(1.4, rms * 9)})`;
      }, 80);
      setTimeout(() => {
        clearInterval(sample);
        resolve(peak);
      }, ms);
    });
  }

  let i = 0;
  for (const entry of items) {
    const listenMs = Math.max(1400, 2600 - i * 160); // speeds up
    const screen = el(`
      <div class="session-content">
        <div class="loud-banner">🔊 大声说！</div>
        <div class="loud-word">${entry.word}</div>
      </div>
    `);
    container.replaceChildren(screen);
    await playLine(`word_${entry.char}`);
    const peak = await listenVolume(screen.querySelector(".loud-word"), listenMs);
    // a little cheer scaled to how loud she was
    screen.querySelector(".loud-word").classList.add(peak > 0.08 ? "loud-big" : "loud-ok");
    await new Promise((r) => setTimeout(r, 350));
    i++;
  }

  source.disconnect();
  await actx.close().catch(() => {});
  return 0; // energy break — nothing saved
}

// ---------- visit orchestration ----------

function buildVisit() {
  const warmups = shuffle([runEchoWords, runEchoSentences]);
  const meaty = shuffle([runDialogues, runStoryRetell]);
  const order = [warmups[0], meaty[0]];
  const wantFour = Math.random() < 0.5;
  if (wantFour) {
    order.push(runSayItLoud); // energy break
    order.push(warmups[1]);
  } else {
    order.push(Math.random() < 0.5 ? warmups[1] : meaty[1]);
  }
  return order;
}

// ---------- room shell ----------

async function showMessage(container, emoji, text, { withGallery = false } = {}) {
  container.replaceChildren(
    el(`
      <div class="session-content">
        <div class="big-emoji">${emoji}</div>
        <p class="speaking-summary">${text}</p>
        <div class="speaking-end-buttons">
          ${withGallery ? `<button type="button" class="big-button" id="btn-voice-gallery">🎵 听听我的声音</button>` : ""}
          <button type="button" class="big-button" id="btn-speaking-done">回到花园</button>
        </div>
      </div>
    `)
  );
  return new Promise((resolve) => {
    const gallery = document.getElementById("btn-voice-gallery");
    if (gallery) {
      gallery.addEventListener("click", async () => {
        await runVoiceGallery(container);
        resolve("gallery"); // caller re-shows summary
      }, { once: true });
    }
    document.getElementById("btn-speaking-done").addEventListener("click", () => resolve("done"), { once: true });
  });
}

async function showSummary(container, count) {
  let action;
  do {
    container.replaceChildren(
      el(`
        <div class="session-content">
          <div class="big-emoji speaking-cheer">🎤🐼</div>
          <p class="speaking-summary">今天录了 ${count} 个声音！</p>
          <div class="speaking-end-buttons">
            <button type="button" class="big-button" id="btn-voice-gallery">🎵 听听我的声音</button>
            <button type="button" class="big-button" id="btn-speaking-done">回到花园</button>
          </div>
        </div>
      `)
    );
    await playLine("speakingSummary");
    action = await new Promise((resolve) => {
      document.getElementById("btn-voice-gallery").addEventListener("click", async () => {
        await runVoiceGallery(container);
        resolve("gallery");
      }, { once: true });
      document.getElementById("btn-speaking-done").addEventListener("click", () => resolve("done"), { once: true });
    });
  } while (action === "gallery");
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
    if (Object.keys(progress.characters).length === 0) {
      await showMessage(container, "🐼", "还没有学过的字，先去认认字种一颗种子吧！");
      return;
    }
    let recorded = 0;
    for (const activity of buildVisit()) {
      recorded += await activity(container, stream, progress, charMap);
    }
    await showSummary(container, recorded);
  } finally {
    stream.getTracks().forEach((track) => track.stop());
    exit();
  }
}
