/**
 * player.js — bootstraps the read-only WebGL tour from a ?config= URL.
 *
 * Flow: parse ?config -> fetch JSON (+ any tour-<code>.json language
 *       siblings) -> validate -> map to PSV nodes -> init Viewer
 *       (VirtualTour + Markers + Gallery) -> wire info popups.
 *
 * Multi-language: a tour declaring `languages: ["en", "es", ...]` gets a
 * dropdown toggle (language-toggle.js) that rebuilds the viewer against the
 * chosen tour-<code>.json, preserving the current scene. See i18n.js for the
 * (small, deliberately scoped) chrome-string translation that goes with it,
 * and language-config.js for how sibling files get loaded. GUIDED tours
 * don't offer the toggle — see bootTour() below.
 *
 * No backend. No build step. Pure ES modules from a CDN import map.
 */

import { Viewer } from "@photo-sphere-viewer/core";
import { VirtualTourPlugin } from "@photo-sphere-viewer/virtual-tour-plugin";
import { MarkersPlugin } from "@photo-sphere-viewer/markers-plugin";
import DOMPurify from "dompurify";

import { validateTour, getScene, isZone, isGuided, resolveGroupEntryScene } from "./tour-model.js?v=11";
import {
  toViewerNodes,
  sceneInitialView,
  escapeHtml,
} from "./psv-adapter.js?v=6";
import { readSceneFromUrl, readAreaFromUrl, writeSceneToUrl, mountShareUI } from "./share.js?v=1";
import { mountAreasMenu } from "./areas-menu.js?v=2";
import { createScorm, fitToLmsFrame } from "./scorm-api.js?v=2";
import { fetchAlternates, readPreviewAlternates } from "./language-config.js?v=1";
import { mountLanguageToggle } from "./language-toggle.js?v=1";
import { setChromeLanguage, t } from "./i18n.js?v=2";

const DEFAULT_CONFIG = "tour.json";
const PREVIEW_SENTINEL = "__preview__";
const PREVIEW_KEY = "tour-preview-config";

const els = {
  container: document.getElementById("viewer"),
  loading: document.getElementById("loading"),
  error: document.getElementById("error"),
  errorMsg: document.getElementById("error-message"),
  title: document.getElementById("tour-title"),
  caption: document.getElementById("scene-caption"),
  overlay: document.getElementById("info-overlay"),
  overlayTitle: document.getElementById("info-title"),
  overlayBody: document.getElementById("info-body"),
  overlayClose: document.getElementById("info-close"),
  revealZones: document.getElementById("reveal-zones-btn"),
  areasMenu: document.getElementById("areas-menu"),
  langToggleHost: document.getElementById("lang-toggle-host"),
};

let activeTour = null;
let currentSceneId = null;
let scorm = null; // SCORM 1.2 controller (no-op when not inside an LMS)
let viewerInstance = null; // current PSV Viewer — destroyed/rebuilt on language switch
let guided = null; // current guided-experience controller, or null (free-roam / not yet loaded)
let toursByLang = {}; // { en: <tour>, es: <tour>, ... } — validated, ready to boot
let availableLangs = []; // Object.keys(toursByLang), fixed once at load
let activeLangCode = "en";
let langToggle = null; // { setActive, destroy } from mountLanguageToggle(), or null (guided tours)

// Log unexpected errors for debugging, but DON'T tear down a working viewer.
// (Libraries can emit benign rejections, e.g. interrupted animations.)
window.addEventListener("error", (e) =>
  console.error("[player] error", e.error || e.message)
);
window.addEventListener("unhandledrejection", (e) =>
  console.warn("[player] unhandled rejection (ignored)", e.reason)
);

main();

