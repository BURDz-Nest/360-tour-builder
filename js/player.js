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
import { GalleryPlugin } from "@photo-sphere-viewer/gallery-plugin";

import { validateTour, getScene } from "./tour-model.js";
import { toViewerNodes, sceneInitialView, escapeHtml } from "./psv-adapter.js";

const DEFAULT_CONFIG = "tour.json";

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

  const configUrl = resolveConfigUrl();
  if (!configUrl) {
    return fail(
      "This viewer was opened with an unsafe or cross-origin ?config= value. " +
        "Configs must live on the same site as the player."
    );
  }

  let raw;
  try {
    const res = await fetch(configUrl, { cache: "no-cache" });
    if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${configUrl}`);
    raw = await res.json();
  } catch (err) {
    return fail(
      `Couldn't load the tour config (${escapeHtml(configUrl)}). ${escapeHtml(
        err.message
      )}`
    );
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
      [GalleryPlugin, { visibleOnLoad: nodes.length > 1, thumbnailSize: { width: 120, height: 80 } }],
      [MarkersPlugin, {}],
      [
        VirtualTourPlugin,
        {
          positionMode: "manual",
          renderMode: "2d",
          nodes,
          startNodeId,
        },
      ],
    ],
  });

  const markers = viewer.getPlugin(MarkersPlugin);
  const virtualTour = viewer.getPlugin(VirtualTourPlugin);

  // Apply each scene's saved camera view + caption on arrival.
  // Use rotate/zoom (synchronous) rather than animate() so we never leave a
  // dangling animation promise that could reject when the tour interrupts it.
  virtualTour.addEventListener("node-changed", ({ node }) => {
    const scene = getScene(activeTour, node.id);
    if (!scene) return;
    const view = sceneInitialView(scene);
    viewer.rotate({ yaw: view.yaw, pitch: view.pitch });
    if (Number.isFinite(view.zoom)) viewer.zoom(view.zoom);
    setCaption(scene.caption);
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
 * Resolve the ?config= param to a SAME-ORIGIN URL.
 * Cross-origin configs are rejected to avoid loading arbitrary remote JSON.
 * (The big IMAGE URLs inside the config can still be remote/Azure — only the
 *  config document itself must be local.)
 */
function resolveConfigUrl() {
  const params = new URLSearchParams(location.search);
  const raw = params.get("config") || DEFAULT_CONFIG;
  try {
    const url = new URL(raw, location.href);
    if (url.origin !== location.origin) return null;
    return url.href;
  } catch {
    return null;
  }
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
