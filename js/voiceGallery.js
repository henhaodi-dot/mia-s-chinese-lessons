// 我的声音 (voice collection): a sticker-book of her own voice. Every word,
// sentence, and dialogue line she's recorded, as a grid of tiles she can
// tap to hear herself, then the panda's model, then herself again. Tiles
// where she sounded especially clear (loud enough, long enough) get a gold
// border. Purely for the joy of browsing her own voice — no scores, no
// progress, nothing at stake.

import { playLine } from "./audio.js";
import { playBlob } from "./recorder.js";
import { getAllRecordings, getParentClip, recordingScore } from "./recordings.js";
import { untilAborted, waitForClick } from "./nav.js";

// Above this "loud + long enough" score, a clip gets the gold border.
const GOLD_SCORE = 0.06;

function el(html) {
  const template = document.createElement("template");
  template.innerHTML = html.trim();
  return template.content.firstElementChild;
}

// A small deterministic bar pattern so each tile has its own little
// "waveform" look, without the cost of decoding every blob to draw a real
// one. Seeded from the id + loudness so it's stable per recording.
function miniWaveformBars(rec) {
  let seed = 0;
  for (const ch of rec.id) seed = (seed * 31 + ch.charCodeAt(0)) & 0xffff;
  const loud = Math.min(1, (rec.rms || 0.05) * 6);
  let bars = "";
  for (let i = 0; i < 9; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    const h = 25 + ((seed % 60) * (0.5 + loud * 0.5));
    bars += `<span class="voice-bar" style="height:${Math.round(h)}%"></span>`;
  }
  return bars;
}

function tileLabel(rec) {
  if (rec.kind === "sentence" || rec.kind === "storyline" || rec.kind === "phrase") {
    const first = (rec.text || "").slice(0, 6);
    return first + ((rec.text || "").length > 6 ? "…" : "");
  }
  return rec.text || rec.char || "🎵";
}

// Only the most recently tapped tile keeps playing: each tap bumps the
// sequence number, and an older sequence stops between its steps as soon as
// it notices it's been superseded (playBlob/playLine already cut the clip
// that was mid-play).
let playSeq = 0;

async function playHersModelHers(rec) {
  const mine = ++playSeq;
  await playBlob(rec.blob);
  if (mine !== playSeq) return;
  if (rec.kind === "phrase") {
    // A phrase echo's model is the parent's recording of the same line
    // (same id in the parent-clip store), not a generated spoken line.
    const clip = await getParentClip(rec.id);
    if (mine !== playSeq) return;
    if (clip) await playBlob(clip.blob);
  } else {
    await playLine(rec.modelKey || rec.id);
  }
  if (mine !== playSeq) return;
  await playBlob(rec.blob);
}

export async function runVoiceGallery(container) {
  const recordings = (await untilAborted(getAllRecordings())).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

  if (recordings.length === 0) {
    container.replaceChildren(
      el(`
        <div class="session-content">
          <div class="big-emoji">🎤</div>
          <p class="speaking-summary">还没有录音哦，先和熊猫说说话吧！</p>
          <button type="button" class="big-button" id="btn-gallery-back">返回</button>
        </div>
      `)
    );
    await waitForClick(container.querySelector("#btn-gallery-back"));
    return;
  }

  const screen = el(`
    <div class="session-content voice-gallery-screen">
      <div class="voice-gallery-header">
        <button type="button" class="icon-button" id="btn-gallery-back" aria-label="返回">⬅️</button>
        <span class="voice-gallery-title">我的声音 (${recordings.length})</span>
      </div>
      <div class="voice-gallery-grid"></div>
    </div>
  `);
  const grid = screen.querySelector(".voice-gallery-grid");
  for (const rec of recordings) {
    const gold = recordingScore(rec) >= GOLD_SCORE;
    const tile = el(`
      <button type="button" class="voice-tile${gold ? " voice-tile-gold" : ""}">
        <span class="voice-tile-wave">${miniWaveformBars(rec)}</span>
        <span class="voice-tile-label">${tileLabel(rec)}</span>
      </button>
    `);
    tile.addEventListener("click", () => {
      // Starting a new tile cuts whatever was playing (playBlob/playLine are
      // single-slot), so tapping around never stacks overlapping voices.
      grid.querySelectorAll(".voice-tile-playing").forEach((t) => t.classList.remove("voice-tile-playing"));
      tile.classList.add("voice-tile-playing");
      playHersModelHers(rec)
        .catch(() => {})
        .finally(() => tile.classList.remove("voice-tile-playing"));
    });
    grid.appendChild(tile);
  }
  container.replaceChildren(screen);

  await waitForClick(screen.querySelector("#btn-gallery-back"));
}
