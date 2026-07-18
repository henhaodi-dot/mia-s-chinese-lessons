// 回声练习 (echo practice), Phase 1: after each new character she repeats
// the character/word/sentence out loud, hears her own voice back next to
// the model audio. Participation-based only — no speech recognition (that's
// the optional, default-off Phase 2 later), no fail state anywhere here.
//
// Fully offline: getUserMedia + MediaRecorder + Web Audio only, recordings
// never leave the device. If MediaRecorder isn't supported, or the mic
// permission is denied, the whole feature quietly skips — callers just get
// a null stream back and proceed with the rest of Round 1 unchanged.

import { playLine } from "./audio.js";
import { saveProgress } from "./progress.js";

const RECORD_WINDOW_MS = 4000;
const MIN_SPEECH_MS = 500;
// RMS on a -1..1 float time-domain buffer. Ambient room noise typically
// sits well under this; actual speech (even quiet) clears it. Generous on
// purpose — this is a participation check, not a rigor test.
const SPEECH_RMS_THRESHOLD = 0.02;

const MIME_CANDIDATES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4",
  "audio/ogg;codecs=opus",
];

const PROMPTS = [
  { type: "character", audioKeyFor: (char) => `char_${char}`, textFor: (entry) => entry.char, textClass: "big-character" },
  { type: "word", audioKeyFor: (char) => `word_${char}`, textFor: (entry) => entry.word, textClass: "big-character echo-word-text" },
  { type: "sentence", audioKeyFor: (char) => `sentence_${char}`, textFor: (entry) => entry.sentence, textClass: "story-text" },
];

function el(html) {
  const template = document.createElement("template");
  template.innerHTML = html.trim();
  return template.content.firstElementChild;
}

function pickMimeType() {
  if (typeof MediaRecorder === "undefined") return undefined;
  for (const candidate of MIME_CANDIDATES) {
    if (MediaRecorder.isTypeSupported?.(candidate)) return candidate;
  }
  return undefined; // let the browser pick its own default
}

export function isEchoSupported() {
  return (
    typeof MediaRecorder !== "undefined" &&
    typeof navigator !== "undefined" &&
    navigator.mediaDevices &&
    typeof navigator.mediaDevices.getUserMedia === "function"
  );
}

// Shows the friendly explain screen only the first time ever (tracked on
// progress.settings so the real browser permission dialog is expected, not
// scary), then requests the mic. Every session after that just silently
// re-requests a fresh stream — the browser won't re-prompt once decided.
// Returns a MediaStream, or null if unsupported/denied/errored.
export async function ensureMicPermission(container, progress) {
  if (!isEchoSupported()) return null;

  if (!progress.settings.echoMicPrompted) {
    const screen = el(`
      <div class="session-content">
        <div class="big-emoji echo-listening-ears">🐼👂</div>
        <p class="echo-mic-explain-text">熊猫想听听你读字的声音</p>
        <p class="parent-hint">（会请求麦克风权限；录音只保存在这台设备上，绝不会上传）</p>
        <button type="button" class="big-button" id="btn-echo-mic-start">开始</button>
      </div>
    `);
    container.replaceChildren(screen);
    await playLine("echoMicExplain");

    await new Promise((resolve) => {
      document.getElementById("btn-echo-mic-start").addEventListener("click", resolve, { once: true });
    });

    progress.settings.echoMicPrompted = true;
    saveProgress(progress);
  }

  try {
    return await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch {
    return null; // denied, or no mic present — echo skips for this session
  }
}

// Records for up to RECORD_WINDOW_MS (or until the stop button is tapped),
// drawing a live waveform and a shrinking countdown ring the whole time.
// Returns { blob, hadSpeech }.
async function recordWithUI(container, stream) {
  const screen = el(`
    <div class="session-content">
      <div class="echo-record-ring-wrap">
        <svg class="echo-record-ring" viewBox="0 0 120 120">
          <circle class="echo-record-ring-bg" cx="60" cy="60" r="54"></circle>
          <circle class="echo-record-ring-progress" cx="60" cy="60" r="54"></circle>
        </svg>
        <canvas class="echo-waveform" width="200" height="90"></canvas>
      </div>
      <button type="button" class="big-button echo-stop-button">⏹️ 完成</button>
    </div>
  `);
  container.replaceChildren(screen);

  const ringProgress = screen.querySelector(".echo-record-ring-progress");
  const canvas = screen.querySelector(".echo-waveform");
  const ctx = canvas.getContext("2d");
  const stopButton = screen.querySelector(".echo-stop-button");

  const mimeType = pickMimeType();
  const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
  const chunks = [];
  recorder.addEventListener("dataavailable", (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  });
  recorder.start();

  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  const audioCtx = new AudioContextClass();
  const source = audioCtx.createMediaStreamSource(stream);
  const analyser = audioCtx.createAnalyser();
  analyser.fftSize = 1024;
  source.connect(analyser);
  const timeData = new Float32Array(analyser.fftSize);
  const byteData = new Uint8Array(analyser.fftSize);

  let speechMs = 0;
  let lastTick = performance.now();
  let rafId = null;
  let drawing = true;

  function draw() {
    analyser.getFloatTimeDomainData(timeData);
    analyser.getByteTimeDomainData(byteData);

    let sumSquares = 0;
    for (let i = 0; i < timeData.length; i++) sumSquares += timeData[i] * timeData[i];
    const rms = Math.sqrt(sumSquares / timeData.length);
    const now = performance.now();
    const dt = now - lastTick;
    lastTick = now;
    if (rms > SPEECH_RMS_THRESHOLD) speechMs += dt;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.beginPath();
    ctx.strokeStyle = "#4caf50";
    ctx.lineWidth = 2;
    const slice = canvas.width / byteData.length;
    for (let i = 0; i < byteData.length; i++) {
      const x = i * slice;
      const y = (byteData[i] / 255) * canvas.height;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    if (drawing) rafId = requestAnimationFrame(draw);
  }
  draw();

  const RING_CIRCUMFERENCE = 2 * Math.PI * 54;
  ringProgress.style.strokeDasharray = `${RING_CIRCUMFERENCE}`;
  ringProgress.style.strokeDashoffset = "0";
  // Committing the transition on the next frame so it actually animates
  // from 0, rather than jumping straight to its end state.
  requestAnimationFrame(() => {
    ringProgress.style.transition = `stroke-dashoffset ${RECORD_WINDOW_MS}ms linear`;
    ringProgress.style.strokeDashoffset = `${RING_CIRCUMFERENCE}`;
  });

  await new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    stopButton.addEventListener("click", finish, { once: true });
    setTimeout(finish, RECORD_WINDOW_MS);
  });

  drawing = false;
  if (rafId) cancelAnimationFrame(rafId);

  const blob = await new Promise((resolve) => {
    recorder.addEventListener(
      "stop",
      () => resolve(new Blob(chunks, { type: mimeType || "audio/webm" })),
      { once: true }
    );
    recorder.stop();
  });

  source.disconnect();
  await audioCtx.close().catch(() => {});

  return { blob, hadSpeech: speechMs >= MIN_SPEECH_MS };
}

