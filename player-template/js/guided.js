/**
 * guided.js — the opt-in "guided experience" runtime (LAZY-LOADED).
 *
 * A normal tour never imports this file. player.js only does a dynamic
 * import() when meta.experience.enabled is true, so guided mode adds zero
 * weight to ordinary tours.
 *
 *  * Behaviour (see ARCHITECTURE.md "Guided experience"):
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

import { getScene, requiredMarkers } from "./tour-model.js?v=8";
import { mountLanguageToggle } from "./language-toggle.js?v=1";
import { tFor } from "./i18n.js?v=2";

/**
 * @param {object} cfg
 * @param {object} cfg.tour          validated tour
 * @param {object} cfg.virtualTour   PSV VirtualTourPlugin instance
 * @param {object} cfg.markers       PSV MarkersPlugin instance
 * @param {HTMLElement} cfg.stageEl  element to mount the guided UI into
 * @param {() => void} [cfg.onComplete]  fired once when the run is finished
 *                                       (used to report SCORM completion)
 * @param {string[]} [cfg.languages]        all available language codes (>1 to show a picker)
 * @param {string} [cfg.activeLanguage]     the currently-loaded language code
 * @param {(code:string) => void} [cfg.onLanguageChange]  fired from the welcome
 *   screen's language picker — player.js handles the actual tour swap
 *   (see switchLanguage()); this controller is fully torn down + remounted
 *   fresh either way, so it never needs to react mid-run.
 * @returns {{ onEnterScene(id:string):void, onInfoOpened(id:string):void, destroy():void }}
 */
export function mountGuided({
  tour, virtualTour, markers, stageEl, onComplete, inLms = false,
  languages, activeLanguage, onLanguageChange,
}) {
  const scenes = tour.scenes || [];
  const exp = tour.meta?.experience || {};
  const tourTitle = tour.meta?.title || "";
  const wantsStart = exp.showStartScreen !== false;
  const allowSkipping = !!exp.allowSkipping;
  const found = new Set(); // required marker ids opened so far (whole run)
  let currentId = null;

  // Facilitator escape hatch: jump N scenes forward/back, overriding the
  // find-the-hotspots lock. Guarded to the scene list bounds.
  function skipScene(delta) {
    const target = scenes[sceneIndex(currentId) + delta];
    if (!target) return;
    ui.hidePrompt();
    virtualTour
      .setCurrentNode(target.id)
      .catch((err) => console.warn("[guided] skip failed", err));
  }

  const ui = buildUI(stageEl, { allowSkipping, onSkip: skipScene, inLms, languages, activeLanguage, onLanguageChange });
  if (wantsStart) ui.showStart(tourTitle, exp);

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
    ui.updateNav(sceneIndex(currentId), scenes.length);
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
        onClick: () => {
          onComplete?.(); // report completion to the LMS (if any)
          ui.showCompletion(exp, restart);
        },
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
    ui.showNav(); // completion hid the arrows; bring them back for the rerun
    const first = scenes[0];
    if (first) {
      virtualTour
        .setCurrentNode(first.id)
        .catch((err) => console.warn("[guided] restart failed", err));
    }
    if (wantsStart) ui.showStart(tourTitle, exp); // re-welcome on Start over
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

  return { onEnterScene, onInfoOpened, destroy: ui.destroy };
}

/* ===================== UI (namespaced .guided-*) ===================== */

