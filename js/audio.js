// One shared <audio> element for the whole app. Silk (the Fire tablet
// browser) requires a user gesture before any audio will play, so the very
// first tap of the start button "unlocks" this element by playing and
// immediately pausing it; every line after that just changes .src and
// plays normally.
//
// Every line has a stable key (see scripts/generate_audio.py). If a file
// exists at assets/audio/custom/{key}.mp3 it always wins over the
// generated one — that's how a parent's own recording overrides a line.

const sharedAudio = new Audio();
let unlocked = false;

export function isUnlocked() {
  return unlocked;
}

// A tiny separate Web Audio context for game sound-effects (the correct/
// wrong pop chimes). Kept apart from the shared <audio> element so a chime
// can never cut off a spoken line, and — crucially — created and resumed
// inside unlockAudio (a real user gesture) so it's already "running" before
// the first pop. A context created lazily mid-game can start suspended and
// silently swallow the first several sounds, which is exactly what "there's
// no pop sound" looks like.
let sfxCtx = null;

function ensureSfxCtx() {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  if (!sfxCtx) {
    try {
      sfxCtx = new AC();
    } catch {
      return null;
    }
  }
  if (sfxCtx.state === "suspended") sfxCtx.resume().catch(() => {});
  return sfxCtx;
}

export async function unlockAudio() {
  if (unlocked) return;
  try {
    sharedAudio.src = "";
    const played = sharedAudio.play().catch(() => {});
    await Promise.race([played, new Promise((r) => setTimeout(r, 1000))]);
    sharedAudio.pause();
  } catch {
    // Some browsers throw on playing an empty src — that's fine, the
    // gesture itself is what matters, not this particular call succeeding.
  }
  ensureSfxCtx(); // warm up the effects context on the same gesture
  unlocked = true;
}

// A short bright rising "ding" for a correct pop, and a soft descending
// two-note motif for a wrong one (gentle, deliberately not a harsh buzzer,
// but clearly distinct from the correct sound). Synthesized on the fly, so
// no sound-effect asset files are needed. Best-effort — never throws.
export function playChime(kind) {
  const ctx = ensureSfxCtx();
  if (!ctx) return;
  try {
    const now = ctx.currentTime;
    const tone = (freq, start, dur, peak) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(peak, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + dur);
      osc.connect(gain).connect(ctx.destination);
      osc.start(start);
      osc.stop(start + dur + 0.03);
    };
    if (kind === "correct") {
      tone(880, now, 0.15, 0.38); // A5
      tone(1318.51, now + 0.1, 0.22, 0.38); // E6 — bright rising ding
    } else {
      tone(392, now, 0.22, 0.34); // G4
      tone(261.63, now + 0.12, 0.28, 0.32); // C4 — soft descending "aw"
    }
  } catch {
    // Audio here is a nicety; never let it break the game.
  }
}

// Custom overrides are checked with a lightweight existence probe the
// first time a key is played, then cached so we don't re-probe every time.
const resolvedPathCache = new Map();

async function resolveAudioPath(key) {
  if (resolvedPathCache.has(key)) {
    return resolvedPathCache.get(key);
  }

  const customPath = `assets/audio/custom/${key}.mp3`;
  const generatedPath = `assets/audio/${key}.mp3`;

  let path = generatedPath;
  try {
    const res = await fetch(customPath, { method: "HEAD" });
    if (res.ok) path = customPath;
  } catch {
    // No custom override reachable — fall back to the generated file.
  }

  resolvedPathCache.set(key, path);
  return path;
}

// Some failure modes (a missing file combined with an HTTP/1.0 server, in
// particular) leave the audio element stuck in NETWORK_LOADING forever —
// no 'ended', no 'error', no rejected play() promise. A hard timeout makes
// sure a bad or absent audio file can never block the session.
const PLAY_TIMEOUT_MS = 4000;

export async function playLine(key) {
  const path = await resolveAudioPath(key);
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve();
    };

    sharedAudio.src = path;
    sharedAudio.onended = finish;
    sharedAudio.onerror = finish; // missing audio shouldn't block the session
    sharedAudio.play().catch(finish);
    setTimeout(finish, PLAY_TIMEOUT_MS);
  });
}

// Plays a sequence of keys back-to-back, waiting for each to finish.
export async function playSequence(keys) {
  for (const key of keys) {
    await playLine(key);
  }
}

// Picks a random variant key from a set like ["hello_1".."hello_5"] when
// given the family prefix and count, e.g. pickVariant("hello", 5).
export function pickVariant(prefix, count) {
  const n = Math.floor(Math.random() * count) + 1;
  return `${prefix}_${n}`;
}
