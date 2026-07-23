// Shared voice-recording UI + mic plumbing for the speaking room (and the
// character room's speaking game later). Extracted from the original
// echo.js so every speaking activity records the same way: a countdown
// ring, a live waveform, auto-stop shortly after she goes quiet, and a
// dedicated <audio> element for playback that never fights audio.js's
// spoken-line element.
//
// Fully offline: getUserMedia + MediaRecorder + Web Audio only, recordings
// never leave the device. If MediaRecorder is unsupported or the mic is
// denied, the caller gets null back and skips speaking gracefully.

import { playLine } from "./audio.js";
import { saveProgress } from "./progress.js";

const MAX_RECORD_MS = 7000; // hard cap so a stuck recording can't run forever
const SILENCE_STOP_MS = 1300; // stop this long after she stops talking
const MIN_SPEECH_MS = 400; // below this we treat the take as "no voice"
// RMS on a -1..1 float buffer. Ambient room noise sits well under this;
// even quiet speech clears it. Generous — this is participation, not rigor.
const SPEECH_RMS_THRESHOLD = 0.02;

const MIME_CANDIDATES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4",
  "audio/ogg;codecs=opus",
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
  return undefined; // let the browser choose
}

export function isRecordingSupported() {
  return (
    typeof MediaRecorder !== "undefined" &&
    typeof navigator !== "undefined" &&
    navigator.mediaDevices &&
    typeof navigator.mediaDevices.getUserMedia === "function"
  );
}

// Shows the friendly "熊猫想听听你的声音" explainer only the first time ever
// (so the real browser permission dialog that follows is expected, not
// scary), then requests the mic. Returns a MediaStream, or null if
// unsupported/denied/errored. Reuses the older echoMicPrompted flag so a
// child who already granted the mic in the old flow isn't re-explained.
export async function ensureMicPermission(container, progress) {
  if (!isRecordingSupported()) return null;

  const alreadyPrompted = progress.settings.micPrompted || progress.settings.echoMicPrompted;
  if (!alreadyPrompted) {
    const screen = el(`
      <div class="session-content">
        <div class="big-emoji echo-listening-ears">🐼👂</div>
        <p class="echo-mic-explain-text">熊猫想听听你的声音</p>
        <p class="parent-hint">（会请求麦克风权限；录音只保存在这台设备上，绝不会上传）</p>
        <button type="button" class="big-button" id="btn-mic-start">开始</button>
      </div>
    `);
    container.replaceChildren(screen);
    playLine("echoMicExplain");
    await new Promise((resolve) => {
      document.getElementById("btn-mic-start").addEventListener("click", resolve, { once: true });
    });
    progress.settings.micPrompted = true;
    saveProgress(progress);
  }

  try {
    return await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch {
    return null; // denied or no mic — caller shows the friendly fallback
  }
}

// Records until she's been quiet for a beat (or the hard cap, or she taps
// 完成), drawing a live waveform + a shrinking countdown ring throughout.
// Returns { blob, hadSpeech, durationMs, rms } — rms is the loudest frame
// seen, used for the "best take" / gold-clip heuristics.
export async function recordWithUI(container, stream) {
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
  const startedAt = performance.now();

  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  const audioCtx = new AudioContextClass();
  const source = audioCtx.createMediaStreamSource(stream);
  const analyser = audioCtx.createAnalyser();
  analyser.fftSize = 1024;
  source.connect(analyser);
  const timeData = new Float32Array(analyser.fftSize);
  const byteData = new Uint8Array(analyser.fftSize);

  let speechMs = 0;
  let silenceMs = 0;
  let peakRms = 0;
  let lastTick = performance.now();
  let rafId = null;
  let drawing = true;
  let finished = false;
  let finishResolve;
  const finishedPromise = new Promise((r) => (finishResolve = r));

  function finish() {
    if (finished) return;
    finished = true;
    finishResolve();
  }

  // JS-driven countdown ring — a CSS transition can silently fail to advance
  // in a throttled renderer, and the ring is the child's cue that time is
  // running, so it must always move.
  const RING_CIRCUMFERENCE = 2 * Math.PI * 54;
  ringProgress.style.strokeDasharray = `${RING_CIRCUMFERENCE}`;

  function draw() {
    analyser.getFloatTimeDomainData(timeData);
    analyser.getByteTimeDomainData(byteData);

    let sumSquares = 0;
    for (let i = 0; i < timeData.length; i++) sumSquares += timeData[i] * timeData[i];
    const rms = Math.sqrt(sumSquares / timeData.length);
    if (rms > peakRms) peakRms = rms;

    const now = performance.now();
    const dt = now - lastTick;
    lastTick = now;

    if (rms > SPEECH_RMS_THRESHOLD) {
      speechMs += dt;
      silenceMs = 0;
    } else if (speechMs > 0) {
      silenceMs += dt;
    }

    const elapsed = now - startedAt;
    ringProgress.style.strokeDashoffset = `${RING_CIRCUMFERENCE * Math.min(1, elapsed / MAX_RECORD_MS)}`;

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

    // Stop shortly after she goes quiet (once she's actually spoken), or at
    // the hard cap.
    if (speechMs >= MIN_SPEECH_MS && silenceMs >= SILENCE_STOP_MS) finish();
    if (elapsed >= MAX_RECORD_MS) finish();

    if (drawing) rafId = requestAnimationFrame(draw);
  }
  draw();

  stopButton.addEventListener("click", finish, { once: true });
  await finishedPromise;

  drawing = false;
  if (rafId) cancelAnimationFrame(rafId);
  const durationMs = performance.now() - startedAt;

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

  return { blob, hadSpeech: speechMs >= MIN_SPEECH_MS, durationMs, rms: peakRms };
}

// Plays a recorded Blob through a dedicated <audio> element (separate from
// audio.js's shared model-audio element so the two never fight). Resolves
// when playback ends. Accepts a Blob or an object URL string.
export function playBlob(blob) {
  return new Promise((resolve) => {
    const url = typeof blob === "string" ? blob : URL.createObjectURL(blob);
    const player = new Audio(url);
    const finish = () => {
      if (typeof blob !== "string") URL.revokeObjectURL(url);
      resolve();
    };
    player.onended = finish;
    player.onerror = finish;
    player.play().catch(finish);
  });
}
