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
import { RunAborted, isAborted, onAbortOfCurrentRun, untilAborted, waitForClick } from "./nav.js";

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
    playLine("echoMicExplain").catch(() => {});
    await waitForClick(screen.querySelector("#btn-mic-start"));
    progress.settings.micPrompted = true;
    saveProgress(progress);
  }

  // Opening the mic takes a few hundred ms on the tablet — long enough for a
  // 🏠 tap to land in between. The await must be an abort point (a swallowed
  // RunAborted here let the room keep recording in the background), and the
  // stream that still arrives afterwards must be stopped, or the mic stays
  // on with nobody holding it.
  const request = navigator.mediaDevices.getUserMedia({ audio: true });
  try {
    return await untilAborted(request);
  } catch (err) {
    if (err instanceof RunAborted) {
      request.then((stream) => stream.getTracks().forEach((track) => track.stop()), () => {});
      throw err;
    }
    return null; // denied or no mic — caller shows the friendly fallback
  }
}

// Records until she's been quiet for a beat (or the hard cap, or she taps
// 完成), drawing a live waveform + a shrinking countdown ring throughout.
// Returns { blob, hadSpeech, durationMs, rms } — rms is the loudest frame
// seen, used for the "best take" / gold-clip heuristics.
export async function recordWithUI(container, stream) {
  if (isAborted()) throw new RunAborted();
  // A stream whose tracks have already been stopped (e.g. the mic was
  // released while a layer was switching) can't be recorded — treat it as
  // a silent take rather than letting MediaRecorder throw mid-activity.
  if (!stream || !stream.active) {
    return { blob: new Blob([], { type: "audio/webm" }), hadSpeech: false, durationMs: 0, rms: 0 };
  }
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

  // Hard cap on a real timer, independent of the rAF draw loop below — rAF
  // pauses in a backgrounded tab, and the recording must always stop even
  // if the child tabs away mid-record.
  const capTimer = setTimeout(finish, MAX_RECORD_MS);

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
  // Leaving the room mid-take (back button) ends the take right away so the
  // recorder and analyser are always torn down — never left running under a
  // hidden screen.
  let aborted = false;
  const offAbort = onAbortOfCurrentRun(() => {
    aborted = true;
    finish();
  });
  await finishedPromise;
  offAbort();

  clearTimeout(capTimer);
  drawing = false;
  if (rafId) cancelAnimationFrame(rafId);
  const durationMs = performance.now() - startedAt;

  const blob = await new Promise((resolve) => {
    // A recorder that's already inactive (the stream ended underneath it)
    // never fires 'stop' — resolve with whatever was captured instead.
    if (recorder.state === "inactive") {
      resolve(new Blob(chunks, { type: mimeType || "audio/webm" }));
      return;
    }
    recorder.addEventListener(
      "stop",
      () => resolve(new Blob(chunks, { type: mimeType || "audio/webm" })),
      { once: true }
    );
    try {
      recorder.stop();
    } catch {
      resolve(new Blob(chunks, { type: mimeType || "audio/webm" }));
    }
  });

  source.disconnect();
  await audioCtx.close().catch(() => {});

  if (aborted) throw new RunAborted();
  return { blob, hadSpeech: speechMs >= MIN_SPEECH_MS, durationMs, rms: peakRms };
}

// ---------- parent clips (家长录音, Parent Corner) ----------
//
// A plain tap-to-start / tap-to-stop recorder for a parent recording the
// model voice of a phrase. Parent Corner isn't a room — there's no run to
// abort — so it owns its own stop path: cancelParentClip() is wired into
// app.js's stopAllAudio(), which every back press runs, so leaving Parent
// Corner mid-take always releases the mic.

const PARENT_CLIP_MAX_MS = 15000;
let parentTake = null; // { recorder, stream, cap, keep }
let parentTakeSeq = 0;

