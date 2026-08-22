// 故事 (Story Mode) — swipeable illustrated stories with interactive layers.
// Layer 1: 听故事 — listen to narrated scenes
// Layer 2: 点一点 — tap hotspots to hear vocabulary
// Layer 3: 说一说 — hear a phrase, record yourself, play back
// Layer 4: 写一写 — trace characters from the episode

import { isRecordingSupported, ensureMicPermission, recordWithUI, playBlob } from "./recorder.js";
import { loadProgress, saveProgress } from "./progress.js";

let currentAssetBase = "";

let storyAudio = null;
function getStoryAudio() {
  if (!storyAudio) storyAudio = new Audio();
  return storyAudio;
}

function playStoryAudio(file) {
  return new Promise((resolve) => {
    const audio = getStoryAudio();
    audio.pause();
    audio.src = `${currentAssetBase}/${file}`;
    audio.onended = resolve;
    audio.onerror = resolve;
    audio.play().catch(resolve);
    setTimeout(resolve, 15000);
  });
}

function stopStoryAudio() {
  if (storyAudio) {
    storyAudio.pause();
    storyAudio.src = "";
  }
}

function el(html) {
  const t = document.createElement("template");
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

// ── Episode picker (entry screen) ──────────────────────────────

export async function runStoryMode(progress, charMap) {
  const container = document.getElementById("story-content");
  const screen = document.getElementById("screen-story");
  screen.classList.remove("hidden");

  const episodes = await loadEpisodes();

  return new Promise((resolve) => {
    renderEpisodePicker(container, episodes, progress, charMap, () => {
      stopStoryAudio();
      screen.classList.add("hidden");
      resolve();
    });
  });
}

async function loadEpisodes() {
  const files = ["data/story-ep01.json", "data/story-ep02.json"];
  const results = await Promise.all(
    files.map((f) => fetch(f).then((r) => r.json()).catch(() => null))
  );
  return results.filter(Boolean);
}

function renderEpisodePicker(container, episodes, progress, charMap, onExit) {
  const view = el(`
    <div class="session-content story-picker">
      <button type="button" class="story-back-btn" aria-label="返回">⬅️</button>
      <h2 class="story-picker-title">📖 故事</h2>
      <div class="story-episode-list"></div>
    </div>
  `);

  const list = view.querySelector(".story-episode-list");
  for (const ep of episodes) {
    const card = el(`
      <button type="button" class="story-episode-card">
        <span class="story-episode-emoji">${ep.titleEmoji}</span>
        <span class="story-episode-title">${ep.title}</span>
        <span class="story-episode-scenes">${ep.scenes.length} 页</span>
      </button>
    `);
    card.addEventListener("click", () => {
      renderEpisodeView(container, ep, progress, charMap, () => {
        renderEpisodePicker(container, episodes, progress, charMap, onExit);
      });
    });
    list.appendChild(card);
  }

  view.querySelector(".story-back-btn").addEventListener("click", onExit);
  container.replaceChildren(view);
}

// ── Episode view with layer tabs ───────────────────────────────

function renderEpisodeView(container, episode, progress, charMap, onBack) {
  currentAssetBase = episode.assetBase;
  const view = el(`
    <div class="session-content story-episode">
      <div class="story-episode-header">
        <button type="button" class="story-back-btn" aria-label="返回">⬅️</button>
        <h2 class="story-episode-heading">${episode.titleEmoji} ${episode.title}</h2>
      </div>
      <div class="story-layer-tabs">
        <button type="button" class="story-tab active" data-layer="listen">听故事</button>
        <button type="button" class="story-tab" data-layer="tap">点一点</button>
        <button type="button" class="story-tab" data-layer="speak">说一说</button>
        <button type="button" class="story-tab" data-layer="write">写一写</button>
      </div>
      <div class="story-layer-content"></div>
    </div>
  `);

  const layerContent = view.querySelector(".story-layer-content");
  const tabs = view.querySelectorAll(".story-tab");

  function switchLayer(layer) {
    stopStoryAudio();
    tabs.forEach((t) => t.classList.toggle("active", t.dataset.layer === layer));
    switch (layer) {
      case "listen": renderListenLayer(layerContent, episode); break;
      case "tap": renderTapLayer(layerContent, episode); break;
      case "speak": renderSpeakLayer(layerContent, episode, progress); break;
      case "write": renderWriteLayer(layerContent, episode, charMap); break;
    }
  }

  tabs.forEach((t) => t.addEventListener("click", () => switchLayer(t.dataset.layer)));
  view.querySelector(".story-back-btn").addEventListener("click", () => {
    stopStoryAudio();
    onBack();
  });

  container.replaceChildren(view);
  switchLayer("listen");
}

// ── Layer 1: 听故事 (Listen) ───────────────────────────────────

function renderListenLayer(container, episode) {
  let currentScene = 0;

  function render() {
    const scene = episode.scenes[currentScene];
    const isFirst = currentScene === 0;
    const isLast = currentScene === episode.scenes.length - 1;

    const view = el(`
      <div class="story-listen">
        <div class="story-scene-image-wrap">
          <img class="story-scene-image" src="${currentAssetBase}/${scene.image}" alt="${scene.title}" />
          <div class="story-scene-title-badge">${scene.title}</div>
        </div>
        <p class="story-narration-text">${scene.narrationText}</p>
        <div class="story-nav-row">
          <button type="button" class="story-nav-btn" ${isFirst ? "disabled" : ""} data-dir="prev">◀</button>
          <button type="button" class="story-nav-btn story-play-btn" data-action="play">🔊 听</button>
          <button type="button" class="story-nav-btn" ${isLast ? "disabled" : ""} data-dir="next">▶</button>
        </div>
        <div class="story-dots">${episode.scenes.map((_, i) =>
          `<span class="story-dot${i === currentScene ? " active" : ""}"></span>`
        ).join("")}</div>
      </div>
    `);

    view.querySelector('[data-dir="prev"]')?.addEventListener("click", () => {
      if (currentScene > 0) { currentScene--; stopStoryAudio(); render(); }
    });
    view.querySelector('[data-dir="next"]')?.addEventListener("click", () => {
      if (currentScene < episode.scenes.length - 1) { currentScene++; stopStoryAudio(); render(); }
    });
    view.querySelector('[data-action="play"]').addEventListener("click", () => {
      playStoryAudio(scene.narration);
    });

    // Touch swipe support
    let startX = 0;
    const imgWrap = view.querySelector(".story-scene-image-wrap");
    imgWrap.addEventListener("touchstart", (e) => { startX = e.touches[0].clientX; }, { passive: true });
    imgWrap.addEventListener("touchend", (e) => {
      const dx = e.changedTouches[0].clientX - startX;
      if (Math.abs(dx) > 50) {
        if (dx < 0 && currentScene < episode.scenes.length - 1) { currentScene++; stopStoryAudio(); render(); }
        if (dx > 0 && currentScene > 0) { currentScene--; stopStoryAudio(); render(); }
      }
    }, { passive: true });

    container.replaceChildren(view);
    playStoryAudio(scene.narration);
  }

  render();
}

// ── Layer 2: 点一点 (Tap & Explore) ────────────────────────────

function renderTapLayer(container, episode) {
  let currentScene = 0;

  function render() {
    const scene = episode.scenes[currentScene];
    const isFirst = currentScene === 0;
    const isLast = currentScene === episode.scenes.length - 1;

    const view = el(`
      <div class="story-tap">
        <div class="story-scene-image-wrap story-hotspot-wrap">
          <img class="story-scene-image" src="${currentAssetBase}/${scene.image}" alt="${scene.title}" />
          ${scene.hotspots.map((h, i) => `
            <button type="button" class="story-hotspot" data-idx="${i}"
              style="left:${h.x}%;top:${h.y}%;width:${h.w}%;height:${h.h}%"
              aria-label="${h.label}">
              <span class="story-hotspot-pulse"></span>
            </button>
          `).join("")}
          <div class="story-hotspot-label hidden" id="hotspot-label"></div>
        </div>
        <p class="story-tap-hint">点一点图片，听听看！</p>
        <div class="story-nav-row">
          <button type="button" class="story-nav-btn" ${isFirst ? "disabled" : ""} data-dir="prev">◀</button>
          <span class="story-scene-counter">${currentScene + 1} / ${episode.scenes.length}</span>
          <button type="button" class="story-nav-btn" ${isLast ? "disabled" : ""} data-dir="next">▶</button>
        </div>
      </div>
    `);

    const label = view.querySelector("#hotspot-label");
    view.querySelectorAll(".story-hotspot").forEach((btn) => {
      btn.addEventListener("click", () => {
        const h = scene.hotspots[Number(btn.dataset.idx)];
        label.textContent = h.text;
        label.classList.remove("hidden");
        btn.classList.add("tapped");
        playStoryAudio(h.audio);
        setTimeout(() => label.classList.add("hidden"), 2500);
      });
    });

    view.querySelector('[data-dir="prev"]')?.addEventListener("click", () => {
      if (currentScene > 0) { currentScene--; stopStoryAudio(); render(); }
    });
    view.querySelector('[data-dir="next"]')?.addEventListener("click", () => {
      if (currentScene < episode.scenes.length - 1) { currentScene++; stopStoryAudio(); render(); }
    });

    // Touch swipe (same as listen layer)
    let startX = 0;
    const imgWrap = view.querySelector(".story-scene-image-wrap");
    imgWrap.addEventListener("touchstart", (e) => { startX = e.touches[0].clientX; }, { passive: true });
    imgWrap.addEventListener("touchend", (e) => {
      const dx = e.changedTouches[0].clientX - startX;
      if (Math.abs(dx) > 50) {
        if (dx < 0 && !isLast) { currentScene++; stopStoryAudio(); render(); }
        if (dx > 0 && !isFirst) { currentScene--; stopStoryAudio(); render(); }
      }
    }, { passive: true });

    container.replaceChildren(view);
  }

  render();
}

// ── Layer 3: 说一说 (Speak & Record) ───────────────────────────

function renderSpeakLayer(container, episode, progress) {
  let currentScene = 0;
  let micStream = null;

  async function render() {
    const scene = episode.scenes[currentScene];
    const isFirst = currentScene === 0;
    const isLast = currentScene === episode.scenes.length - 1;

    const view = el(`
      <div class="story-speak">
        <div class="story-scene-image-wrap story-speak-image-wrap">
          <img class="story-scene-image" src="${currentAssetBase}/${scene.image}" alt="${scene.title}" />
        </div>
        <p class="story-phrase-text">${scene.phraseText}</p>
        <div class="story-speak-buttons">
          <button type="button" class="story-speak-btn" data-action="listen">🔊 听一听</button>
          <button type="button" class="story-speak-btn story-speak-record" data-action="record">🎤 说一说</button>
        </div>
        <div class="story-speak-result hidden" id="speak-result">
          <button type="button" class="story-speak-btn" data-action="playback">🔁 再听一遍</button>
        </div>
        <div class="story-nav-row">
          <button type="button" class="story-nav-btn" ${isFirst ? "disabled" : ""} data-dir="prev">◀</button>
          <span class="story-scene-counter">${currentScene + 1} / ${episode.scenes.length}</span>
          <button type="button" class="story-nav-btn" ${isLast ? "disabled" : ""} data-dir="next">▶</button>
        </div>
      </div>
    `);

    let recordedBlob = null;

    view.querySelector('[data-action="listen"]').addEventListener("click", () => {
      playStoryAudio(scene.phrase);
    });

    view.querySelector('[data-action="record"]').addEventListener("click", async () => {
      if (!micStream) {
        micStream = await ensureMicPermission(container, progress);
        if (!micStream) {
          render();
          return;
        }
      }
      const recordArea = el(`<div class="story-record-area"></div>`);
      const resultEl = view.querySelector("#speak-result");
      resultEl.classList.add("hidden");
      view.querySelector(".story-speak-buttons").replaceChildren(recordArea);

      const result = await recordWithUI(recordArea, micStream);
      recordedBlob = result.blob;

      view.querySelector(".story-speak-buttons").innerHTML = `
        <button type="button" class="story-speak-btn" data-action="listen">🔊 听一听</button>
        <button type="button" class="story-speak-btn story-speak-record" data-action="record">🎤 再试一次</button>
      `;
      view.querySelector('[data-action="listen"]').addEventListener("click", () => {
        playStoryAudio(scene.phrase);
      });
      view.querySelector('[data-action="record"]').addEventListener("click", async () => {
        const area = el(`<div class="story-record-area"></div>`);
        view.querySelector("#speak-result").classList.add("hidden");
        view.querySelector(".story-speak-buttons").replaceChildren(area);
        const r = await recordWithUI(area, micStream);
        recordedBlob = r.blob;
        render();
      });

      if (result.hadSpeech) {
        resultEl.classList.remove("hidden");
        resultEl.querySelector('[data-action="playback"]').addEventListener("click", () => {
          playBlob(recordedBlob);
        });
        await playBlob(recordedBlob);
      }
    });

    view.querySelector('[data-dir="prev"]')?.addEventListener("click", () => {
      if (currentScene > 0) { currentScene--; stopStoryAudio(); render(); }
    });
    view.querySelector('[data-dir="next"]')?.addEventListener("click", () => {
      if (currentScene < episode.scenes.length - 1) { currentScene++; stopStoryAudio(); render(); }
    });

    container.replaceChildren(view);
  }

  render();
}

// ── Layer 4: 写一写 (Character Corner) ─────────────────────────

function renderWriteLayer(container, episode, charMap) {
  const chars = episode.characters || [];
  let currentIdx = 0;

  function render() {
    const char = chars[currentIdx];
    const entry = charMap.get(char);
    const isFirst = currentIdx === 0;
    const isLast = currentIdx === chars.length - 1;

    const view = el(`
      <div class="story-write">
        <h3 class="story-write-title">写一写</h3>
        <div class="story-write-char-display">
          <span class="story-write-big-char">${char}</span>
          ${entry ? `<span class="story-write-pinyin">${entry.pinyin || ""}</span>` : ""}
          ${entry ? `<span class="story-write-word">${entry.word || ""}</span>` : ""}
        </div>
        <div class="story-write-canvas" id="story-hanzi-target"></div>
        <div class="story-write-controls">
          <button type="button" class="story-speak-btn" data-action="animate">✨ 看一遍</button>
          <button type="button" class="story-speak-btn" data-action="practice">✏️ 写一写</button>
        </div>
        <div class="story-nav-row">
          <button type="button" class="story-nav-btn" ${isFirst ? "disabled" : ""} data-dir="prev">◀</button>
          <span class="story-scene-counter">${currentIdx + 1} / ${chars.length}</span>
          <button type="button" class="story-nav-btn" ${isLast ? "disabled" : ""} data-dir="next">▶</button>
        </div>
      </div>
    `);

    container.replaceChildren(view);

    const target = view.querySelector("#story-hanzi-target");
    const size = Math.min(target.clientWidth, 220);
    target.style.width = `${size}px`;
    target.style.height = `${size}px`;

    let writer = null;
    try {
      writer = HanziWriter.create(target, char, {
        width: size,
        height: size,
        padding: 8,
        showOutline: true,
        showCharacter: true,
        strokeAnimationSpeed: 1.2,
        delayBetweenStrokes: 200,
        charDataLoader: (c) => fetch(`assets/strokes/${encodeURIComponent(c)}.json`).then((r) => r.json()),
      });
    } catch {
      target.innerHTML = `<span style="font-size:80px">${char}</span>`;
    }

    view.querySelector('[data-action="animate"]')?.addEventListener("click", () => {
      if (writer) writer.animateCharacter();
    });
    view.querySelector('[data-action="practice"]')?.addEventListener("click", () => {
      if (writer) {
        writer.quiz({
          showHintAfterMisses: 2,
          onComplete: () => {
            const msg = el(`<p class="story-write-done">👏 写得好！</p>`);
            view.querySelector(".story-write-controls").appendChild(msg);
          },
        });
      }
    });

    view.querySelector('[data-dir="prev"]')?.addEventListener("click", () => {
      if (currentIdx > 0) { currentIdx--; render(); }
    });
    view.querySelector('[data-dir="next"]')?.addEventListener("click", () => {
      if (currentIdx < chars.length - 1) { currentIdx++; render(); }
    });
  }

  if (chars.length === 0) {
    container.replaceChildren(el(`<div class="session-content"><p>这个故事没有写字练习</p></div>`));
    return;
  }

  render();
}
