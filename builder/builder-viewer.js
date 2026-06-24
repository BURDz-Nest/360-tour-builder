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
import { renderMarkerHtml } from "../player-template/js/marker-icons.js";

const RAD2DEG = 180 / Math.PI;

export class BuilderViewer {
  /**
   * @param {HTMLElement} container
   * @param {object} handlers { onPlace(yawDeg,pitchDeg), onMarkerClick(id), onMarkerMove(id,yawDeg,pitchDeg) }
   */
  constructor(container, handlers = {}) {
    this.handlers = handlers;
    this.placeMode = false;
    this.container = container;
    this.viewer = new Viewer({
      container,
      panorama: transparentPanorama(),
      navbar: ["zoom", "move", "fullscreen"],
      keyboard: "always",
      loadingTxt: "Loading preview\u2026",
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
      // Suppress the click that fires at the end of a drag (otherwise every
      // drop would also re-open the editor / steal focus).
      if (this._dragJustHappened) {
        this._dragJustHappened = false;
        return;
      }
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
   * Always re-applies the scene's saved initialView so switching scenes lands
   * the camera where the author captured it (no "random angle" surprises).
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
    // Apply the saved view AFTER panorama load completes; setPanorama keeps
    // whatever yaw/pitch was active, so without this we'd land at the last
    // scene's angle (or 0,0 on first load) instead of the captured view.
    if (scene.initialView) this.applyView(scene.initialView);
  }

  /** Re-paint the marker pins for the current scene. */
  renderMarkers(markerList) {
    this.markers.clearMarkers();
    for (const m of markerList) {
      const variant = m.type === MARKER_TYPES.LINK ? "nav" : "info";
      const size = variant === "nav" ? 52 : 38;
      this.markers.addMarker({
        id: m.id,
        position: { yaw: degStr(m.yaw), pitch: degStr(m.pitch) },
        html: renderMarkerHtml({ type: m.type, iconId: m.icon, size, variant }),
        size: { width: size + 24, height: size + 24 },
        anchor: "center center",
        className: `builder-pin builder-pin--${m.type}`,
        tooltip: m.label ? { content: escapeHtml(m.label) } : undefined,
      });
    }
    this._attachDragHandlers(markerList.map((m) => m.id));
    // renderMarkers wiped the DOM, so re-stamp the selected highlight.
    if (this._selectedMarkerId) {
      const m = this.markers.markers?.[this._selectedMarkerId];
      m?.element?.classList.add("is-selected");
    }
  }

  /**
   * Wire pointerdown -> pointermove -> pointerup on every marker so dragging
   * repositions the pin live, and commits via onMarkerMove on release.
   *
   * PSV listens for mousedown + touchstart (NOT pointer events) on the
   * container to start its pan gesture, so we must stop THOSE event types
   * on the marker too - pointerdown.stopPropagation alone leaves the
   * compatibility mousedown free to bubble up and start a pan.
   *
   * A 4px movement threshold preserves the click-to-select behaviour: a
   * clean click still opens the marker editor, only a real drag moves it.
   */
  _attachDragHandlers(ids) {
    const DRAG_THRESHOLD_PX = 4;
    const swallow = (e) => e.stopPropagation();
    for (const id of ids) {
      const psvMarker = this.markers.getMarker(id);
      const el = psvMarker?.element;
      if (!el) continue;
      el.style.cursor = "grab";
      el.style.touchAction = "none"; // keep mobile from scrolling on touch-drag
      // Block PSV's pan-gesture starters at the marker boundary.
      el.addEventListener("mousedown", swallow);
      el.addEventListener("touchstart", swallow, { passive: true });
      el.addEventListener("pointerdown", (ev) => this._onMarkerDown(ev, id, DRAG_THRESHOLD_PX));
    }
  }

  _onMarkerDown(ev, id, threshold) {
    if (ev.button !== 0) return; // left-click only
    // Only the SELECTED pin is draggable. First click selects (PSV's
    // select-marker event fires normally via pointerup); subsequent
    // press-and-drag on the already-selected pin moves it.
    if (this._selectedMarkerId !== id) {
      console.log(`[drag] pointerdown on ${id} but selected=${this._selectedMarkerId} - ignoring (select first)`);
      return;
    }
    console.log(`[drag] start on ${id}`);
    ev.stopPropagation(); // keep PSV from starting a pan gesture
    ev.preventDefault();  // and from firing compat mouse events
    const startX = ev.clientX;
    const startY = ev.clientY;
    let dragged = false;
    const targetEl = ev.currentTarget;
    targetEl.setPointerCapture?.(ev.pointerId);
    targetEl.style.cursor = "grabbing";

    const onMove = (e) => {
      if (!dragged && Math.hypot(e.clientX - startX, e.clientY - startY) < threshold) return;
      if (!dragged) console.log(`[drag] threshold crossed, moving ${id}`);
      dragged = true;
      const sph = this._clientToSpherical(e.clientX, e.clientY);
      if (!sph) { console.warn("[drag] viewerCoordsToSphericalCoords returned null"); return; }
      // Live PSV update during drag. We DO want render=true here so the pin
      // actually follows the cursor on screen (renderMarkers just rewrites
      // CSS transforms - it doesn't rebuild the DOM, so our pointer
      // listeners on `el` survive the re-paint).
      this.markers.updateMarker({
        id,
        position: { yaw: sph.yawRad, pitch: sph.pitchRad },
      });
      // PSV's marker.update() rewrites the class attribute, stripping our
      // .is-selected highlight. Re-stamp it so the ring stays visible during
      // the drag (purely cosmetic, but jarring otherwise).
      targetEl.classList.add("is-selected");
    };

    const onUp = (e) => {
      targetEl.releasePointerCapture?.(e.pointerId);
      targetEl.style.cursor = "grab";
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      if (!dragged) { console.log(`[drag] no movement - treating as click`); return; }
      this._dragJustHappened = true; // suppress the trailing click
      const sph = this._clientToSpherical(e.clientX, e.clientY);
      if (!sph) return;
      const yawDeg = round(normDeg(sph.yawRad * RAD2DEG));
      const pitchDeg = round(sph.pitchRad * RAD2DEG);
      console.log(`[drag] drop ${id} -> yaw=${yawDeg} pitch=${pitchDeg}`);
      this.handlers.onMarkerMove?.(id, yawDeg, pitchDeg);
    };

    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
  }

  /** Translate page pixel coords to sphere radians via PSV's dataHelper. */
  _clientToSpherical(clientX, clientY) {
    const rect = this.container.getBoundingClientRect();
    const point = { x: clientX - rect.left, y: clientY - rect.top };
    const sph = this.viewer.dataHelper.viewerCoordsToSphericalCoords(point);
    if (!sph) return null;
    return { yawRad: sph.yaw, pitchRad: sph.pitch };
  }

  /**
   * Mark which pin is "selected" so it gets a visible highlight ring and
   * makes the move-affordance obvious (Panoee-style). Idempotent + cheap:
   * we just toggle a CSS class on the existing DOM, no full re-render.
   */
  setSelectedMarker(id) {
    if (this._selectedMarkerId === id) return;
    console.log(`[drag] selection: ${this._selectedMarkerId} -> ${id}`);
    if (this._selectedMarkerId) {
      const prev = this.markers.markers?.[this._selectedMarkerId];
      prev?.element?.classList.remove("is-selected");
    }
    this._selectedMarkerId = id || null;
    if (id) {
      const next = this.markers.markers?.[id];
      if (!next?.element) {
        console.warn(`[drag] no DOM element for marker ${id}!`);
        return;
      }
      next.element.classList.add("is-selected");
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
