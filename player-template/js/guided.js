/**
 * guided.js — the opt-in "guided experience" runtime (LAZY-LOADED).
 *
 * A normal tour never imports this file. player.js only does a dynamic
 * import() when meta.experience.enabled is true, so guided mode adds zero
 * weight to ordinary tours.
 *
 * Behaviour (see docs/ARCHITECTURE.md §guided):
 *   - Navigation pins are already suppressed (psv-adapter toViewerNodes with
 *     { guided:true }); progression is 100% linear + completion-driven.
 *   - The learner must OPEN every "required" info hotspot in a scene. Opening
 *     an info popup is the "found" signal (player.js forwards it here).
 *   - When all required hotspots in the scene are found, a Continue prompt
 *     slides in naming the next scene. The last scene shows Finish -> the
 *     completion screen with the author's congrats message.
 *   - No persistence: it's one-and-done (used live/instructor-led). Reopening
 *     starts fresh; a "Start over" button on the completion screen reloads.
 *
 * Pure-ish controller: it owns its own DOM (built here, namespaced .guided-*)
 * and talks to PSV only through the handles player.js passes in.
 */

import { getScene, requiredMarkers } from "./tour-model.js?v=6";

/**
 * @param {object} cfg
 * @param {object} cfg.tour          validated tour
 * @param {object} cfg.virtualTour   PSV VirtualTourPlugin instance
 * @param {object} cfg.markers       PSV MarkersPlugin instance
 * @param {HTMLElement} cfg.stageEl  element to mount the guided UI into
 * @returns {{ onEnterScene(id:string):void, onInfoOpened(id:string):void }}
 */
export function mountGuided({ tour, virtualTour, markers, stageEl }) {
  const scenes = tour.scenes || [];
  const exp = tour.meta?.experience || {};
  const tourTitle = tour.meta?.title || "";
  const wantsStart = exp.showStartScreen !== false;
  const found = new Set(); // required marker ids opened so far (whole run)
  let currentId = null;

  const ui = buildUI(stageEl);
  if (wantsStart) ui.showStart(tourTitle);

  const reqIdsFor = (scene) => requiredMarkers(scene).map((m) => m.id);
  const sceneIndex = (id) => scenes.findIndex((s) => s.id === id);

  function onEnterScene(sceneId) {
    currentId = sceneId;
    ui.hidePrompt();
    render();
  }

  function onInfoOpened(markerId) {
    const scene = getScene(tour, currentId);
    if (!scene) return;
    // A magnifier hint marker (<zoneId>__hint) counts as its underlying zone.
    const id = markerId.endsWith("__hint") ? markerId.slice(0, -6) : markerId;
    const req = reqIdsFor(scene);
    if (!req.includes(id) || found.has(id)) return; // optional/dupe
    found.add(id);
    markFoundVisual(id);
    render();
  }

  function render() {
    const scene = getScene(tour, currentId);
    if (!scene) return;
    const req = reqIdsFor(scene);
    const done = req.filter((id) => found.has(id)).length;
    ui.setProgress(done, req.length);
    if (done >= req.length) showAdvance();
  }

  function showAdvance() {
    const next = scenes[sceneIndex(currentId) + 1];
    if (next) {
      ui.showPrompt({
        text: "Nice work — you found everything here!",
        buttonLabel: `Continue to ${next.name || "the next scene"}`,
        onClick: () =>
          virtualTour
            .setCurrentNode(next.id)
            .catch((err) => console.warn("[guided] advance failed", err)),
      });
    } else {
      ui.showPrompt({
        text: "That was the final scene.",
        buttonLabel: "Finish",
        onClick: () => ui.showCompletion(exp, restart),
      });
    }
  }

  // Clean in-app restart (no page reload -> avoids the ?scene deep-link sending
  // us back to the last scene). Clears progress and jumps to the first scene;
  // the resulting node-changed fires onEnterScene -> render.
  function restart() {
    found.clear();
    ui.hideCompletion();
    ui.hidePrompt();
    const first = scenes[0];
    if (first) {
      virtualTour
        .setCurrentNode(first.id)
        .catch((err) => console.warn("[guided] restart failed", err));
    }
    if (wantsStart) ui.showStart(tourTitle); // re-welcome on Start over
  }

  // Best-effort visual "done" state on the found marker (dim + checkmark via CSS).
  // Marks the marker itself AND its magnifier hint badge, if present.
  function markFoundVisual(markerId) {
    for (const id of [markerId, `${markerId}__hint`]) {
      try {
        const m = markers.getMarker(id);
        const el = m?.domElement || m?.element;
        el?.classList?.add("guided-found");
      } catch {
        /* marker/hint may not exist; the HUD is the source of truth anyway */
      }
    }
  }

  return { onEnterScene, onInfoOpened };
}

