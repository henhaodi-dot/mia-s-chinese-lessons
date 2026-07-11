// Print worksheet page. Standalone from the main app — loads the same
// data files and stroke JSON, but renders static SVG (via HanziWriter's
// getScalingTransform, the same technique used for the stroke-number
// badges elsewhere) instead of interactive Hanzi Writer instances.

import { loadCharacterMap } from "./data.js";
import { loadProgress } from "./progress.js";
import { getThisWeeksCharacters } from "./weekly.js";

let charMap;
let progress;
const strokeDataCache = new Map();

async function loadStrokeData(char) {
  if (strokeDataCache.has(char)) return strokeDataCache.get(char);
  const res = await fetch(`assets/strokes/${encodeURIComponent(char)}.json`);
  const data = await res.json();
  strokeDataCache.set(char, data);
  return data;
}

// Renders `strokeCount` cumulative strokes (1..N) into a small square SVG
// of `size` pixels. Reuses the same scaling-transform technique as the
// stroke-number badges in strokes.js.
function renderStrokeSvg(charData, strokeCount, size, color) {
  const { transform } = HanziWriter.getScalingTransform(size, size, size * 0.08);
  const paths = charData.strokes
    .slice(0, strokeCount)
    .map((d) => `<path d="${d}" fill="${color}"></path>`)
    .join("");
  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><g transform="${transform}">${paths}</g></svg>`;
}

// ---------- character picker ----------

function renderCharacterPicker(preselected) {
  const picker = document.getElementById("character-picker");
  const preselectedChars = new Set(preselected.map((e) => e.char));

  const allSorted = Array.from(charMap.values()).sort((a, b) => a.rank - b.rank);

  picker.innerHTML = allSorted
    .map(
      (entry) => `
        <label>
          <input type="checkbox" value="${entry.char}" ${preselectedChars.has(entry.char) ? "checked" : ""} />
          ${entry.char}
        </label>
      `
    )
    .join("");

  picker.addEventListener("change", renderWorksheet);
}

function getSelectedChars() {
  return Array.from(document.querySelectorAll('#character-picker input:checked')).map((el) => el.value);
}

// ---------- worksheet ----------

const CELL_PX = 68; // ~1.8cm at 96dpi, matches .tianzige in print.css
const FAN_CELL_PX = 42; // ~1.1cm, matches .fanning-cell

// Rendering awaits a stroke-data fetch per character, so rapid consecutive
// calls (e.g. clicking "select all" then "select this week" right after)
// can overlap. A generation token lets a stale in-flight render notice
// it's been superseded and stop appending instead of racing the new one.
let renderGeneration = 0;

async function renderWorksheet() {
  const myGeneration = ++renderGeneration;
  const worksheet = document.getElementById("worksheet");
  const selected = getSelectedChars();
  worksheet.innerHTML = "";

  if (selected.length === 0) {
    worksheet.innerHTML = `<p class="empty-state-message">请从上面选择至少一个字，练习纸会显示在这里。</p>`;
    return;
  }

  // Fetch every character's stroke data in parallel first — sequential
  // awaits made "select all" (200 characters) take 15+ seconds.
  const loaded = await Promise.all(
    selected.map(async (char) => {
      try {
        return [char, await loadStrokeData(char)];
      } catch {
        return [char, null];
      }
    })
  );

  if (myGeneration !== renderGeneration) return; // superseded by a newer render

  for (const [char, charData] of loaded) {
    const entry = charMap.get(char);
    if (!entry || !charData) continue; // no stroke data for this character yet — skip its row

    const row = document.createElement("div");
    row.className = "worksheet-row";

    const fanning = document.createElement("div");
    fanning.className = "fanning-strokes";
    for (let i = 1; i <= charData.strokes.length; i++) {
      const cell = document.createElement("div");
      cell.className = "fanning-cell";
      cell.innerHTML = renderStrokeSvg(charData, i, FAN_CELL_PX, "#333");
      fanning.appendChild(cell);
    }
    row.appendChild(fanning);

    const traceCell = document.createElement("div");
    traceCell.className = "tianzige trace-cell";
    traceCell.innerHTML = renderStrokeSvg(charData, charData.strokes.length, CELL_PX, "#ccc");
    row.appendChild(traceCell);

    for (let i = 0; i < 6; i++) {
      const blank = document.createElement("div");
      blank.className = "tianzige";
      row.appendChild(blank);
    }

    worksheet.appendChild(row);
  }
}

// ---------- controls ----------

function wireControls() {
  document.getElementById("btn-size-letter").addEventListener("click", () => setPaperSize("letter"));
  document.getElementById("btn-size-a4").addEventListener("click", () => setPaperSize("A4"));
  document.getElementById("btn-print").addEventListener("click", () => window.print());

  document.getElementById("btn-select-week").addEventListener("click", () => {
    const weekChars = new Set(getThisWeeksCharacters(progress, charMap).map((e) => e.char));
    document.querySelectorAll("#character-picker input").forEach((el) => {
      el.checked = weekChars.has(el.value);
    });
    renderWorksheet();
  });

  document.getElementById("btn-select-all").addEventListener("click", () => {
    document.querySelectorAll("#character-picker input").forEach((el) => (el.checked = true));
    renderWorksheet();
  });

  document.getElementById("btn-select-none").addEventListener("click", () => {
    document.querySelectorAll("#character-picker input").forEach((el) => (el.checked = false));
    renderWorksheet();
  });
}

function setPaperSize(size) {
  document.getElementById("page-size-style").textContent = `@page { size: ${size}; margin: 1cm; }`;
  document.getElementById("btn-size-letter").classList.toggle("active", size === "letter");
  document.getElementById("btn-size-a4").classList.toggle("active", size === "A4");
}

async function main() {
  charMap = await loadCharacterMap();
  progress = loadProgress();

  const defaultChars = getThisWeeksCharacters(progress, charMap);
  renderCharacterPicker(defaultChars);
  wireControls();
  await renderWorksheet();
}

main();
