/**
 * player.js — bootstraps the read-only WebGL tour from a ?config= URL.
 *
 * Flow: parse ?config -> fetch JSON -> validate -> map to PSV nodes ->
 *       init Viewer (VirtualTour + Markers + Gallery) -> wire info popups.
 *
 * No backend. No build step. Pure ES modules from a CDN import map.
 */

import { Viewer } from "@photo-sphere-viewer/core";
import { VirtualTourPlugin } from "@photo-sphere-viewer/virtual-tour-plugin";
import { MarkersPlugin } from "@photo-sphere-viewer/markers-plugin";

import { validateTour, getScene } from "./tour-model.js";
import {
  toViewerNodes,
  sceneInitialView,
  waypointArrowStyle,
  escapeHtml,
} from "./psv-adapter.js";

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
};

let activeTour = null;

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

  let raw;
  try {
    raw = await loadRawConfig();
  } catch (err) {
    return fail(`Couldn't load the tour config. ${escapeHtml(err.message)}`);
  }

  const { ok, tour, errors, warnings } = validateTour(raw);
  warnings.forEach((w) => console.warn("[tour]", w));
  if (!ok) {
    return fail("This tour config is invalid:\n• " + errors.join("\n• "));
  }

  activeTour = tour;
  document.title = `${tour.meta.title} — 360 Tour`;
  els.title.textContent = tour.meta.title;

  try {
    initViewer(tour);
  } catch (err) {
    console.error("[player] viewer init failed", err);
    fail(`Couldn't start the 360 viewer: ${escapeHtml(err.message)}`);
  }
}

function initViewer(tour) {
  const { nodes, startNodeId } = toViewerNodes(tour);

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
          startNodeId,
          arrowStyle: waypointArrowStyle(),
          // Animate straight to each scene's saved view DURING the fade, so we
          // never snap afterwards (smooth arrival). Runs for the first node too.
          transitionOptions: (node) => {
            const scene = getScene(activeTour, node.id);
            if (!scene) return {};
            const view = sceneInitialView(scene);
            return {
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

  // The transition already moved us to the saved view; here we only update the
  // caption text (no rotate/zoom -> no jump).
  virtualTour.addEventListener("node-changed", ({ node }) => {
    const scene = getScene(activeTour, node.id);
    if (scene) setCaption(scene.caption);
  });

  // Info markers -> accessible overlay panel.
  markers.addEventListener("select-marker", ({ marker }) => {
    const data = marker.data ?? marker.config?.data;
    if (data?.kind === "info") openInfo(data.label, data.html);
  });

  els.overlayClose.addEventListener("click", closeInfo);
  els.overlay.addEventListener("click", (e) => {
    if (e.target === els.overlay) closeInfo();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeInfo();
  });

  viewer.addEventListener("ready", () => hide(els.loading), { once: true });

  // Surface any panorama load failure with a clear message.
  viewer.addEventListener("panorama-error", (e) => {
    console.error("[player] panorama-error", e);
    fail("A panorama image failed to load. Check the image URL is reachable (and CORS-enabled if remote).");
  });
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
  els.overlayTitle.textContent = title || "Details";
  // html comes from the tour author's own config; render as-is but in an
  // isolated panel. Authors control their own content.
  els.overlayBody.innerHTML = html || "<p>(No additional details.)</p>";
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
 * Load the raw tour config object.
 *  - "?config=__preview__" reads the in-progress tour from localStorage
 *    (how the builder's "Preview in player" hands data across tabs).
 *  - otherwise fetches a SAME-ORIGIN config file. Cross-origin configs are
 *    rejected (the big IMAGE URLs inside may still be remote/Azure; only the
 *    config document itself must be local).
 */
async function loadRawConfig() {
  const params = new URLSearchParams(location.search);
  const param = params.get("config") || DEFAULT_CONFIG;

  if (param === PREVIEW_SENTINEL) {
    const stored = localStorage.getItem(PREVIEW_KEY);
    if (!stored) {
      throw new Error("No preview data found. Click 'Preview in player' in the builder again.");
    }
    return JSON.parse(stored);
  }

  const url = new URL(param, location.href);
  if (url.origin !== location.origin) {
    throw new Error("Config must live on the same site as the player.");
  }
  const res = await fetch(url.href, { cache: "no-cache" });
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url.href}`);
  return res.json();
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
