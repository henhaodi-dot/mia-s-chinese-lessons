// Runtime update check — the app's only network request beyond what's
// needed to actually use it. On every open, fetch version.json bypassing
// every layer of caching. If it doesn't match the version baked into the
// JS that's currently running, a new deploy exists that the service worker
// hasn't picked up yet: nudge it to update, wait for the new worker to
// activate, then reload so the page actually runs the new files. Offline or
// a failed fetch just runs the cached version silently — this is
// best-effort, never blocking.

import { APP_VERSION } from "./version.js";

function showUpdateToast() {
  const toast = document.createElement("div");
  toast.className = "update-toast";
  toast.textContent = "有新内容，正在更新…";
  document.body.appendChild(toast);
}

// Waits for the NEW worker to actually take control of this page (fires
// once, after its activate handler calls clients.claim()) rather than just
// "finished installing" — that's the real signal a reload will get fresh
// files instead of silently re-serving the old worker's stale cache.
// sw.js's install step fetches every character's audio/image/stroke data
// (~1200 requests) in small batches, which can genuinely take well past a
// few seconds on a slow phone/tablet connection; 45s gives that a real
// chance instead of guessing a short timeout and reloading too early.
function waitForControl() {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      resolve();
    };
    navigator.serviceWorker.addEventListener("controllerchange", finish, { once: true });
    setTimeout(finish, 45000);
  });
}

export async function checkForUpdate() {
  if (!("serviceWorker" in navigator)) return;

  try {
    const res = await fetch("./version.json", { cache: "no-store" });
    if (!res.ok) return;
    const { v } = await res.json();
    if (!v || v === APP_VERSION) return;

    showUpdateToast();
    const registration = await navigator.serviceWorker.getRegistration();
    if (registration) {
      await registration.update();
      // Only worth waiting if an update is actually in flight — if
      // update() found nothing new (e.g. this worker already IS the new
      // one and only version.json/APP_VERSION were slow to line up),
      // there's no controllerchange coming and waiting is pure delay.
      if (registration.installing || registration.waiting) {
        await waitForControl();
      }
    }
    location.reload();
  } catch {
    // Offline, or version.json unreachable — run the cached version silently.
  }
}