async function main() {
  if (!hasWebGL()) {
    return fail(
      "Your browser or device doesn't support WebGL, which this 360 viewer needs. " +
        "Try an updated Chrome, Edge, Firefox, or Safari."
    );
  }

  let raw, alternates;
  try {
    ({ raw, alternates } = await loadRawConfig());
  } catch (err) {
    return fail(`Couldn't load the tour config. ${escapeHtml(err.message)}`);
  }

  const { ok, tour, errors, warnings } = validateTour(raw);
  warnings.forEach((w) => console.warn("[tour]", w));
  if (!ok) {
    return fail("This tour config is invalid:\n• " + errors.join("\n• "));
  }

  toursByLang = { en: tour };
  for (const [code, altRaw] of Object.entries(alternates)) {
    const v = validateTour(altRaw);
    if (v.ok) toursByLang[code] = v.tour;
    else console.warn(`[tour] Skipping language '${code}': invalid (${v.errors.join("; ")})`);
  }
  availableLangs = Object.keys(toursByLang);

  // Connect to the LMS (if we're running as a SCORM SCO). Silent no-op
  // otherwise, so plain web tours + builder previews are unaffected.
  scorm = createScorm();
  scorm.init();
  // If embedded in an LMS that centers content in a narrow column, stretch the
  // frame to full width so the 360 viewer isn't boxed in by side gutters.
  fitToLmsFrame();

  wireChromeOnce();

  try {
    bootTour(toursByLang.en);
  } catch (err) {
    console.error("[player] viewer init failed", err);
    return fail(`Couldn't start the 360 viewer: ${escapeHtml(err.message)}`);
  }

  // Header language toggle: only for free-roam tours with >1 language. Guided
  // tours get their OWN language picker on the guided welcome screen instead
  // (see bootTour()'s guided branch) — a persistent header toggle would let a
  // learner swap languages mid-run and corrupt guided.js's progress state.
  if (availableLangs.length > 1 && !isGuided(toursByLang.en)) {
    langToggle = mountLanguageToggle({
      languages: availableLangs,
      active: activeLangCode,
      onChange: switchLanguage,
      mountEl: els.langToggleHost,
    });
  }
}

/** Switch the active language, rebuilding the viewer in place while keeping
 *  the learner's current scene (when that scene id also exists in the new
 *  tour — scenes are expected to line up 1:1 across language variants). */
function switchLanguage(code) {
  const next = toursByLang[code];
  if (!next || code === activeLangCode) return;
  const keepScene = currentSceneId;
  activeLangCode = code;
  setChromeLanguage(code);
  try {
    bootTour(next, { preferredStart: keepScene });
  } catch (err) {
    console.error("[player] language switch failed", err);
    fail(`Couldn't switch language: ${escapeHtml(err.message)}`);
    return;
  }
  langToggle?.setActive(code);
}

/**
 * (Re)build the PSV viewer for `tour`. Safe to call more than once — tears
 * down any previous viewer instance first. `preferredStart` (a scene id)
 * overrides the usual deep-link/start-scene resolution, used by
 * switchLanguage() to keep the learner where they were.
 */
