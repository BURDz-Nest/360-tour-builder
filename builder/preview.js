// preview.js — the builder's live 360 preview state machine.
//
// Decides what the center viewport shows: the current scene's panorama, or a
// friendly empty message (scene-without-image vs. no-scene) over a blank
// viewer. Keeps all "what's on screen" logic in one cohesive place.

export function createPreview({ state, $, toast, getScene, viewer, resolver }) {
  /**
   * Resolve a panorama/thumbnail path for the LIVE PREVIEW only. Delegates to
   * the asset resolver: reads straight from the tour folder handle as a blob:
   * URL (works wherever the folder lives), falling back to the HTTP base for
   * in-repo tours. Async. The base is never written to tour.json — saved paths
   * stay portable.
   */
  function resolvePreviewUrl(path) {
    return resolver.resolve(path);
  }

  /** Load a scene's panorama into the viewer using the resolved URL. */
  async function loadCurrentPreview(scene) {
    try {
      const url = await resolver.resolve(scene.panorama);
      await viewer.loadScene(scene, url);
    } catch {
      toast("Couldn't load that panorama (check the image exists in the folder).", true);
    }
  }

  /** Single source of truth for the preview (image vs. empty message). */
  function updatePreview() {
    const scene = getScene(state.tour, state.currentSceneId);
    const empty = $("preview-empty");
    if (scene && scene.panorama) {
      empty.hidden = true;
      loadCurrentPreview(scene);
      return;
    }
    empty.querySelector(".preview-empty__title").textContent = scene
      ? "This scene has no image yet"
      : "Add images to get started!";
    empty.querySelector(".preview-empty__sub").textContent = scene
      ? "Open \u201cImages\u2026\u201d and click a photo to use it for this scene."
      : "Open \u201cImages\u2026\u201d and drag in your 360 photos \u2014 each one becomes a scene.";
    empty.hidden = false;
    viewer.clear().catch(() => {});
  }

  return { resolvePreviewUrl, loadCurrentPreview, updatePreview };
}
