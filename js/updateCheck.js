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

async function waitForActivation(registration) {
  const worker = registration.installing || registration.waiting;
  if (!worker) return;
  await new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      resolve();
    };
    worker.addEventListener("statechange", () => {
      if (worker.state === "activated") finish();
    });
    setTimeout(finish, 8000); // never let a stuck worker block the reload forever
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
      await waitForActivation(registration);
    }
    location.reload();
  } catch {
    // Offline, or version.json unreachable — run the cached version silently.
  }
}
