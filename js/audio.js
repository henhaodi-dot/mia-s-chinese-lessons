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
  unlocked = true;
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