function buildUI(stageEl, {
  allowSkipping = false, onSkip, inLms = false,
  languages, activeLanguage, onLanguageChange,
} = {}) {
  const mount = stageEl || document.body;
  let completeEl = null; // the completion overlay, if shown

  // Progress HUD (top-center pill).
  const hud = el("div", "guided-hud", { "aria-live": "polite" });
  hud.hidden = true;
  mount.append(hud);

  // Facilitator skip arrows (prev/next scene). Only built when the author
  // enabled "Allow scene skipping" — they OVERRIDE the find-the-hotspots lock.
  let prevBtn = null;
  let nextBtn = null;
  let navEl = null;
  if (allowSkipping) {
    navEl = el("div", "guided-nav");
    prevBtn = navBtn("prev", "Previous scene", () => onSkip?.(-1));
    nextBtn = navBtn("next", "Next scene (skip ahead)", () => onSkip?.(1));
    navEl.append(prevBtn, nextBtn);
    // Visible from the start unless a welcome screen is about to cover it.
    navEl.hidden = false;
    mount.append(navEl);
  }

  /** Enable/disable the arrows for the current scene position. */
  function updateNav(index, total) {
    if (!navEl) return;
    if (prevBtn) prevBtn.disabled = index <= 0;
    if (nextBtn) nextBtn.disabled = index >= total - 1;
  }
  function showNav() {
    if (navEl) navEl.hidden = false;
  }
  function hideNav() {
    if (navEl) navEl.hidden = true;
  }

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
    hideNav(); // the run is over — no more skipping
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
    card.append(check, h, p);

    if (inLms) {
      // SCORM path: completion was ALREADY reported when they clicked "Finish"
      // on the last scene — nothing here needs to trigger it. So we just tell
      // them they're done and to close the window. The "Start over" of the
      // non-LMS flow is intentionally omitted (it can't restart a SCO cleanly).
      const instr = el("p", "guided-complete__msg guided-complete__instr");
      instr.textContent =
        "Your completion has been recorded. You can now close this window to return to your course.";
      // Best-effort convenience button. If the browser won't close the launch
      // window, the instruction above still tells the learner what to do — so
      // the button is never a dead end and never restarts the experience.
      const closeBtn = el("button", "guided-prompt__btn");
      closeBtn.type = "button";
      closeBtn.textContent = "Close window";
      closeBtn.onclick = () => tryCloseLmsWindow();
      card.append(instr, closeBtn);
      overlay.append(card);
      mount.append(overlay);
      completeEl = overlay;
      requestAnimationFrame(() => overlay.classList.add("is-in"));
      closeBtn.focus();
      return;
    }

    // Non-LMS path (e.g. WebGL associate tours): keep the familiar "Start over".
    const again = el("button", "guided-prompt__btn");
    again.type = "button";
    again.textContent = "Start over";
    again.onclick = () => onRestart?.();
    card.append(again);
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

  // Welcome / instructions screen shown before the run starts. Title, body,
  // and the button label are ordinary tour CONTENT (meta.experience.welcome*),
  // authored/edited in the builder's Tour settings panel and translated like
  // everything else when an author ships a tour-<code>.json sibling.
  let startEl = null;
  let startLangToggle = null; // { setActive, destroy } from mountLanguageToggle(), or null
  function showStart(title, exp = {}) {
    hideStart();
    hideNav(); // don't let arrows peek from behind the welcome card
    const overlay = el("div", "guided-start", { role: "dialog", "aria-modal": "true" });
    const card = el("div", "guided-start__card");

    // Language dropdown — top-right of the card, above the title. Same
    // reusable component + look as the free-roam header toggle (just
    // restyled for a light card via .guided-start__langhost in guided.css);
    // only rendered when this tour has >1 language variant. Picking one
    // hands off to onLanguageChange (player.js's switchLanguage), which
    // tears this whole controller down and remounts it fresh against the
    // new language's tour — so the run always starts clean, never
    // half-translated.
    if (Array.isArray(languages) && languages.length > 1) {
      card.classList.add("has-lang-toggle"); // extra top padding, see guided.css
      const langHost = el("div", "guided-start__langhost");
      card.append(langHost);
      startLangToggle = mountLanguageToggle({
        languages, active: activeLanguage, mountEl: langHost,
        onChange: (code) => onLanguageChange?.(code),
      });
    }

    const h = el("h1", "guided-start__title");
    // "Untitled Tour" is the validator's default -> treat as no real title.
    const named = title && title !== "Untitled Tour";
    const customTitle = (exp.welcomeTitle || "").trim();
    // Fallback boilerplate ONLY (author left welcomeTitle blank) is localized
    // via i18n.js#tFor so it doesn't leak English into an otherwise-Spanish
    // (etc.) welcome screen — author-set welcomeTitle always wins outright.
    h.textContent = customTitle
      || (named ? tFor(activeLanguage, "welcomeTitled").replace("{title}", title) : tFor(activeLanguage, "welcomeBare"));
    card.append(h);

    const body = el("div", "guided-start__body");
    renderWelcomeBody(body, exp.welcomeBody);
    card.append(body);

    const btn = el("button", "guided-start__btn");
    btn.type = "button";
    btn.textContent = (exp.startButtonLabel || "").trim() || tFor(activeLanguage, "startButton");
    btn.onclick = () => {
      hideStart();
      showNav(); // reveal the skip arrows once the run actually begins
    };
    card.append(btn);
    overlay.append(card);
    mount.append(overlay);
    startEl = overlay;
    requestAnimationFrame(() => overlay.classList.add("is-in"));
    btn.focus();
  }

  function hideStart() {
    startLangToggle?.destroy(); // drop its document-level click/Escape listeners
    startLangToggle = null;
    startEl?.remove();
    startEl = null;
  }

  /** Tear down every DOM node this controller created. Called by player.js
   *  before remounting on a language switch (or if the player unmounts). */
  function destroy() {
    hud.remove();
    navEl?.remove();
    prompt.remove();
    hideStart();
    hideCompletion();
  }

  return {
    setProgress, showPrompt, hidePrompt, showCompletion, hideCompletion,
    showStart, hideStart, updateNav, showNav, hideNav, destroy,
  };
}

