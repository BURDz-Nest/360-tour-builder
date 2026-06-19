/**
 * builder-viewer.js — the live 360 PREVIEW used inside the builder.
 *
 * Wraps a single-panorama Photo-Sphere-Viewer instance with:
 *   - loading a scene by panorama URL
 *   - rendering that scene's markers (link vs info, styled differently)
 *   - "place mode": next click on the sphere reports a {yaw,pitch} in DEGREES
 *   - reading the current camera view (yaw/pitch/zoom) to save per scene
 *
 * SOLID: this class owns ALL PSV knowledge for the builder; builder.js stays
 * about state + DOM and never touches the viewer internals directly.
 */

import { Viewer } from "@photo-sphere-viewer/core";
import { MarkersPlugin } from "@photo-sphere-viewer/markers-plugin";
import { MARKER_TYPES } from "../player-template/js/tour-model.js";
import { degStr, escapeHtml } from "../player-template/js/psv-adapter.js";

const RAD2DEG = 180 / Math.PI;

export class BuilderViewer {
  /**
   * @param {HTMLElement} container
   * @param {object} handlers { onPlace(yawDeg,pitchDeg), onMarkerClick(id) }
   */
  constructor(container, handlers = {}) {
    this.handlers = handlers;
    this.placeMode = false;
    this.viewer = new Viewer({
      container,
      panorama: transparentPanorama(),
      navbar: ["zoom", "move", "fullscreen"],
      keyboard: "always",
      loadingTxt: "Loading preview…",
      plugins: [[MarkersPlugin, {}]],
    });
    this.markers = this.viewer.getPlugin(MarkersPlugin);

    this.viewer.addEventListener("click", ({ data }) => {
      if (!this.placeMode || !data) return;
      const yaw = round(normDeg(data.yaw * RAD2DEG));
      const pitch = round(data.pitch * RAD2DEG);
      this.handlers.onPlace?.(yaw, pitch);
    });

    this.markers.addEventListener("select-marker", ({ marker }) => {
      this.handlers.onMarkerClick?.(marker.id);
    });
  }

  setPlaceMode(on) {
    this.placeMode = !!on;
  }

  /** Blank the viewer: transparent panorama, no markers (e.g. new/empty tour). */
  async clear() {
    this._currentPanorama = null;
    this.markers.clearMarkers();
    await this.viewer.setPanorama(transparentPanorama(), { transition: false });
  }

  /**
   * Load a scene's panorama for preview. `panoramaUrl` is the resolved URL to
   * actually fetch (may differ from scene.panorama when a preview base path is
   * applied); markers still come from the scene. Only reloads if URL changed.
   */
  async loadScene(scene, panoramaUrl = scene?.panorama) {
    if (!panoramaUrl) {
      await this.viewer.setPanorama(transparentPanorama(), { transition: false });
      this.markers.clearMarkers();
      return;
    }
    if (this._currentPanorama !== panoramaUrl) {
      this._currentPanorama = panoramaUrl;
      try {
        await this.viewer.setPanorama(panoramaUrl, {
          transition: false,
          showLoader: true,
        });
      } catch (err) {
        console.error("[builder] failed to load panorama", err);
        throw err;
      }
    }
    this.renderMarkers(scene.markers || []);
  }

  /** Re-paint the marker pins for the current scene. */
  renderMarkers(markerList) {
    this.markers.clearMarkers();
    for (const m of markerList) {
      this.markers.addMarker({
        id: m.id,
        position: { yaw: degStr(m.yaw), pitch: degStr(m.pitch) },
        html: pinHtml(m.type),
        size: { width: 38, height: 38 },
        anchor: "center center",
        className: `builder-pin builder-pin--${m.type}`,
        tooltip: m.label ? { content: escapeHtml(m.label) } : undefined,
      });
    }
  }

  /** Current camera view as DEGREES + zoom (0-100). */
  getCurrentView() {
    const pos = this.viewer.getPosition();
    return {
      yaw: round(normDeg(pos.yaw * RAD2DEG)),
      pitch: round(pos.pitch * RAD2DEG),
      zoom: Math.round(this.viewer.getZoomLevel()),
    };
  }

  /** Point the camera at a saved view (degrees). */
  applyView(view) {
    if (!view) return;
    this.viewer.rotate({ yaw: degStr(view.yaw), pitch: degStr(view.pitch) });
    if (Number.isFinite(view.zoom)) this.viewer.zoom(view.zoom);
  }

  destroy() {
    this.viewer?.destroy();
  }
}

/* ---------------- helpers ---------------- */

function pinHtml(type) {
  if (type === MARKER_TYPES.INFO) {
    return `<svg viewBox="0 0 38 38" width="38" height="38" aria-hidden="true">
      <circle cx="19" cy="19" r="15" class="builder-pin__bg builder-pin__bg--info"></circle>
      <text x="19" y="25" text-anchor="middle" class="builder-pin__glyph">i</text></svg>`;
  }
  // link / navigation pin (arrow-ish)
  return `<svg viewBox="0 0 38 38" width="38" height="38" aria-hidden="true">
    <circle cx="19" cy="19" r="15" class="builder-pin__bg builder-pin__bg--link"></circle>
    <path d="M12 22 L19 12 L26 22 Z" class="builder-pin__glyph-shape"></path></svg>`;
}

/** A 1x1 transparent equirectangular placeholder (data URI), so the viewer
 *  has something valid to show before any real panorama is set. */
function transparentPanorama() {
  return (
    "data:image/png;base64," +
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk" +
    "+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
  );
}

function normDeg(deg) {
  let d = deg % 360;
  if (d > 180) d -= 360;
  if (d < -180) d += 360;
  return d;
}

function round(n) {
  return Math.round(n * 10) / 10;
}