function bootTour(tour, { preferredStart } = {}) {
  if (viewerInstance) {
    try { viewerInstance.destroy(); } catch (e) { console.warn("[player] viewer teardown", e); }
    viewerInstance = null;
  }
  if (guided) {
    try { guided.destroy(); } catch (e) { console.warn("[player] guided teardown", e); }
    guided = null;
  }
  els.areasMenu.replaceChildren();
  els.areasMenu.hidden = true;

  activeTour = tour;
  // Tab title is JUST the tour name -- no app/product branding suffix (the
  // on-page header below already shows the bare title too; keep them in sync).
  document.title = tour.meta.title || "Untitled Tour";
  els.title.textContent = tour.meta.title;

  const guidedOn = isGuided(tour);
  const { nodes, startNodeId } = toViewerNodes(tour, { guided: guidedOn });
  // Deep-link precedence: preferredStart (language switch) wins outright;
  // otherwise an explicit ?scene=<id> wins; otherwise ?area=<groupId> starts
  // at that area's entry scene; otherwise the tour's default start scene.
  // GUIDED mode ignores deep-links (and preferredStart) entirely - a linear
  // experience always starts at scene 1, whether that's the first boot, a
  // language switch from the welcome screen, or "Start over".
  let effectiveStart = startNodeId;
  if (!guidedOn) {
    if (preferredStart && tour.scenes.some((s) => s.id === preferredStart)) {
      effectiveStart = preferredStart;
    } else {
      const requestedScene = readSceneFromUrl();
      const requestedArea = readAreaFromUrl();
      if (requestedScene && tour.scenes.some((s) => s.id === requestedScene)) {
        effectiveStart = requestedScene;
      } else if (requestedArea) {
        const entry = resolveGroupEntryScene(tour, requestedArea);
        if (entry) effectiveStart = entry.id;
      }
    }
  }

  // Apply tour-wide marker preferences as classes on the viewer container so
  // CSS can opt out cleanly without touching marker HTML.
  els.container.classList.toggle(
    "tour-shadows-off",
    tour.meta?.showWaypointShadows === false
  );

  const viewer = new Viewer({
    container: els.container,
    loadingTxt: "Loading 360 scene…",
    navbar: ["zoom", "move", "caption", "fullscreen"],
    keyboard: "always", // arrow-key panning for keyboard users (a11y)
    plugins: [
      [MarkersPlugin, {}],
      [
        VirtualTourPlugin,
        {
          positionMode: "manual",
          renderMode: "2d",
          nodes,
          startNodeId: effectiveStart,
          // VirtualTour's built-in arrows are disabled — nav waypoints are
          // rendered as PSV markers so each can carry its own icon from
          // marker-icons.js. We intercept the click below.
          arrowsRenderer: () => null,
          // Cross-fade into every scene already FACING its saved view, with no
          // rotation animation (rotation:false) -> no spin, and back/forth
          // always lands on the saved view. Applies on first load too.
          transitionOptions: (node) => {
            const scene = getScene(activeTour, node.id);
            if (!scene) return { effect: "fade", rotation: false };
            const view = sceneInitialView(scene);
            return {
              effect: "fade",
              rotation: false,
              rotateTo: { yaw: view.yaw, pitch: view.pitch },
              zoomTo: view.zoom,
            };
          },
        },
      ],
    ],
  });

  const markers = viewer.getPlugin(MarkersPlugin);
  const virtualTour = viewer.getPlugin(VirtualTourPlugin);

  // ---- Guided experience (opt-in, lazy) ----
  // Only load the guided controller when this tour asks for it, so normal
  // tours never download or run a byte of it. Nav pins are already suppressed
  // by toViewerNodes({ guided:true }); progression is driven from guided.js.
  // `guided` is module-level (declared near the top) so the NEXT bootTour()
  // call — e.g. a language switch triggered from the welcome screen's own
  // picker — can tear this instance down before building a fresh one.
  if (guidedOn) {
    document.body.classList.add("is-guided");
    const stageEl = els.container.closest(".player-stage") || els.container.parentElement;
    import("./guided.js?v=15")
      .then((mod) => {
        guided = mod.mountGuided({
          tour, virtualTour, markers, stageEl,
          // Finishing the guided experience IS the completion signal.
          onComplete: () => scorm?.complete(),
          // Inside an LMS, offer "Close window" instead of "Start over".
          inLms: !!scorm?.present,
          // Multi-language: the welcome screen shows its own picker (rather
          // than a persistent header toggle) since picking a language here
          // always means "restart clean in this language" — see bootTour()'s
          // guided-vs-preferredStart guard above.
          languages: availableLangs,
          activeLanguage: activeLangCode,
          onLanguageChange: switchLanguage,
        });
        if (currentSceneId) guided.onEnterScene(currentSceneId); // catch up
      })
      .catch((err) => console.error("[player] guided mode failed to load", err));
  }

  // Non-guided completion triggers (only wired when NOT guided — guided drives
  // its own completion). Both funnel into the same idempotent scorm.complete().
  if (!guidedOn) wireVisitedAllScenes(tour);
  updateFinishButtonVisibility(guidedOn);

  // Show the "Reveal zones" toggle only when this tour actually has zones.
  // (Skipped in guided mode - revealing all zones would trivialize finding.)
  updateRevealZonesVisibility(guidedOn ? { meta: { showInfoZones: false } } : tour);

  // Areas fast-travel dropdown (only if this tour is split into groups). Picking
  // an area jumps to that area's entry scene (author's choice, else its first).
  // Disabled in guided mode - the experience is strictly linear.
  const areas = guidedOn
    ? null
    : mountAreasMenu({
        mountEl: els.areasMenu,
        tour,
        labels: { areas: t("areas"), jumpToArea: t("jumpToArea") },
        onPickArea: (groupId) => {
          const entry = resolveGroupEntryScene(tour, groupId);
          if (entry) {
            virtualTour.setCurrentNode(entry.id).catch((err) =>
              console.warn("[player] area jump failed", err)
            );
          }
        },
      });

  // The transition already moved us to the saved view; here we only update the
  // caption text (no rotate/zoom -> no jump). Also keep the URL's ?scene= in
  // sync so the address bar always reflects what you're looking at.
  virtualTour.addEventListener("node-changed", ({ node }) => {
    const scene = getScene(activeTour, node.id);
    if (scene) setCaption(scene.caption);
    if (!guidedOn) writeSceneToUrl(node.id); // guided mode keeps the URL clean
    currentSceneId = node.id;
    areas?.update(node.id); // keep the area breadcrumb in sync
    guided?.onEnterScene(node.id); // reset progress HUD for the new scene
    if (!guidedOn) markSceneVisited(node.id); // LMS "visited all" tracking
  });

  // Marker click router:
  //   kind="info" -> open the accessible overlay panel
  //   kind="link" -> navigate via VirtualTour (preserves transitions/fades)
  markers.addEventListener("select-marker", ({ marker }) => {
    const data = marker.data ?? marker.config?.data;
    if (!data) return;
    if (data.kind === "info") {
      openInfo(data.label, data.html);
      guided?.onInfoOpened(marker.id); // opening = "found" in guided mode
    } else if (data.kind === "link" && data.targetSceneId) {
      virtualTour.setCurrentNode(data.targetSceneId).catch((err) =>
        console.warn("[player] nav failed", err)
      );
    }
  });

  viewer.addEventListener("ready", () => hide(els.loading), { once: true });

  // Surface any panorama load failure with a clear message.
  viewer.addEventListener("panorama-error", (e) => {
    console.error("[player] panorama-error", e);
    fail("A panorama image failed to load. Check the image URL is reachable (and CORS-enabled if remote).");
  });

  refreshStaticChrome();
  viewerInstance = viewer;
}

