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
import { MARKER_TYPES, isZone } from "../player-template/js/tour-model.js?v=4";
import { degStr, escapeHtml } from "../player-template/js/psv-adapter.js";
import { renderMarkerHtml } from "../player-template/js/marker-icons.js";

const RAD2DEG = 180 / Math.PI;

export class BuilderViewer {
  /**
   * @param {HTMLElement} container
   * @param {object} handlers { onPlace(yawDeg,pitchDeg), onMarkerClick(id), onMarkerMove(id,yawDeg,pitchDeg), onMarkerDeselect(), onZoneCornerMove(id,cornerIdx,yawDeg,pitchDeg) }
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
      // Corner handles are markers too, but clicking one must NOT re-select or
      // re-open anything - the handle's own pointer logic owns that gesture.
      if (String(marker.id).includes("::corner::")) return;
      // Suppress the click that fires at the end of a drag (otherwise every
      // drop would also re-open the editor / steal focus).
      if (this._dragJustHappened) {
        this._dragJustHappened = false;
        return;
      }
      this.handlers.onMarkerClick?.(marker.id);
    });

    // PSV fires this when you click empty panorama (or a different marker)
    // while one is selected. Use it to deselect so the highlight + side-panel
    // selection clear when you click away.
    this.markers.addEventListener("unselect-marker", () => {
      if (this._dragJustHappened) return; // a drop isn't a deselect
      this.handlers.onMarkerDeselect?.();
    });

    // Belt-and-suspenders: PSV's own unselect can be flaky when a "click" has
    // any micro-movement (trackpads) or gets swallowed by our drag handlers.
    // A plain DOM click on empty canvas is reliable, so deselect here too.
    // We only act on true background clicks: anything inside a marker
    // (`.psv-marker` covers pins, zones AND corner handles) or the navbar is
    // ignored. selectMarker(null) is idempotent, so double-firing is harmless.
    this.container.addEventListener("click", (e) => {
      if (this.placeMode || !this._selectedMarkerId) return;
      const t = e.target;
      if (t.closest?.(".psv-marker") || t.closest?.(".psv-navbar")) return;
      this.handlers.onMarkerDeselect?.();
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
    this._markerList = markerList;
    this.markers.clearMarkers();
    const iconIds = [];
    for (const m of markerList) {
      if (isZone(m)) {
        this._addZone(m);
        continue;
      }
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
      iconIds.push(m.id);
    }
    this._attachDragHandlers(iconIds);
    // renderMarkers wiped the DOM, so re-stamp the selected highlight (pins).
    if (this._selectedMarkerId) {
      const m = this.markers.markers?.[this._selectedMarkerId];
      m?.element?.classList.add("is-selected");
    }
  }

  /**
   * Add one INFO ZONE polygon. In the BUILDER we always paint a faint fill so
   * authors can see + click the region (the player can keep it transparent).
   * When selected, the fill brightens and draggable corner handles appear.
   */
  _addZone(m) {
    const selected = this._selectedMarkerId === m.id;
    const color = m.hoverColor || "#0071dc";
    this.markers.addMarker({
      id: m.id,
      polygon: (m.points || []).map((p) => [degStr(p.yaw), degStr(p.pitch)]),
      className: "builder-zone" + (selected ? " is-selected" : ""),
      svgStyle: {
        fill: color,
        fillOpacity: selected ? 0.3 : m.idleStroke ? 0.12 : 0.08,
        stroke: color,
        strokeOpacity: selected ? 1 : m.idleStroke ? 0.85 : 0.55,
        strokeWidth: selected ? 2.5 : 2,
      },
      tooltip: m.label ? { content: escapeHtml(m.label) } : undefined,
    });
    if (selected) {
      this._addZoneHandles(m, color);
      this._attachZoneBodyDrag(m);
    }
  }

  /** Drop a draggable dot on each corner of the selected zone. */
  _addZoneHandles(m, color) {
    (m.points || []).forEach((p, idx) => {
      this.markers.addMarker({
        id: `${m.id}::corner::${idx}`,
        position: { yaw: degStr(p.yaw), pitch: degStr(p.pitch) },
        html: `<div class="zone-handle" style="--zone-handle:${escapeHtml(color)}"></div>`,
        size: { width: 18, height: 18 },
        anchor: "center center",
        className: "zone-handle-host",
      });
    });
    (m.points || []).forEach((_p, idx) => {
      const el = this.markers.getMarker(`${m.id}::corner::${idx}`)?.element;
      if (!el) return;
      el.style.cursor = "grab";
      el.style.touchAction = "none";
      el.addEventListener("mousedown", (e) => e.stopPropagation());
      el.addEventListener("touchstart", (e) => e.stopPropagation(), { passive: true });
      el.addEventListener("pointerdown", (ev) => this._onCornerDown(ev, m.id, idx));
    });
  }