/**
 * Best-effort close of the LMS launch window. A window can only be closed by
 * script if script opened it — which is true for Moodle's "new window" (popup)
 * launch. We aim at window.top (the popup), not our own iframe. If the browser
 * refuses (same-window launch, or policy), nothing happens and the caller shows
 * a "you can close this" hint instead. All wrapped in try/catch for safety.
 */
function tryCloseLmsWindow() {
  try {
    const top = window.top || window;
    top.close();
  } catch {
    /* browser refused / cross-origin — caller falls back to a hint */
  }
  try {
    window.close(); // also try our own window in case we ARE the popup
  } catch {
    /* ignore */
  }
}

/** Build one skip-arrow button (chevron SVG). */
function navBtn(dir, label, onClick) {
  const b = el("button", `guided-nav__btn guided-nav__${dir}`, {
    type: "button",
    "aria-label": label,
    title: label,
  });
  // Chevron points the way it navigates.
  const d = dir === "prev" ? "M15 5 L8 12 L15 19" : "M9 5 L16 12 L9 19";
  b.innerHTML =
    `<svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true" ` +
    `fill="none" stroke="currentColor" stroke-width="2.5" ` +
    `stroke-linecap="round" stroke-linejoin="round"><path d="${d}"/></svg>`;
  b.addEventListener("click", onClick);
  return b;
}

/** tiny element helper */
function el(tag, className, attrs) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (attrs) for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
}

/**
 * Mini-markdown renderer for the welcome screen body (meta.experience.welcomeBody).
 * Supports exactly two things, on purpose — this is a tour-authoring field, not
 * a general-purpose editor:
 *   - lines starting with "- " render as an arrow-bullet <li> (grouped into one
 *     <ul> per consecutive run of bullet lines, matching the original design)
 *   - any other non-blank line renders as a plain <p>
 * ...and "**bold**" spans render as <strong> INSIDE either. Built with real DOM
 * nodes (never innerHTML) so authored/translated content can never inject markup.
 */
function renderWelcomeBody(container, body) {
  const lines = String(body || "").split("\n");
  let list = null; // the currently-open <ul>, or null between bullet runs
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) { list = null; continue; } // blank line: end any open list, no output
    if (line.startsWith("- ")) {
      if (!list) {
        list = el("ul", "guided-start__list");
        container.appendChild(list);
      }
      const li = document.createElement("li");
      appendFormatted(li, line.slice(2));
      list.appendChild(li);
    } else {
      list = null;
      const p = el("p", "guided-start__para");
      appendFormatted(p, line);
      container.appendChild(p);
    }
  }
}

/** Append `text` to `parent` as DOM nodes, turning **bold** spans into <strong>.
 *  Plain text nodes elsewhere — never innerHTML, so this can't inject markup. */
function appendFormatted(parent, text) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  for (const part of parts) {
    if (!part) continue;
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
      const strong = document.createElement("strong");
      strong.textContent = part.slice(2, -2);
      parent.appendChild(strong);
    } else {
      parent.appendChild(document.createTextNode(part));
    }
  }
}