/**
 * ONE-TIME chrome wiring: listeners that don't depend on which tour/language
 * is active, so they must be attached exactly once (bootTour() can re-run on
 * every language switch — attaching these there would stack up duplicates).
 */
function wireChromeOnce() {
  els.overlayClose.addEventListener("click", closeInfo);
  els.overlay.addEventListener("click", (e) => {
    if (e.target === els.overlay) closeInfo();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeInfo();
  });

  // Wire the share button + modal (uses window.qrcode from vendor/qrcode.js).
  mountShareUI({ getCurrentSceneId: () => currentSceneId });

  const finishBtn = document.getElementById("finish-btn");
  if (finishBtn) {
    finishBtn.addEventListener("click", () => {
      scorm.complete();
      finishBtn.disabled = true;
      const span = finishBtn.querySelector("span");
      if (span) span.textContent = t("completed");
    });
  }

  const zonesBtn = els.revealZones;
  if (zonesBtn) {
    zonesBtn.addEventListener("click", () => {
      const on = els.container.classList.toggle("zones-revealed");
      zonesBtn.setAttribute("aria-pressed", String(on));
      const span = zonesBtn.querySelector("span");
      if (span) span.textContent = on ? t("hideZones") : t("showZones");
      zonesBtn.setAttribute("aria-label", on ? t("hideZonesAria") : t("showZonesAria"));
      zonesBtn.title = on ? t("hideZonesAria") : t("showZonesAria");
    });
  }
}

/** Re-apply translated labels to the handful of chrome bits that survive a
 *  language switch (the finish button + info-overlay close button). Called
 *  from bootTour() so it runs on initial load too (a no-op there, since the
 *  session always starts in English — see i18n.js). */
function refreshStaticChrome() {
  const btn = document.getElementById("finish-btn");
  if (btn && !btn.disabled) {
    btn.setAttribute("aria-label", t("markCompleteAria"));
    btn.title = t("markCompleteAria");
    const span = btn.querySelector("span");
    if (span) span.textContent = t("markComplete");
  }
  els.overlayClose.setAttribute("aria-label", t("closeDetails"));
}

/* ---------------- SCORM completion (non-guided) ---------------- */

const visitedScenes = new Set();
let allSceneIds = []; // captured per-tour so "visited all" is easy to check

/** Free-roam completion #1: mark complete once every scene has been seen. */
function wireVisitedAllScenes(tour) {
  allSceneIds = (tour.scenes || []).map((s) => s.id);
  visitedScenes.clear(); // fresh run on every (re)boot, incl. language switch
}