  _onCornerDown(ev, zoneId, idx) {
    if (ev.button !== 0) return;
    ev.stopPropagation();
    ev.preventDefault();
    const handleId = `${zoneId}::corner::${idx}`;
    const targetEl = ev.currentTarget;
    targetEl.setPointerCapture?.(ev.pointerId);
    targetEl.style.cursor = "grabbing";
    let last = null;

    const onMove = (e) => {
      const sph = this._clientToSpherical(e.clientX, e.clientY);
      if (!sph) return;
      last = {
        yawDeg: round(normDeg(sph.yawRad * RAD2DEG)),
        pitchDeg: round(sph.pitchRad * RAD2DEG),
      };
      this.markers.updateMarker({ id: handleId, position: { yaw: sph.yawRad, pitch: sph.pitchRad } });
      this._reshapeZoneLive(zoneId, idx, last.yawDeg, last.pitchDeg);
    };
    const onUp = (e) => {
      targetEl.releasePointerCapture?.(e.pointerId);
      targetEl.style.cursor = "grab";
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      this._dragJustHappened = true; // suppress the trailing select click
      if (last) this.handlers.onZoneCornerMove?.(zoneId, idx, last.yawDeg, last.pitchDeg);
    };
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
  }

  /**
   * Make the whole selected zone draggable: press inside the polygon body and
   * drag to translate ALL corners together (was: corner-by-corner only).
   * Mirrors the icon-pin pattern — only the SELECTED zone's body is grabbable,
   * and a 4px threshold preserves clean clicks. Corner handles keep their own
   * pointerdown (they stopPropagation), so grabbing a corner still reshapes.
   */
  _attachZoneBodyDrag(m) {
    const el = this.markers.getMarker(m.id)?.element; // the <path> element
    if (!el) return;
    el.style.cursor = "grab";
    el.style.touchAction = "none";
    el.addEventListener("mousedown", (e) => e.stopPropagation());
    el.addEventListener("touchstart", (e) => e.stopPropagation(), { passive: true });
    el.addEventListener("pointerdown", (ev) => this._onZoneBodyDown(ev, m.id));
  }

  _onZoneBodyDown(ev, zoneId) {
    if (ev.button !== 0) return;
    ev.stopPropagation(); // don't let PSV start a camera pan
    ev.preventDefault();
    const targetEl = ev.currentTarget;
    targetEl.setPointerCapture?.(ev.pointerId);
    targetEl.style.cursor = "grabbing";
    // Snapshot the zone's starting points; we apply cumulative deltas so the
    // shape never drifts across many move events.
    const zone = (this._markerList || []).find((x) => x.id === zoneId);
    if (!zone) return;
    const startPts = (zone.points || []).map((p) => ({ yaw: p.yaw, pitch: p.pitch }));
    let prev = this._clientToSpherical(ev.clientX, ev.clientY);
    let moved = null;
    let dragged = false;
    const startX = ev.clientX;
    const startY = ev.clientY;

    const onMove = (e) => {
      if (!dragged && Math.hypot(e.clientX - startX, e.clientY - startY) < 4) return;
      dragged = true;
      const cur = this._clientToSpherical(e.clientX, e.clientY);
      if (!cur || !prev) return;
      // Accumulate the total drag delta (degrees) from the press point.
      const dYaw = normDeg((cur.yawRad - prev.yawRad) * RAD2DEG);
      const dPitch = (cur.pitchRad - prev.pitchRad) * RAD2DEG;
      moved = (moved || { yaw: 0, pitch: 0 });
      moved.yaw += dYaw;
      moved.pitch += dPitch;
      prev = cur;
      const pts = startPts.map((p) => ({
        yaw: normDeg(p.yaw + moved.yaw),
        pitch: clampPitch(p.pitch + moved.pitch),
      }));
      this.markers.updateMarker({
        id: zoneId,
        polygon: pts.map((p) => [degStr(p.yaw), degStr(p.pitch)]),
      });
      // Keep the corner handles glued to the moving polygon.
      pts.forEach((p, idx) => {
        this.markers.updateMarker({
          id: `${zoneId}::corner::${idx}`,
          position: { yaw: degStr(p.yaw), pitch: degStr(p.pitch) },
        });
      });
      this._lastZonePts = pts;
    };
    const onUp = (e) => {
      targetEl.releasePointerCapture?.(e.pointerId);
      targetEl.style.cursor = "grab";
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      if (!dragged || !this._lastZonePts) return;
      this._dragJustHappened = true; // suppress the trailing select/deselect click
      this.handlers.onZoneMove?.(zoneId, this._lastZonePts.map((p) => ({
        yaw: round(p.yaw),
        pitch: round(p.pitch),
      })));
      this._lastZonePts = null;
    };
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
  }

