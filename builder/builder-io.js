// builder-io.js — tour persistence, import, export-preview, and the top-bar
// save-status readout. This is the "tour in and out of disk" boundary, pulled
// out of builder.js so the controller stays focused on wiring + rendering (SRP).
//
// Factory with dependency injection: the controller passes state, DOM/$ helper,
// the fs-workspace module, a toast fn, the asset resolver, validateTour, and a
// few late-bound getters (history/autosave/overlays are created after this) plus
// renderAll/selectScene so an import can refresh the UI.

export function createTourIO({
  state, $, fs, toast, resolver, validateTour,
  renderAll, selectScene,
  getHistory, getAutosave, getOverlays,
}) {
  /** Clean copy of the tour; meta.createdAt refreshed on every write/export. */
  function serializeTour() {
    return {
      ...state.tour,
      meta: { ...state.tour.meta, createdAt: new Date().toISOString() },
    };
  }

  /** Update the top-bar autosave readout. `kind` drives the color + status dot. */
  function setSaveStatus(text, kind = "idle") {
    const el = $("save-status");
    if (!el) return;
    el.textContent = text;
    el.classList.toggle("save-status--saving", kind === "saving");
    el.classList.toggle("save-status--saved", kind === "saved");
    el.classList.toggle("save-status--error", kind === "error");
  }

  function preExportCheck() {
    if (!state.tour.scenes.length) return "Add at least one scene first.";
    const missing = state.tour.scenes.filter((s) => !s.panorama);
    if (missing.length) return `${missing.length} scene(s) are missing a panorama URL.`;
    return null;
  }

  /**
   * Ensure snapshot thumbnails exist on disk AND that every local-image scene
   * references one. Backfills `thumbnail` for scenes whose panorama is a local
   * "images/<file>" path (covers old tours predating the thumbnail feature).
   */
  async function prepareThumbnails() {
    if (state.dirHandle) {
      try {
        await fs.ensureThumbnails(state.dirHandle);
      } catch (e) {
        console.warn("[builder] ensureThumbnails failed", e);
      }
    }
    for (const s of state.tour.scenes) {
      if (s.thumbnail) continue;
      const m = /^images\/(.+)$/.exec(s.panorama || "");
      if (m) s.thumbnail = `images/thumbs/${fs.thumbName(m[1])}`;
    }
  }

  /**
   * Save tour.json. Prefers the File System Access API (Chrome/Edge) so it writes
   * straight into the tour's folder and remembers the location for one-click
   * re-saves. Falls back to showSaveFilePicker, then a classic download.
   */
  async function saveTour() {
    const err = preExportCheck();
    if (err) return toast(err, true);
    await prepareThumbnails();
    const json = JSON.stringify(serializeTour(), null, 2);

    // Workspace mode: write straight into the bound tour folder, no dialog.
    if (state.dirHandle) {
      try {
        await fs.saveTourJson(state.dirHandle, json);
        getAutosave?.()?.markClean(); // manual save resets the autosave baseline too
        setSaveStatus("All changes saved", "saved");
        return toast("Saved tour.json into your tour folder.");
      } catch (e) {
        toast(`Couldn't save to folder: ${e.message}`, true);
        // fall through to picker/download as a backup
      }
    }

    if (window.showSaveFilePicker) {
      try {
        if (!state.fileHandle) {
          state.fileHandle = await window.showSaveFilePicker({
            suggestedName: "tour.json",
            types: [{ description: "Tour config", accept: { "application/json": [".json"] } }],
          });
        }
        const writable = await state.fileHandle.createWritable();
        await writable.write(json);
        await writable.close();
        return toast(`Saved ${state.fileHandle.name} into your tour folder.`);
      } catch (e) {
        if (e.name === "AbortError") return; // user cancelled the picker
        console.warn("[builder] FS save failed; falling back to download", e);
      }
    }

    // Fallback: classic download to ~/Downloads.
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "tour.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast("Downloaded tour.json. Move it into your tour folder next to player.html.");
  }

  async function previewInPlayer() {
    const err = preExportCheck();
    if (err) return toast(err, true);
    // Generate snapshot files AND point each scene at its thumbnail BEFORE we
    // stage the preview — awaited so we never open the player before the thumbs
    // exist (that race caused broken-image icons).
    await prepareThumbnails();

    // Build a preview config whose image paths are resolved to blob: URLs read
    // straight from the tour folder. This makes preview work no matter WHERE the
    // folder lives (even outside the repo) and lets us always open the repo's
    // template player, which is guaranteed to be served + same-origin. We clone
    // first so the real tour keeps its portable relative paths.
    let config;
    try {
      config = JSON.parse(JSON.stringify(serializeTour()));
      await resolveConfigImages(config);

      // Stage any tour-<code>.json language siblings too, so the preview's
      // language toggle behaves identically to the deployed player. Best-
      // effort: a scan failure just means the preview opens English-only.
      let siblings = {};
      if (state.dirHandle) {
        try { siblings = await fs.listLanguageSiblings(state.dirHandle); }
        catch (e) { console.warn("[builder] language scan failed", e); }
      }
      const codes = Object.keys(siblings).sort();
      config.languages = ["en", ...codes];
      localStorage.setItem("tour-preview-config", JSON.stringify(config));
      for (const code of codes) {
        const altConfig = JSON.parse(JSON.stringify(siblings[code]));
        await resolveConfigImages(altConfig);
        localStorage.setItem(`tour-preview-config-${code}`, JSON.stringify(altConfig));
      }
      // Drop stale alternates from a previous preview (e.g. a language file
      // was deleted since the last time this ran).
      const prefix = "tour-preview-config-";
      for (const key of Object.keys(localStorage)) {
        if (key.startsWith(prefix) && !codes.includes(key.slice(prefix.length))) {
          localStorage.removeItem(key);
        }
      }
    } catch (e) {
      return toast(`Couldn't stage preview: ${e.message}`, true);
    }
    // Always open the repo's template player (served by the dev server + same
    // origin, so the blob: image URLs created above are reachable). Cache-bust so
    // fresh ?v= pins for player.js/css are always picked up.
    const bust = `&_=${Date.now()}`;
    window.open("../player-template/player.html?config=__preview__" + bust, "_blank");
  }

  /** Resolve every panorama/thumbnail in a (cloned) config to blob: URLs, in place. */
  async function resolveConfigImages(cfg) {
    for (const s of cfg.scenes || []) {
      if (s.panorama) s.panorama = await resolver.resolve(s.panorama);
      if (s.thumbnail) s.thumbnail = await resolver.resolve(s.thumbnail);
    }
  }

  async function importTour(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const { ok, tour, errors, warnings } = validateTour(JSON.parse(text));
      if (!ok) throw new Error(errors.join("; "));
      state.tour = tour;
      state.currentSceneId = tour.scenes[0]?.id || null;
      state.selectedMarkerId = null;
      state.fileHandle = null; // imported a different file; next Save asks where
      renderAll();
      selectScene(state.currentSceneId);
      getHistory?.()?.reset(); // imported tour is the new undo baseline
      getOverlays?.()?.hideWelcome();
      toast(` Loaded "${tour.meta.title}".${warnings.length ? ` (${warnings.length} warning(s) — see console)` : ""}`);
      warnings.forEach((w) => console.warn("[import]", w));
    } catch (err) {
      toast(` Import failed: ${err.message}`, true);
    } finally {
      e.target.value = "";
    }
  }

  return {
    serializeTour, setSaveStatus, preExportCheck, prepareThumbnails,
    saveTour, previewInPlayer, importTour,
  };
}