/* ===================== UI (namespaced .guided-*) ===================== */

function buildUI(stageEl) {
  const mount = stageEl || document.body;
  let completeEl = null; // the completion overlay, if shown

  // Progress HUD (top-center pill).
  const hud = el("div", "guided-hud", { "aria-live": "polite" });
  hud.hidden = true;
  mount.append(hud);

  // Continue prompt (bottom-center card).
  const prompt = el("div", "guided-prompt");
  prompt.hidden = true;
  const promptText = el("p", "guided-prompt__text");
  const promptBtn = el("button", "guided-prompt__btn");
  promptBtn.type = "button";
  prompt.append(promptText, promptBtn);
  mount.append(prompt);

  function setProgress(done, total) {
    hud.hidden = false;
    if (total <= 0) {
      hud.textContent = "Look around, then continue";
      return;
    }
    hud.textContent = `Found ${done} of ${total}`;
    hud.classList.toggle("is-complete", done >= total);
  }

  function showPrompt({ text, buttonLabel, onClick }) {
    promptText.textContent = text;
    promptBtn.textContent = buttonLabel;
    promptBtn.onclick = onClick;
    prompt.hidden = false;
    // let the browser paint before adding the transition class
    requestAnimationFrame(() => prompt.classList.add("is-in"));
    promptBtn.focus();
  }

  function hidePrompt() {
    prompt.hidden = true;
    prompt.classList.remove("is-in");
  }

  function showCompletion(exp, onRestart) {
    hidePrompt();
    hud.hidden = true;
    hideCompletion(); // never stack two overlays
    const overlay = el("div", "guided-complete", { role: "dialog", "aria-modal": "true" });
    const card = el("div", "guided-complete__card");
    const check = el("div", "guided-complete__check");
    check.setAttribute("aria-hidden", "true");
    check.textContent = "\u2713";
    const h = el("h2", "guided-complete__title");
    h.textContent = exp.completionTitle || "Great job!";
    const p = el("p", "guided-complete__msg");
    p.textContent =
      exp.completionMessage || "You've found everything. The experience is complete.";
    const again = el("button", "guided-prompt__btn");
    again.type = "button";
    again.textContent = "Start over";
    again.onclick = () => onRestart?.();
    card.append(check, h, p, again);
    overlay.append(card);
    mount.append(overlay);
    completeEl = overlay;
    requestAnimationFrame(() => overlay.classList.add("is-in"));
    again.focus();
  }

  function hideCompletion() {
    completeEl?.remove();
    completeEl = null;
  }

  // Welcome / instructions screen shown before the run starts.
  let startEl = null;
  function showStart(title) {
    hideStart();
    const overlay = el("div", "guided-start", { role: "dialog", "aria-modal": "true" });
    const card = el("div", "guided-start__card");
    const h = el("h1", "guided-start__title");
    // "Untitled Tour" is the validator's default -> treat as no real title.
    const named = title && title !== "Untitled Tour";
    h.textContent = named ? `Welcome to ${title}` : "Welcome!";
    const list = el("ul", "guided-start__list");
    [
      "Select and drag anywhere on the image to rotate your view.",
      "When you see an opportunity, select the area.",
      "Find all opportunities in each image.",
    ].forEach((t) => {
      const li = document.createElement("li");
      li.textContent = t;
      list.append(li);
    });
    const btn = el("button", "guided-start__btn");
    btn.type = "button";
    btn.textContent = "Start";
    btn.onclick = () => hideStart();
    card.append(h, list, btn);
    overlay.append(card);
    mount.append(overlay);
    startEl = overlay;
    requestAnimationFrame(() => overlay.classList.add("is-in"));
    btn.focus();
  }

  function hideStart() {
    startEl?.remove();
    startEl = null;
  }

  return { setProgress, showPrompt, hidePrompt, showCompletion, hideCompletion, showStart, hideStart };
}

/** tiny element helper */
function el(tag, className, attrs) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (attrs) for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
}
