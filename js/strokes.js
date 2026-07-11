// Thin wrapper around the vendored Hanzi Writer library (loaded globally via
// vendor/hanzi-writer.min.js — see index.html). Everything here reads stroke
// data from assets/strokes/{char}.json instead of Hanzi Writer's default CDN
// loader, so animation/tracing works fully offline.

// Hanzi Writer's charDataLoader uses a callback, not a Promise: it calls
// onComplete(charData) when the fetch resolves.
function localCharDataLoader(char, onComplete) {
  fetch(`assets/strokes/${encodeURIComponent(char)}.json`)
    .then((res) => res.json())
    .then(onComplete)
    .catch((err) => {
      console.error(`No stroke data for ${char}`, err);
    });
}

const BASE_OPTIONS = {
  charDataLoader: localCharDataLoader,
  width: 300,
  height: 300,
  padding: 20,
};

function makeWriter(targetEl, char, overrides = {}) {
  targetEl.innerHTML = "";
  return HanziWriter.create(targetEl, char, { ...BASE_OPTIONS, ...overrides });
}

// Plays the stroke-order animation once. `withNumbers` overlays a small
// numbered badge at the start of each stroke — Hanzi Writer has no built-in
// option for this, so the badges are hand-drawn from the raw character
// data using HanziWriter.getScalingTransform to match its own coordinate
// space exactly.
//
// Animation timing (requestAnimationFrame-based) can in principle stall if
// the tablet screen is backgrounded mid-animation — a hard timeout means
// that can never wedge the session open forever; it just moves on.
const ANIMATION_TIMEOUT_MS = 20000;

export function animateCharacterOnce(targetEl, char, { speed = 1, withNumbers = false } = {}) {
  return new Promise((resolve) => {
    const writer = makeWriter(targetEl, char, { strokeAnimationSpeed: speed });
    if (withNumbers) {
      localCharDataLoader(char, (charData) => {
        addStrokeNumberBadges(targetEl, charData);
      });
    }
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    writer.animateCharacter({ onComplete: finish });
    setTimeout(finish, ANIMATION_TIMEOUT_MS);
  });
}

function addStrokeNumberBadges(targetEl, charData) {
  const svg = targetEl.querySelector("svg");
  if (!svg) return;

  const { transform } = HanziWriter.getScalingTransform(BASE_OPTIONS.width, BASE_OPTIONS.height, BASE_OPTIONS.padding);

  const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
  group.setAttribute("transform", transform);

  charData.strokes.forEach((_, i) => {
    const median = charData.medians[i];
    const [x, y] = median[0];

    // The character-data coordinate space is y-flipped relative to normal
    // SVG text (that's invisible for path shapes but leaves glyphs upside
    // down), so each badge gets its own counter-flip around its own point.
    const badgeGroup = document.createElementNS("http://www.w3.org/2000/svg", "g");
    badgeGroup.setAttribute("transform", `translate(${x}, ${y}) scale(1, -1)`);

    const badge = document.createElementNS("http://www.w3.org/2000/svg", "text");
    badge.setAttribute("font-size", "70");
    badge.setAttribute("fill", "#4caf50");
    badge.setAttribute("font-weight", "bold");
    badge.textContent = String(i + 1);
    badgeGroup.appendChild(badge);
    group.appendChild(badgeGroup);
  });

  svg.appendChild(group);
}

// Trace-with-hints quiz (spec: leniency ~1.5, hint after 2 misses on a stroke).
export function runTraceHintQuiz(targetEl, char, { onComplete } = {}) {
  const writer = makeWriter(targetEl, char, { showOutline: true });
  writer.quiz({
    leniency: 1.5,
    showHintAfterMisses: 2,
    onComplete: (summary) => onComplete?.(summary),
  });
  return writer;
}

// Trace-with-only-a-faint-outline: same as above but no hints offered and a
// lighter outline, since this step is meant to be a little harder.
export function runFaintOutlineTrace(targetEl, char, { onComplete } = {}) {
  const writer = makeWriter(targetEl, char, { showOutline: true, outlineColor: "#EEE" });
  writer.quiz({
    leniency: 1.5,
    showHintAfterMisses: 999, // effectively "no hints"
    onComplete: (summary) => onComplete?.(summary),
  });
  return writer;
}

// Write-from-memory: character and outline both hidden, hints only after
// several misses so it stays a real memory test.
export function runWriteFromMemoryQuiz(targetEl, char, { onComplete } = {}) {
  const writer = makeWriter(targetEl, char, { showCharacter: false, showOutline: false });
  writer.quiz({
    leniency: 1.5,
    showHintAfterMisses: 5,
    onComplete: (summary) => onComplete?.(summary),
  });
  return writer;
}
