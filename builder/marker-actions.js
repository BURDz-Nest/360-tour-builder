/**
 * marker-actions.js - the marker CRUD + placement glue for the builder.
 *
 * Extracted from builder.js (which is pinned at the 600-line guideline) so
 * the controller stays lean. This is a factory: hand it the shared state, the
 * BuilderViewer, and a `refresh` callback (re-renders the side-panel list),
 * and it returns the marker action functions. SOLID/SRP: all "what happens to
 * a marker" logic lives here; builder.js just wires buttons + DOM.
 *
 * Handles both ICON markers (link/info, single yaw/pitch) and INFO ZONES
 * (polygon hotspots authored by dragging corner handles in the preview).
 */

import { MARKER_TYPES, MARKER_SHAPES } from "../player-template/js/tour-model.js";

/**
 * @param {object} ctx
 * @param {object} ctx.state       shared builder state ({tour, currentSceneId, selectedMarkerId, placing})
 * @param {object} ctx.viewer      the BuilderViewer instance
 * @param {(id:string)=>HTMLElement} ctx.$    document.getElementById shim
 * @param {(msg:string, isErr?:boolean)=>void} ctx.toast
 * @param {(tour:object, id:string)=>object} ctx.getScene
 * @param {Function} ctx.createMarker          tour-model factory
 * @param {() => void} ctx.refresh             re-render the side-panel marker list
 * @param {() => void} ctx.highlight           cheap: re-mark the selected card (no rebuild)
 */
export function createMarkerActions({
  state, viewer, $, toast, getScene, createMarker, refresh, highlight,
}) {
  const currentScene = () => getScene(state.tour, state.currentSceneId);

  /** Enter "place mode": the next preview click drops a marker of this kind. */
  function beginPlacing(type, shape = MARKER_SHAPES.ICON) {
    if (!state.currentSceneId) return toast("Select a scene first.", true);
    state.placing = { type, shape };
    viewer.setPlaceMode(true);
    const what =
      shape === MARKER_SHAPES.ZONE
        ? "info zone (a draggable box appears - drag its corners to fit)"
        : type === MARKER_TYPES.LINK
        ? "navigation hotspot"
        : "info hotspot";
    $("place-hint").textContent = ` Click in the preview to drop a ${what}. (Esc to cancel)`;
    $("place-hint").hidden = false;
  }

  function cancelPlacing() {
    state.placing = null;
    viewer.setPlaceMode(false);
    $("place-hint").hidden = true;
  }

  /** Preview reported a sphere click at yaw/pitch (DEGREES). */
  function handlePlace(yaw, pitch) {
    if (!state.placing) return;
    const scene = currentScene();
    if (!scene) return;

    if (state.placing.markerId) {
      const m = scene.markers.find((x) => x.id === state.placing.markerId);
      if (m) {
        m.yaw = yaw;
        m.pitch = pitch;
      }
    } else {
      const marker = createMarker({
        type: state.placing.type,
        shape: state.placing.shape,
        yaw,
        pitch, // zones use this as the center for their default quad
      });
      scene.markers.unshift(marker); // newest card on top of the list
      state.selectedMarkerId = marker.id;
    }
    cancelPlacing();
    viewer.renderMarkers(scene.markers);
    refresh();
    // Select the new/moved marker so it highlights (and zones show handles).
    if (state.selectedMarkerId) viewer.setSelectedMarker(state.selectedMarkerId);
  }

  function selectMarker(id) {
    if (state.selectedMarkerId === id) return; // no-op keeps input focus intact
    state.selectedMarkerId = id;
    viewer?.setSelectedMarker(id);
    // Cheap highlight (toggle .is-selected) instead of a full list rebuild, so
    // clicking/focusing a card doesn't destroy the field you're editing.
    highlight();
  }

  /** Accordion toggle: expand a collapsed card (select) or collapse the open
   *  one (deselect). Deselecting also clears the preview highlight/handles. */
  function toggleMarker(id) {
    if (state.selectedMarkerId === id) {
      state.selectedMarkerId = null;
      viewer?.setSelectedMarker(null);
      highlight();
    } else {
      selectMarker(id);
    }
  }

  function deleteMarker(id) {
    const scene = currentScene();
    if (!scene) return;
    scene.markers = scene.markers.filter((m) => m.id !== id);
    if (state.selectedMarkerId === id) state.selectedMarkerId = null;
    viewer.renderMarkers(scene.markers);
    refresh();
  }

  /** Re-enter place mode to reposition an existing ICON marker. */
  function replaceMarker(id) {
    const scene = currentScene();
    const m = scene?.markers.find((x) => x.id === id);
    if (!m) return;
    state.placing = { type: m.type, markerId: id };
    viewer.setPlaceMode(true);
    $("place-hint").textContent = " Click to reposition this hotspot. (Esc to cancel)";
    $("place-hint").hidden = false;
  }

  function updateMarker(id, patch) {
    const scene = currentScene();
    const m = scene?.markers.find((x) => x.id === id);
    if (!m) return;
    Object.assign(m, patch);
    // Anything that changes how the marker looks on the sphere re-renders it.
    if ("label" in patch || "icon" in patch || "idleStroke" in patch || "hoverColor" in patch) {
      viewer.renderMarkers(scene.markers);
    }
  }

  /** Commit a dragged zone corner (idx) to a new yaw/pitch (DEGREES). */
  function moveZoneCorner(id, idx, yaw, pitch) {
    const scene = currentScene();
    const m = scene?.markers.find((x) => x.id === id);
    if (!m || !Array.isArray(m.points) || !m.points[idx]) return;
    m.points[idx] = { yaw, pitch };
    viewer.renderMarkers(scene.markers); // re-draw polygon + handles
  }

  return {
    beginPlacing,
    cancelPlacing,
    handlePlace,
    selectMarker,
    toggleMarker,
    deleteMarker,
    replaceMarker,
    updateMarker,
    moveZoneCorner,
  };
}
