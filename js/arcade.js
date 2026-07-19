// 游戏场 (game arcade, standalone): lets her play any of the 8 games on
// demand with characters drawn from her whole learned pool, not just
// today's new characters. This is step 1 of a larger build — the picker
// UI, tile launch, and random-play loop. Character selection here is
// deliberately simple (random, respecting the picture-game filter and a
// per-game minimum); step 2 replaces pickStandaloneRound with the real
// due/shaky/recency-weighted version plus anti-repeat shuffling and unit
// tests. Review-credit integration (box/shaky updates from standalone
// play) also lands in a later step — for now, playing a standalone game
// exercises the exact same runGame() as the daily session, with no
// separate scoring wired in yet.

import { playLine, pickVariant } from "./audio.js";
import { runGame, GAME_IDS } from "./games.js";

const GAME_INFO = [
  { id: "G1", name: "词语填空", icon: "🔤" },
  { id: "G2", name: "句子填空", icon: "📝" },
  { id: "G3", name: "泡泡爆爆", icon: "🫧" },
  { id: "G4", name: "翻牌配对", icon: "🃏" },
  { id: "G5", name: "火眼金睛", icon: "👀" },
  { id: "G6", name: "组词车间", icon: "🏭" },
  { id: "G7", name: "句子拼拼乐", icon: "🧩" },
  { id: "G8", name: "喂熊猫", icon: "🐼" },
];

// Memory match only needs 3 (for 3 pairs); everything else wants at least
// a target + a couple of distractors.
const GAME_MIN_REQUIRED = { G1: 4, G2: 4, G3: 4, G4: 3, G5: 4, G6: 4, G7: 4, G8: 4 };
const PICTURE_DEPENDENT_GAMES = new Set(["G4", "G8"]);

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

function getEligiblePool(progress, charMap, gameId) {
  const picturableOnly = PICTURE_DEPENDENT_GAMES.has(gameId);
  return Object.keys(progress.characters)
    .map((char) => charMap.get(char))
    .filter(Boolean)
    .filter((entry) => !picturableOnly || entry.picturable !== false);
}

// Step-1 simple selection: random from the eligible pool, respecting the
// picture-game filter and a per-game minimum. Returns either
// { ok: true, newChars, distractorChars } or { ok: false, needed }.
export function pickStandaloneRound(progress, charMap, gameId) {
  const pool = getEligiblePool(progress, charMap, gameId);
  const minRequired = GAME_MIN_REQUIRED[gameId] ?? 4;
  if (pool.length < minRequired) {
    return { ok: false, needed: minRequired - pool.length };
  }

  const shuffled = shuffle(pool).map((e) => e.char);
  return { ok: true, newChars: shuffled.slice(0, 3), distractorChars: shuffled.slice(3, 5) };
}

export async function runGameArcade(progress, charMap) {
  const screen = document.getElementById("screen-arcade");
  const container = document.getElementById("arcade-content");
  screen.classList.remove("hidden");

  function exitArcade() {
    screen.classList.add("hidden");
  }

  async function showPoolTooSmall(needed) {
    container.replaceChildren(
      el(`
        <div class="session-content">
          <div class="big-emoji">🐼🔒</div>
          <p>还差 ${needed} 个字就能玩这个游戏啦！</p>
          <button type="button" class="big-button" id="btn-arcade-lock-back">回到游戏场</button>
        </div>
      `)
    );
    await playLine("arcadePoolTooSmall");
    await new Promise((resolve) => {
      document.getElementById("btn-arcade-lock-back").addEventListener("click", resolve, { once: true });
    });
    showPicker();
  }

  async function showCelebration() {
    container.replaceChildren(
      el(`
        <div class="session-content">
          <div class="big-emoji sticker-pop">🎉</div>
        </div>
      `)
    );
    await playLine(pickVariant("arcadeCelebration", 3));
    await new Promise((r) => setTimeout(r, 700));
  }

  async function launchGame(gameId) {
    const round = pickStandaloneRound(progress, charMap, gameId);
    if (!round.ok) {
      await showPoolTooSmall(round.needed);
      return;
    }
    await runGame(gameId, container, {
      newChars: round.newChars,
      distractorChars: round.distractorChars,
      charMap,
      progress,
    });
    await showCelebration();
    showPicker();
  }

  function showPicker() {
    const screenEl = el(`
      <div class="session-content">
        <div class="arcade-header-row">
          <button type="button" class="icon-button" id="btn-arcade-exit" aria-label="回到花园">⬅️</button>
          <button type="button" class="big-button" id="btn-arcade-random">🎲 随机玩</button>
        </div>
        <div class="arcade-grid" id="arcade-grid"></div>
      </div>
    `);
    container.replaceChildren(screenEl);

    screenEl.querySelector("#btn-arcade-exit").addEventListener("click", exitArcade);
    screenEl.querySelector("#btn-arcade-random").addEventListener("click", async () => {
      await playLine("arcadeRandomIntro");
      const gameId = GAME_INFO[Math.floor(Math.random() * GAME_INFO.length)].id;
      await launchGame(gameId);
    });

    const grid = screenEl.querySelector("#arcade-grid");
    for (const info of GAME_INFO) {
      const tile = el(`
        <button type="button" class="arcade-game-tile">
          <span class="arcade-game-icon">${info.icon}</span>
          <span class="arcade-game-name">${info.name}</span>
        </button>
      `);
      tile.addEventListener("click", () => launchGame(info.id));
      grid.appendChild(tile);
    }
  }

  showPicker();
  await playLine("arcadeWelcome");
}

// Exported for a future Parent Corner "which games exist" listing, and so
// arcade.test.js (step 2) can assert against the real id list rather than
// a duplicated one.
export { GAME_INFO, GAME_IDS };