function markSceneVisited(sceneId) {
  if (!scorm?.present || !allSceneIds.length) return;
  visitedScenes.add(sceneId);
  if (allSceneIds.every((id) => visitedScenes.has(id))) scorm.complete();
}

/**
 * Free-roam completion #2: an explicit "Mark complete" button, shown only when
 * we're actually running inside an LMS (otherwise it's noise on a web tour)
 * and never for guided tours (guided.js drives its own completion screen).
 */
function updateFinishButtonVisibility(guidedOn) {
  const btn = document.getElementById("finish-btn");
  if (!btn) return;
  btn.hidden = guidedOn || !scorm?.present;
}

/* ---------------- zones ---------------- */

/**
 * Reveal-zones toggle (a11y/discoverability): zones are invisible-until-hover,
 * which is mouse-only, so offer a button that outlines them all at once.
 * Only shown when the tour contains at least one zone. Resets to the "off"
 * state on every (re)boot, including a language switch.
 */
function updateRevealZonesVisibility(tour) {
  const btn = els.revealZones;
  if (!btn) return;
  els.container.classList.remove("zones-revealed");
  btn.setAttribute("aria-pressed", "false");
  const span = btn.querySelector("span");
  if (span) span.textContent = t("showZones");
  btn.setAttribute("aria-label", t("showZonesAria"));
  btn.title = t("showZonesAria");
  // Author opt-out: hide the reveal button entirely when the tour setting is off.
  if (tour.meta?.showInfoZones === false) {
    btn.hidden = true;
    return;
  }
  const hasZones = (tour.scenes || []).some((s) =>
    (s.markers || []).some((m) => isZone(m))
  );
  btn.hidden = !hasZones;
}

/* ---------------- UI helpers ---------------- */

function setCaption(text) {
  if (text) {
    els.caption.textContent = text;
    els.caption.hidden = false;
  } else {
    els.caption.hidden = true;
  }
}

function openInfo(title, html) {
  els.overlayTitle.textContent = title || t("detailsTitle");
  // html comes from the tour author's own config; render it in an isolated
  // panel but sanitize first — the ?config= URL is attacker-influenceable, so
  // never trust its HTML raw.
  // (CWE-79 fix) fixes: javascript/DOMXSS (DOM-based Cross-site Scripting)
  els.overlayBody.innerHTML = DOMPurify.sanitize(html || "<p>(No additional details.)</p>");
  els.overlay.hidden = false;
  els.overlayClose.focus();
}

function closeInfo() {
  els.overlay.hidden = true;
}

function hide(el) {
  if (el) el.hidden = true;
}

function fail(message) {
  hide(els.loading);
  els.errorMsg.textContent = message;
  els.error.hidden = false;
}

/* ---------------- config + capability ---------------- */

/**
 * Load the raw tour config object, plus any sibling language variants.
 *  - "?config=__preview__" reads the in-progress tour from localStorage
 *    (how the builder's "Preview in player" hands data across tabs), and any
 *    staged alternates from sibling localStorage keys.
 *  - otherwise fetches a SAME-ORIGIN config file (cross-origin configs are
 *    rejected — the big IMAGE URLs inside may still be remote/Azure; only the
 *    config document itself must be local) and fetches tour-<code>.json
 *    siblings next to it for every non-"en" code in `languages`.
 */
async function loadRawConfig() {
  const params = new URLSearchParams(location.search);
  const param = params.get("config") || DEFAULT_CONFIG;

  if (param === PREVIEW_SENTINEL) {
    const stored = localStorage.getItem(PREVIEW_KEY);
    if (!stored) {
      throw new Error("No preview data found. Click 'Preview in player' in the builder again.");
    }
    const raw = JSON.parse(stored);
    return { raw, alternates: readPreviewAlternates(raw) };
  }

  const url = new URL(param, location.href);
  if (url.origin !== location.origin) {
    throw new Error("Config must live on the same site as the player.");
  }
  const res = await fetch(url.href, { cache: "no-cache" });
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url.href}`);
  const raw = await res.json();
  const alternates = await fetchAlternates(raw, url.href);
  return { raw, alternates };
}

function hasWebGL() {
  try {
    const canvas = document.createElement("canvas");
    return !!(
      window.WebGLRenderingContext &&
      (canvas.getContext("webgl") || canvas.getContext("experimental-webgl"))
    );
  } catch {
    return false;
  }
}