  /** Live-redraw a zone polygon as one corner is dragged (no commit yet). */
  _reshapeZoneLive(zoneId, idx, yawDeg, pitchDeg) {
    const zone = (this._markerList || []).find((x) => x.id === zoneId);
    if (!zone) return;
    const pts = zone.points.map((p, i) =>
      i === idx ? [degStr(yawDeg), degStr(pitchDeg)] : [degStr(p.yaw), degStr(p.pitch)]
    );
    this.markers.updateMarker({ id: zoneId, polygon: pts });
  }

  /**
   * Wire pointerdown -> pointermove -> pointerup on every marker so dragging
   * repositions the pin live, and commits via onMarkerMove on release.
   *
   * IMPORTANT: PSV uses ONE mousedown handler on the viewer container that
   * BOTH starts the pan-camera gesture AND records the click for later
   * select-marker dispatch on mouseup. So if we blanket-swallow mousedown on
   * markers, we kill click-to-select too (no select-marker = no highlight =
   * no way to enter drag mode = total deadlock).
   *
   * The trick: only swallow mousedown on the marker that's ALREADY selected.
   *   - Unselected pin pressed: mousedown bubbles -> PSV fires select-marker
   *     -> our onMarkerClick runs -> selectMarker -> setSelectedMarker(id)
   *     -> the highlight appears.
   *   - Now-selected pin pressed again: swallow fires -> no pan -> our drag
   *     handler runs from pointerdown -> pin follows cursor.
   *
   * 4px movement threshold preserves clean clicks (no accidental drag).
   */
  _attachDragHandlers(ids) {
    const DRAG_THRESHOLD_PX = 4;
    for (const id of ids) {
      const psvMarker = this.markers.getMarker(id);
      const el = psvMarker?.element;
      if (!el) continue;
      el.style.cursor = "grab";
      el.style.touchAction = "none"; // mobile: don't scroll the page on touch-drag
      const swallowIfSelected = (e) => {
        if (this._selectedMarkerId === id) e.stopPropagation();
      };
      el.addEventListener("mousedown", swallowIfSelected);
      el.addEventListener("touchstart", swallowIfSelected, { passive: true });
      el.addEventListener("pointerdown", (ev) => this._onMarkerDown(ev, id, DRAG_THRESHOLD_PX));
    }
  }

  _onMarkerDown(ev, id, threshold) {
    if (ev.button !== 0) return; // left-click only
    // Only the SELECTED pin is draggable. First click selects (PSV's
    // select-marker event fires normally via pointerup); subsequent
    // press-and-drag on the already-selected pin moves it.
    if (this._selectedMarkerId !== id) {
      return;
    }
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
      dragged = true;
      const sph = this._clientToSpherical(e.clientX, e.clientY);
      if (!sph) return;
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
      if (!dragged) return; // no movement - treat as a plain click
      this._dragJustHappened = true; // suppress the trailing click
      const sph = this._clientToSpherical(e.clientX, e.clientY);
      if (!sph) return;
      const yawDeg = round(normDeg(sph.yawRad * RAD2DEG));
      const pitchDeg = round(sph.pitchRad * RAD2DEG);
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
    const prevId = this._selectedMarkerId;
    this._selectedMarkerId = id || null;
    // Zones need a real re-render (their corner handles + fill depend on
    // selection); icon pins only need a cheap CSS class toggle so their drag
    // listeners survive. If either side of the swap is a zone, re-render all.
    const list = this._markerList || [];
    const touchesZone = [prevId, id].some(
      (mid) => mid && isZone(list.find((m) => m.id === mid))
    );
    if (touchesZone) {
      this.renderMarkers(list);
      return;
    }
    if (prevId) {
      const prev = this.markers.markers?.[prevId];
      prev?.element?.classList.remove("is-selected");
    }
    if (id) {
      const next = this.markers.markers?.[id];
      if (!next?.element) return;
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

/** Clamp a pitch (degrees) to the valid sphere range so a dragged zone can't
 *  wrap over the poles into a broken polygon. */
function clampPitch(deg) {
  return Math.max(-89.9, Math.min(89.9, deg));
}

function round(n) {
  return Math.round(n * 10) / 10;
}
