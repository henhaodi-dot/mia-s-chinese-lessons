// 我的声音 (voice collection): a sticker-book of her own voice. Every word,
// sentence, and dialogue line she's recorded, as a grid of tiles she can
// tap to hear herself, then the panda's model, then herself again. Tiles
// where she sounded especially clear (loud enough, long enough) get a gold
// border. Purely for the joy of browsing her own voice — no scores, no
// progress, nothing at stake.

import { playLine } from "./audio.js";
import { playBlob } from "./recorder.js";
import { getAllRecordings, recordingScore } from "./recordings.js";

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
  if (rec.kind === "sentence" || rec.kind === "storyline") {
    const first = (rec.text || "").slice(0, 6);
    return first + ((rec.text || "").length > 6 ? "…" : "");
  }
  return rec.text || rec.char || "🎵";
}

async function playHersModelHers(rec) {
  await playBlob(rec.blob);
  await playLine(rec.modelKey || rec.id);
  await playBlob(rec.blob);
}

export async function runVoiceGallery(container) {
  const recordings = (await getAllRecordings()).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

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
    await new Promise((resolve) => {
      document.getElementById("btn-gallery-back").addEventListener("click", resolve, { once: true });
    });
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
      tile.classList.add("voice-tile-playing");
      playHersModelHers(rec).finally(() => tile.classList.remove("voice-tile-playing"));
    });
    grid.appendChild(tile);
  }
  container.replaceChildren(screen);

  await new Promise((resolve) => {
    document.getElementById("btn-gallery-back").addEventListener("click", resolve, { once: true });
  });
}
