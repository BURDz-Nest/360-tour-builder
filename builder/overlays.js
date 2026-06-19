// overlays.js — Welcome screen, Help modal, and Images modal wiring.
//
// Keeps all the full-screen/dialog chrome in one cohesive place so builder.js
// stays focused on tour state. Receives a `$` (getElementById) and a handlers
// object (dependency injection) for the actions it can't perform itself.

import { listRecent, forgetProject } from "./project-store.js";

export function mountOverlays($, h) {
  const welcome = $("welcome");
  const recentList = $("welcome-recent");
  const imageModal = $("image-modal");

  /* ---------------- Welcome screen ---------------- */
  $("welcome-new").addEventListener("click", async () => {
    if (await h.onNew()) hideWelcome();
  });
  $("welcome-open").addEventListener("click", async () => {
    if (await h.onOpen()) hideWelcome();
  });
  $("welcome-import").addEventListener("click", () => h.onImport());

  async function renderRecent() {
    const recents = await listRecent();
    recentList.innerHTML = "";
    if (!recents.length) {
      const li = document.createElement("li");
      li.className = "welcome-recent__empty muted";
      li.textContent = "No recent projects yet — create or open one above.";
      recentList.appendChild(li);
      return;
    }
    for (const p of recents) {
      recentList.appendChild(recentRow(p));
    }
  }

  function recentRow(p) {
    const li = document.createElement("li");
    li.className = "welcome-recent__item";

    const open = document.createElement("button");
    open.className = "welcome-recent__open";
    open.type = "button";
    const name = document.createElement("span");
    name.className = "welcome-recent__name";
    name.textContent = p.name;
    const when = document.createElement("span");
    when.className = "welcome-recent__when muted";
    when.textContent = relTime(p.openedAt);
    open.append(name, when);
    open.addEventListener("click", async () => {
      if (await h.onOpenRecent(p)) hideWelcome();
    });

    const del = document.createElement("button");
    del.className = "welcome-recent__remove";
    del.type = "button";
    del.title = "Remove from recents";
    del.setAttribute("aria-label", `Remove ${p.name} from recent list`);
    del.textContent = "\u00d7";
    del.addEventListener("click", async (e) => {
      e.stopPropagation();
      await forgetProject(p.name);
      renderRecent();
    });

    li.append(open, del);
    return li;
  }

  function showWelcome() { welcome.hidden = false; renderRecent(); }
  function hideWelcome() { welcome.hidden = true; }

  /* ---------------- Images modal ---------------- */
  $("btn-images").addEventListener("click", () => {
    imageModal.hidden = false;
    h.refreshImageGrid();
  });
  $("image-modal-close").addEventListener("click", closeImageModal);
  imageModal.addEventListener("click", (e) => {
    if (e.target === imageModal) closeImageModal();
  });

  function closeImageModal() { imageModal.hidden = true; }

  /* ---------------- Global Escape ---------------- */
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (!imageModal.hidden) closeImageModal();
    // Welcome stays put — the user picks an action to leave it.
  });

  return { showWelcome, hideWelcome, renderRecent, closeImageModal };
}

function relTime(ts) {
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const hr = Math.round(m / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.round(hr / 24)}d ago`;
}
