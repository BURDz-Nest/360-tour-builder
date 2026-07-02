/**
 * psv-adapter.js — translate our tour.json schema into Photo-Sphere-Viewer
 * (Virtual Tour + Markers) configuration.
 *
 * SHARED by builder preview and the player. This is the ONLY module that
 * knows PSV's specific shapes/quirks (SOLID: isolate the dependency).
 *
 * Mapping (v2 — per-icon marker library):
 *   our "link" markers -> PSV markers tagged data.kind="link"
 *                         (player.js intercepts the click and calls
 *                         virtualTour.setCurrentNode). We do NOT use
 *                         VirtualTour's built-in arrows because its
 *                         global `arrowStyle` can't be customized per-link,
 *                         which is exactly what the icon library needs.
 *   our "info" markers -> PSV markers tagged data.kind="info"
 *                         (player.js opens the info overlay).
 *   angles in DEGREES  -> PSV "<n>deg" strings
 */

import { MARKER_TYPES, isZone, DEFAULT_ZONE_HOVER } from "./tour-model.js";
import { renderMarkerHtml } from "./marker-icons.js";

/** PSV wants angles as strings like "30deg" (or radians). We use degrees. */
export function degStr(value) {
  const n = Number(value) || 0;
  return `${n}deg`;
}

/** Marker render sizes. Nav waypoints are bigger so they read at a glance. */
const NAV_SIZE = 56;
const INFO_SIZE = 40;

/**
 * Build the config for an INFO ZONE (a polygon hotspot). Idle is invisible
 * (fill/stroke opacity 0) or a faint outline in the zone color if idleStroke.
 * The fill/stroke COLOR is set once here (from marker.hoverColor); markers.css
 * only animates opacity on hover/reveal, so the fade-in is smooth (no flash).
 * Click routes through the SAME data.kind="info" path as icon info markers.
 */
export function zoneMarkerToConfig(marker) {
  const outlined = marker.idleStroke === true;
  const color = marker.hoverColor || DEFAULT_ZONE_HOVER;
  return {
    id: marker.id,
    // PSV polygon: array of [yaw, pitch] pairs as "<n>deg" strings.
    polygon: (marker.points || []).map((p) => [degStr(p.yaw), degStr(p.pitch)]),
    className: "tour-zone" + (outlined ? " tour-zone--outlined" : ""),
    // Idle look. IMPORTANT: keep the fill COLOR constant and only vary the
    // *opacity* (starting at 0) so the CSS :hover transition fades in smoothly
    // instead of flashing solid before the fill-opacity animates down.
    svgStyle: {
      fill: color,
      fillOpacity: 0,
      stroke: color,
      strokeOpacity: outlined ? 0.85 : 0,
      strokeWidth: 2,
    },
    tooltip: marker.label ? { content: escapeHtml(marker.label) } : undefined,
    data: {
      kind: "info",
      zone: true,
      label: marker.label,
      html: marker.html,
      hoverColor: color,
    },
  };
}

/** Build the marker config for a single INFO marker. */
export function infoMarkerToConfig(marker) {
  return {
    id: marker.id,
    position: { yaw: degStr(marker.yaw), pitch: degStr(marker.pitch) },
    html: renderMarkerHtml({ type: "info", iconId: marker.icon, size: INFO_SIZE, variant: "info" }),
    size: { width: INFO_SIZE + 24, height: INFO_SIZE + 24 }, // +ring padding
    anchor: "center center",
    className: "tour-marker-host tour-marker-host--info",
    tooltip: marker.label ? { content: escapeHtml(marker.label) } : undefined,
    // Stash our payload so the player can render the popup on select.
    data: { kind: "info", label: marker.label, html: marker.html },
  };
}

/** Build a navigation marker (info-pin shape but kind=link, drives transitions). */
export function linkMarkerToConfig(marker) {
  return {
    id: marker.id,
    position: { yaw: degStr(marker.yaw), pitch: degStr(marker.pitch) },
    html: renderMarkerHtml({ type: "link", iconId: marker.icon, size: NAV_SIZE, variant: "nav" }),
    size: { width: NAV_SIZE + 32, height: NAV_SIZE + 32 }, // +ring padding
    anchor: "center center",
    className: "tour-marker-host tour-marker-host--nav",
    tooltip: marker.label ? { content: escapeHtml(marker.label) } : undefined,
    data: { kind: "link", label: marker.label, targetSceneId: marker.targetSceneId },
  };
}

/**
 * Convert a whole tour into VirtualTour nodes + the starting node id.
 *
 * Nav-link markers are rendered as PSV markers (not VirtualTour links) so each
 * can carry a unique icon. VirtualTour still owns the node graph + transitions;
 * player.js triggers setCurrentNode() when a kind="link" marker is clicked.
 *
 * @returns {{ nodes: object[], startNodeId: string }}
 */
export function toViewerNodes(tour) {
  const showThumbnails = tour.meta?.showThumbnails !== false;
  const nodes = (tour.scenes || []).map((scene) => {
    const markers = [];

    for (const m of scene.markers || []) {
      if (m.type === MARKER_TYPES.LINK) {
        if (m.targetSceneId) markers.push(linkMarkerToConfig(m));
      } else if (m.type === MARKER_TYPES.INFO) {
        markers.push(isZone(m) ? zoneMarkerToConfig(m) : infoMarkerToConfig(m));
      }
    }

    return {
      id: scene.id,
      panorama: scene.panorama,
      // Only attach a thumbnail when the tour wants them in link popups;
      // otherwise the popup shows just the scene name.
      thumbnail: showThumbnails ? scene.thumbnail || scene.panorama : undefined,
      name: scene.name,
      caption: scene.caption || undefined,
      // VirtualTour still wants a links array for its node graph (so it knows
      // which nodes are reachable). We mirror our markers as link entries but
      // they are NOT rendered — arrowsRenderer is disabled in player.js.
      links: (scene.markers || [])
        .filter((m) => m.type === MARKER_TYPES.LINK && m.targetSceneId)
        .map((m) => ({
          nodeId: m.targetSceneId,
          position: { yaw: degStr(m.yaw), pitch: degStr(m.pitch) },
          name: m.label || undefined,
        })),
      markers,
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

/** Minimal HTML escaping for tooltip/label injection. */
export function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
