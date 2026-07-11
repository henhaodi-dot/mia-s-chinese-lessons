// Quiz-ladder logic: which quiz types are allowed at a given growth stage,
// and how to pick plausible-but-wrong answer choices (distractors).
//
// This module only decides *what* quiz to run and *what* the choices are —
// session.js is what actually renders a quiz screen and waits for a tap.

export const QUIZ_TYPES = {
  AUDIO_TO_CHAR: "AUDIO_TO_CHAR",
  CHAR_TO_PIC: "CHAR_TO_PIC",
  PIC_TO_CHAR: "PIC_TO_CHAR",
  TRACE_HINT: "TRACE_HINT",
  WRITE_MEMORY: "WRITE_MEMORY",
};

// Listed easiest-first; a stage's allowed set is a slice of this ladder,
// and later (harder) entries get more weight when picking randomly.
const LADDER_BY_BOX = {
  1: [QUIZ_TYPES.AUDIO_TO_CHAR, QUIZ_TYPES.CHAR_TO_PIC],
  2: [QUIZ_TYPES.AUDIO_TO_CHAR, QUIZ_TYPES.CHAR_TO_PIC, QUIZ_TYPES.PIC_TO_CHAR, QUIZ_TYPES.TRACE_HINT],
  3: [QUIZ_TYPES.AUDIO_TO_CHAR, QUIZ_TYPES.CHAR_TO_PIC, QUIZ_TYPES.PIC_TO_CHAR, QUIZ_TYPES.TRACE_HINT],
  4: [QUIZ_TYPES.AUDIO_TO_CHAR, QUIZ_TYPES.CHAR_TO_PIC, QUIZ_TYPES.PIC_TO_CHAR, QUIZ_TYPES.WRITE_MEMORY],
  5: [QUIZ_TYPES.AUDIO_TO_CHAR, QUIZ_TYPES.CHAR_TO_PIC, QUIZ_TYPES.PIC_TO_CHAR, QUIZ_TYPES.WRITE_MEMORY],
};

export function allowedQuizTypesForBox(box) {
  return LADDER_BY_BOX[box] || LADDER_BY_BOX[1];
}

// Weighted random pick, biased toward the harder (later) end of the list.
export function pickQuizType(box) {
  const allowed = allowedQuizTypesForBox(box);
  const weights = allowed.map((_, i) => i + 1);
  const totalWeight = weights.reduce((a, b) => a + b, 0);

  let roll = Math.random() * totalWeight;
  for (let i = 0; i < allowed.length; i++) {
    roll -= weights[i];
    if (roll <= 0) return allowed[i];
  }
  return allowed[allowed.length - 1];
}

function shuffle(array) {
  const copy = [...array];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

// Picks `count` distractor entries for `target` out of `metPool` (character
// entries she has already been introduced to). Prefers same-pinyin-initial
// characters first (a rough stand-in for "phonetically plausible"), then
// fills any remaining slots randomly.
export function pickDistractors(target, metPool, count) {
  const candidates = metPool.filter((entry) => entry.char !== target.char);
  const targetInitial = target.pinyin[0];

  const sameInitial = shuffle(candidates.filter((entry) => entry.pinyin[0] === targetInitial));
  const rest = shuffle(candidates.filter((entry) => entry.pinyin[0] !== targetInitial));

  return [...sameInitial, ...rest].slice(0, count);
}

// Distractor characters should be drawn from the *strongest* characters
// when used for the new-character-intro confidence check, so it almost
// always succeeds. "Strongest" = highest box, ties broken randomly.
export function pickStrongestDistractors(exclude, metPool, count) {
  const candidates = metPool.filter((entry) => entry.char !== exclude.char);
  const sorted = shuffle(candidates).sort((a, b) => b.box - a.box);
  return sorted.slice(0, count);
}