// Resolves with the recorded Blob once finishParentClip() is called (or the
// 15s cap hits), or null if it was cancelled or the mic couldn't open.
export async function recordParentClip() {
  cancelParentClip();
  const mine = ++parentTakeSeq;
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch {
    return null;
  }
  if (mine !== parentTakeSeq) {
    // Cancelled while the mic was opening.
    stream.getTracks().forEach((track) => track.stop());
    return null;
  }
  const mimeType = pickMimeType();
  const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
  const chunks = [];
  recorder.addEventListener("dataavailable", (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  });
  const take = { recorder, stream, cap: null, keep: true };
  parentTake = take;
  const stopped = new Promise((resolve) => recorder.addEventListener("stop", resolve, { once: true }));
  recorder.start();
  take.cap = setTimeout(finishParentClip, PARENT_CLIP_MAX_MS);
  await stopped;
  stream.getTracks().forEach((track) => track.stop());
  if (parentTake === take) parentTake = null;
  if (!take.keep || chunks.length === 0) return null;
  return new Blob(chunks, { type: recorder.mimeType || mimeType || "audio/webm" });
}

function stopParentTake(keep) {
  parentTakeSeq += 1; // also cancels a take whose mic is still opening
  const take = parentTake;
  if (!take) return;
  take.keep = keep;
  clearTimeout(take.cap);
  try {
    if (take.recorder.state !== "inactive") take.recorder.stop();
  } catch {
    take.stream.getTracks().forEach((track) => track.stop());
  }
}

export function finishParentClip() {
  stopParentTake(true);
}

export function cancelParentClip() {
  stopParentTake(false);
}

// Plays a recorded Blob through a dedicated <audio> element (separate from
// audio.js's shared model-audio element so the two never fight). Resolves
// when playback ends. Accepts a Blob or an object URL string. Only one blob
// plays at a time — starting a new one cuts the previous one (so tapping
// around the voice gallery never stacks overlapping playbacks), and leaving
// the room stops it. A stall/duration guard mirrors playLine's so a clip the
// browser can't decode never hangs the flow.
const BLOB_STALL_TIMEOUT_MS = 4000;
const BLOB_MAX_MS = 20000;
let currentPlayer = null;

export function stopBlobPlayback() {
  if (currentPlayer) {
    try {
      currentPlayer.pause();
    } catch {
      // Nothing to stop.
    }
    currentPlayer = null;
  }
}

export function playBlob(blob) {
  if (isAborted()) return Promise.reject(new RunAborted());
  if (!blob || (typeof blob !== "string" && blob.size === 0)) return Promise.resolve();

  return new Promise((resolve, reject) => {
    stopBlobPlayback();
    const url = typeof blob === "string" ? blob : URL.createObjectURL(blob);
    const player = new Audio(url);
    currentPlayer = player;
    let settled = false;
    let timer = null;
    const settle = (fn) => {
      if (settled) return;
      settled = true;
      if (timer !== null) clearTimeout(timer);
      offAbort();
      if (typeof blob !== "string") URL.revokeObjectURL(url);
      if (currentPlayer === player) currentPlayer = null;
      fn();
    };
    const finish = () => settle(resolve);
    const offAbort = onAbortOfCurrentRun(() => {
      try {
        player.pause();
      } catch {
        // Nothing to stop.
      }
      settle(() => reject(new RunAborted()));
    });
    player.onended = finish;
    player.onerror = finish;
    player.onpause = () => {
      // Cut by a newer playBlob() (or stopBlobPlayback) — hand control back.
      if (!player.ended) finish();
    };
    player.onplaying = () => {
      if (settled) return;
      if (timer !== null) clearTimeout(timer);
      const d = player.duration;
      const ceiling = Number.isFinite(d) && d > 0 ? Math.min(BLOB_MAX_MS, d * 1000 + 2000) : BLOB_MAX_MS;
      timer = setTimeout(finish, ceiling);
    };
    timer = setTimeout(finish, BLOB_STALL_TIMEOUT_MS);
    player.play().catch(finish);
  });
}
