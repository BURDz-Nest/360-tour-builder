/**
 * psv-adapter.js — translate our tour.json schema into Photo-Sphere-Viewer
 * (Virtual Tour + Markers) configuration.
 *
 * SHARED by builder preview and the player. This is the ONLY module that
 * knows PSV's specific shapes/quirks (SOLID: isolate the dependency).
 *
 * Mapping:
 *   our "link" markers  -> PSV VirtualTour node.links  (navigation arrows)
 *   our "info" markers  -> PSV node.markers            (info pins -> popups)
 *   angles in DEGREES   -> PSV "<n>deg" strings
 */

import { MARKER_TYPES } from "./tour-model.js";

/** PSV wants angles as strings like "30deg" (or radians). We use degrees. */
export function degStr(value) {
  const n = Number(value) || 0;
  return `${n}deg`;
}

/** Build the marker config for a single INFO marker. */
export function infoMarkerToConfig(marker) {
  return {
    id: marker.id,
    position: { yaw: degStr(marker.yaw), pitch: degStr(marker.pitch) },
    html: infoPinHtml(),
    size: { width: 36, height: 36 },
    anchor: "center center",
    className: "tour-info-pin",
    tooltip: marker.label ? { content: escapeHtml(marker.label) } : undefined,
    // Stash our payload so the player can render the popup on select.
    data: { kind: "info", label: marker.label, html: marker.html },
  };
}

/** Build a VirtualTour link object for a single LINK marker. */
export function linkMarkerToConfig(marker) {
  return {
    nodeId: marker.targetSceneId,
    position: { yaw: degStr(marker.yaw), pitch: degStr(marker.pitch) },
    name: marker.label || undefined,
    // Custom arrow data the link tooltip can use.
    data: { kind: "link", label: marker.label },
  };
}

/**
 * Convert a whole tour into VirtualTour nodes + the starting node id.
 * @returns {{ nodes: object[], startNodeId: string }}
 */
export function toViewerNodes(tour) {
  const nodes = (tour.scenes || []).map((scene) => {
    const links = [];
    const markers = [];

    for (const m of scene.markers || []) {
      if (m.type === MARKER_TYPES.LINK) {
        if (m.targetSceneId) links.push(linkMarkerToConfig(m));
      } else if (m.type === MARKER_TYPES.INFO) {
        markers.push(infoMarkerToConfig(m));
      }
    }

    return {
      id: scene.id,
      panorama: scene.panorama,
      thumbnail: scene.thumbnail || scene.panorama,
      name: scene.name,
      caption: scene.caption || undefined,
      links,
      markers,
      // VirtualTour reads this when entering the node.
      sphereCorrection: undefined,
    };
  });

  const startNodeId =
    tour.meta?.startSceneId && nodes.some((n) => n.id === tour.meta.startSceneId)
      ? tour.meta.startSceneId
      : nodes[0]?.id;

  return { nodes, startNodeId };
}

/** Per-scene initial camera view (yaw/pitch deg, zoom 0-100). */
export function sceneInitialView(scene) {
  const iv = scene?.initialView || {};
  return {
    yaw: degStr(iv.yaw ?? 0),
    pitch: degStr(iv.pitch ?? 0),
    zoom: Number.isFinite(iv.zoom) ? iv.zoom : 50,
  };
}

/** SVG/HTML for the floating info pin (neutral styling, themeable via CSS). */
function infoPinHtml() {
  return `
    <svg viewBox="0 0 36 36" width="36" height="36" aria-hidden="true" focusable="false">
      <circle cx="18" cy="18" r="14" class="tour-info-pin__bg"></circle>
      <text x="18" y="24" text-anchor="middle" class="tour-info-pin__glyph">i</text>
    </svg>`;
}

/** Minimal HTML escaping for tooltip/label injection. */
export function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
