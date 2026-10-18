// Screen navigation + cancellation for the rooms.
//
// Every room (说说话, 认认字, 故事, a garden tap review, the studio) is an
// async "run": a chain of awaits — play a line, wait for a tap, sleep, wait
// for a stroke quiz. Before this module existed, leaving a room with the
// tablet's back button only hid the screen; the run itself kept going
// underneath (audio kept playing, the bubble game's timers kept firing, and
// abandoned tap listeners stayed attached to the shared container, so the
// next visit could handle a single tap twice).
//
// The fix is one AbortController per run. Every await point a room goes
// through (playLine, sleep, waitForTap, waitForClick, untilAborted, the
// recorder) registers on the CURRENT run's signal at call time, and rejects
// with RunAborted the moment the run is aborted. That rejection unwinds the
// whole async chain through its `finally` blocks, so the room cleans up and
// returns to app.js like a normal exit. app.js aborts the run from its
// popstate handler (back button / the 🏠 exit button) and swallows
// RunAborted.
//
// The one rule that keeps this sound: inside a room, NEVER await a bare
// `new Promise(...)`/`setTimeout` directly — go through the helpers here so
// the await is an abort point. A stale run that resumes from a non-abortable
// await AFTER a new run has started would read the new run's signal and
// carry on as if it were still alive.

export class RunAborted extends Error {
  constructor() {
    super("run aborted");
    this.name = "RunAborted";
  }
}

let current = null; // { id, controller }
let runSeq = 0;

// An aborted run that hasn't unwound yet reports no id: it no longer owns
// its history entry (app.js's popstate check relies on that).
export function currentRunId() {
  return current && !current.controller.signal.aborted ? current.id : null;
}

function currentSignal() {
  return current ? current.controller.signal : null;
}

export function isAborted() {
  const signal = currentSignal();
  return Boolean(signal && signal.aborted);
}

export function throwIfAborted() {
  if (isAborted()) throw new RunAborted();
}

// Starts a new run (aborting any run still in flight — a safety net; app.js
// also refuses to open a second room while one is active).
function startRun() {
  abortRun();
  runSeq += 1;
  current = { id: runSeq, controller: new AbortController() };
  return current;
}

// Aborts the run in flight, if any. Safe to call when nothing is running.
//
// The aborted run deliberately STAYS current until its room unwinds
// (leaveScreen → endRun) or the next run starts. It used to be cleared right
// here, and that turned any non-abortable await into a zombie: a run that
// was parked in, say, playLine's first-play HEAD probe when 🏠 was tapped
// woke up to find no current run at all, so every later sleep/waitForTap/
// playLine bound to nothing and could never be aborted again — the panda
// kept talking over the garden, held the mic, and left a tap listener on
// the shared container that scored the NEXT visit's taps. Keeping the
// aborted signal around makes any such late call reject at once instead.
// (Side effect: a garden-level playLine in that brief window rejects too —
// silence, which is the safe failure.)
export function abortRun() {
  if (current && !current.controller.signal.aborted) current.controller.abort();
}

function endRun(run) {
  if (current === run) current = null;
}

// ---------- screens ----------
//
// enterScreen/leaveScreen pair up: a room calls enterScreen at its start and
// leaveScreen in its `finally`. enterScreen pushes a history entry so the
// tablet's back button returns to the garden instead of leaving the app
// (app.js's popstate handler does the actual abort + hide). leaveScreen pops
// that entry again on a normal exit, so the history stack never grows —
// without that, every completed activity left one more entry behind and a
// child needed N back-presses to leave the app after N activities.

export function enterScreen(id) {
  const run = startRun();
  history.pushState({ hanziGardenScreen: id, run: run.id }, "");
  const screen = document.getElementById(id);
  if (screen) screen.classList.remove("hidden");
  return run;
}

export function leaveScreen(id, run) {
  // Only hide the screen if no newer run has taken over: a late unwind of an
  // old room must not blank a fresh visit to the same room.
  const screen = document.getElementById(id);
  if (screen && (current === null || current === run)) screen.classList.add("hidden");
  const wasAborted = run.controller.signal.aborted;
  endRun(run);
  // On an abort the entry was already popped (that's what triggered the
  // abort). On a normal exit pop it ourselves — but only if it's still the
  // current entry, so we never step back past something we didn't push.
  if (!wasAborted && history.state && history.state.hanziGardenScreen === id && history.state.run === run.id) {
    history.back();
  }
}

// ---------- abort-aware primitives ----------

// Registers `onAbort` on the current run's signal (if any) and returns an
// unsubscribe function. Calls onAbort immediately if already aborted.
// Exported (as onAbortOfCurrentRun) for audio.js/recorder.js, which manage
// their own promises.
function onCurrentAbort(onAbort) {
  const signal = currentSignal();
  if (!signal) return () => {};
  if (signal.aborted) {
    onAbort();
    return () => {};
  }
  signal.addEventListener("abort", onAbort, { once: true });
  return () => signal.removeEventListener("abort", onAbort);
}

export const onAbortOfCurrentRun = onCurrentAbort;

export function sleep(ms) {
  return new Promise((resolve, reject) => {
    let timer = null;
    const off = onCurrentAbort(() => {
      if (timer !== null) clearTimeout(timer);
      reject(new RunAborted());
    });
    timer = setTimeout(() => {
      off();
      resolve();
    }, ms);
  });
}

// Wraps any promise so the await also ends (with RunAborted) if the run is
// aborted first. For things that resolve via their own callbacks — Hanzi
// Writer quizzes and animations, a MediaRecorder stop, IndexedDB.
export function untilAborted(promise) {
  return new Promise((resolve, reject) => {
    const off = onCurrentAbort(() => reject(new RunAborted()));
    Promise.resolve(promise).then(
      (value) => {
        off();
        resolve(value);
      },
      (err) => {
        off();
        reject(err);
      }
    );
  });
}

// Resolves with the first element matching `selector` that gets clicked
// inside `container`. Clicks elsewhere are ignored (the listener stays).
export function waitForTap(container, selector) {
  return new Promise((resolve, reject) => {
    const handler = (e) => {
      const hit = e.target.closest(selector);
      if (!hit || !container.contains(hit)) return;
      container.removeEventListener("click", handler);
      off();
      resolve(hit);
    };
    const off = onCurrentAbort(() => {
      container.removeEventListener("click", handler);
      reject(new RunAborted());
    });
    container.addEventListener("click", handler);
  });
}

// Resolves when `element` is clicked. `value` (optional) is what the promise
// resolves with — handy for "which button did she tap" screens.
export function waitForClick(element, value) {
  return new Promise((resolve, reject) => {
    const handler = () => {
      element.removeEventListener("click", handler);
      off();
      resolve(value);
    };
    const off = onCurrentAbort(() => {
      element.removeEventListener("click", handler);
      reject(new RunAborted());
    });
    element.addEventListener("click", handler);
  });
}

// Resolves with the value of whichever of several buttons is tapped first.
// `choices` is [[element, value], ...].
export function waitForAnyClick(choices) {
  return new Promise((resolve, reject) => {
    const handlers = choices.map(([element, value]) => {
      const handler = () => {
        cleanup();
        resolve(value);
      };
      element.addEventListener("click", handler);
      return [element, handler];
    });
    const off = onCurrentAbort(() => {
      cleanup();
      reject(new RunAborted());
    });
    function cleanup() {
      off();
      for (const [element, handler] of handlers) element.removeEventListener("click", handler);
    }
  });
}
