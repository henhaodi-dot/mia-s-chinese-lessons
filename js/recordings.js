// Voice recordings store (IndexedDB). Her recordings never leave the device
// and are kept deliberately OUT of the progress export JSON — they'd bloat
// it hugely — so this is their only home. IndexedDB (not localStorage)
// because Blobs belong in it and it has real room.
//
// "Best per item": saveRecording keeps whichever take scores higher (louder
// AND long enough to be a real utterance), so re-recording a word only ever
// improves the kept clip, never replaces a good one with a silent retry.
//
// Everything degrades to a safe no-op if IndexedDB is unavailable or errors,
// so in-session record/playback still works even when nothing can persist.

const DB_NAME = "hanziGardenVoice";
const DB_VERSION = 1;
const STORE = "recordings";

let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    if (typeof indexedDB === "undefined") {
      resolve(null);
      return;
    }
    let req;
    try {
      req = indexedDB.open(DB_NAME, DB_VERSION);
    } catch {
      resolve(null);
      return;
    }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
  });
  return dbPromise;
}

function store(db, mode) {
  return db.transaction(STORE, mode).objectStore(STORE);
}

// How "good" a take is: loudness scaled down when it's too short to be a
// real word (so a stray tap-noise never beats a real utterance). Also the
// heuristic Step 4's voice gallery uses for its "sounded especially clear"
// gold border.
export function recordingScore(rec) {
  if (!rec) return 0;
  const durationFactor = Math.min(1, (rec.durationMs || 0) / 800);
  return (rec.rms || 0) * durationFactor;
}

// record: { id, blob, char, kind, text, durationMs, rms, createdAt }
// id convention mirrors the model audio keys — `char_我`, `word_我`,
// `sentence_我` — so the gallery can play the model right next to hers.
export async function saveRecording(record) {
  const db = await openDb();
  if (!db) return false;

  const existing = await getRecording(record.id);
  if (existing && recordingScore(existing) > recordingScore(record)) {
    return false; // the take we already have is better — keep it
  }

  return new Promise((resolve) => {
    try {
      const req = store(db, "readwrite").put(record);
      req.onsuccess = () => resolve(true);
      req.onerror = () => resolve(false);
    } catch {
      resolve(false);
    }
  });
}

export async function getRecording(id) {
  const db = await openDb();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const req = store(db, "readonly").get(id);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export async function hasRecording(id) {
  return Boolean(await getRecording(id));
}

export async function getAllRecordings() {
  const db = await openDb();
  if (!db) return [];
  return new Promise((resolve) => {
    try {
      const req = store(db, "readonly").getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => resolve([]);
    } catch {
      resolve([]);
    }
  });
}

export async function deleteRecording(id) {
  const db = await openDb();
  if (!db) return false;
  return new Promise((resolve) => {
    try {
      const req = store(db, "readwrite").delete(id);
      req.onsuccess = () => resolve(true);
      req.onerror = () => resolve(false);
    } catch {
      resolve(false);
    }
  });
}

export async function countRecordings() {
  return (await getAllRecordings()).length;
}