// Plays a recorded Blob through a dedicated <audio> element (kept separate
// from audio.js's shared model-audio element so the two never fight over
// playback state).
function playBlob(blob) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    const player = new Audio(url);
    const finish = () => {
      URL.revokeObjectURL(url);
      resolve();
    };
    player.onended = finish;
    player.onerror = finish;
    player.play().catch(finish);
  });
}

async function showComparisonScreen(container, entry, promptAudioKey, recordingBlob) {
  const screen = el(`
    <div class="session-content">
      <div class="big-emoji echo-star">⭐</div>
      <div class="echo-compare-row">
        <button type="button" class="icon-button echo-compare-button" id="btn-echo-replay-model" aria-label="再听一次熊猫的读音">🐼</button>
        <button type="button" class="icon-button echo-compare-button" id="btn-echo-replay-mine" aria-label="再听一次我的声音">🌸</button>
      </div>
      <button type="button" class="big-button" id="btn-echo-continue">继续</button>
    </div>
  `);
  container.replaceChildren(screen);
  await playLine("echoDone");

  screen.querySelector("#btn-echo-replay-model").addEventListener("click", () => playLine(promptAudioKey));
  screen.querySelector("#btn-echo-replay-mine").addEventListener("click", () => playBlob(recordingBlob));

  await new Promise((resolve) => {
    screen.querySelector("#btn-echo-continue").addEventListener("click", resolve, { once: true });
  });
}

// Runs one character/word/sentence prompt end to end: instruction -> model
// audio + text -> record -> retry-once-if-silent -> playback -> compare.
// Never throws, never blocks on a "wrong" outcome — there isn't one.
async function runOnePrompt(container, stream, entry, prompt) {
  const audioKey = prompt.audioKeyFor(entry.char);

  const instructionScreen = el(`
    <div class="session-content">
      <div class="big-emoji echo-listening-ears">👂</div>
    </div>
  `);
  container.replaceChildren(instructionScreen);
  await playLine("echoInstruction");

  container.replaceChildren(
    el(`
      <div class="session-content">
        <div class="${prompt.textClass}">${prompt.textFor(entry)}</div>
      </div>
    `)
  );
  await playLine(audioKey);

  let { blob, hadSpeech } = await recordWithUI(container, stream);
  if (!hadSpeech) {
    await playLine("echoRetry");
    ({ blob, hadSpeech } = await recordWithUI(container, stream));
    // Deliberately ignore hadSpeech from here on — one retry, then pass
    // regardless. There is no fail state in this feature.
  }

  await playLine("listenToYourself");
  await playBlob(blob);

  await showComparisonScreen(container, entry, audioKey, blob);
}

// Entry point: runs all three prompts (character, word, sentence) for one
// newly-taught character. `stream` is whatever ensureMicPermission()
// returned — if null, this no-ops entirely so Round 1 proceeds unchanged.
export async function runEchoRoundForCharacter(container, stream, entry) {
  if (!stream) return;
  for (const prompt of PROMPTS) {
    await runOnePrompt(container, stream, entry, prompt);
  }
}
